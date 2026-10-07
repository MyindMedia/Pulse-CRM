import type { QueryCtx, MutationCtx } from "../_generated/server";
import { BETA_TIER, type TierKey } from "./plans";
import { LEGACY_ORG_PLAN_MAP, migrateTierValue } from "./legacyPlans";

/* ============================================================
   Tier resolution - a leaf module on purpose.

   It imports nothing but plans.ts (and the migration map), so the access
   engine, usage metering and entitlements can all resolve an org's tier
   the same way without an import cycle (access -> entitlements -> usage
   -> tenant -> access). usage.ts re-exports these for its callers.
   ============================================================ */

/**
 * Resolve a stored org/agency plan string into a valid tier. New keys pass
 * through. Rows written before the Core/Growth/Max migration resolve through
 * the legacy map, so a deploy that lands before the migration runs never
 * demotes anyone. Unknown values fall back to "core" (the least privileged
 * tier), so a typo can never silently unlock a paid capability.
 */
export function tierForPlan(plan: string | undefined): TierKey {
  return migrateTierValue(plan) ?? "core";
}

/** The seeded sandbox workspace. It resolves to the top tier on purpose: a
 *  demo that hides half the product is a worse demo, and this org is also the
 *  no-auth fallback used by the test harness. */
export const DEMO_ORG = "pulse-demo";

type OrgTierFields = {
  tier?: string;
  plan?: string;
  agencyId?: string;
  betaCohort?: boolean;
  graduatedAt?: number;
  disabledFeatures?: string[];
};

/** True while a workspace is in the beta and has not graduated. Beta studios
 *  get the top tier through this flag, whatever orgs.tier says. */
export function inBeta(org: Pick<OrgTierFields, "betaCohort" | "graduatedAt"> | null | undefined): boolean {
  return Boolean(org?.betaCohort && !org.graduatedAt);
}

/** Pure core of the resolution, shared with the migration's old-vs-new
 *  comparison. `agencyPlan` is the stored plan of the org's agency (undefined
 *  when the org has no agency or the agency row is missing). */
export function resolveTierPure(org: OrgTierFields | null, agencyPlan: string | undefined): TierKey {
  if (inBeta(org)) return BETA_TIER;
  if (org?.agencyId) {
    const fromAgency = migrateTierValue(agencyPlan);
    if (fromAgency) return fromAgency;
  }
  const own = migrateTierValue(org?.tier);
  if (own) return own;
  if (org?.plan && LEGACY_ORG_PLAN_MAP[org.plan]) return LEGACY_ORG_PLAN_MAP[org.plan];
  return "core";
}

/**
 * An org's effective tier, in precedence order:
 *   1. the demo sandbox, always the top tier
 *   2. the beta flag: betaCohort and not graduated means Max
 *   3. its agency's plan, when the org rolls up to an agency (mapped to
 *      core / growth / max). An unknown or missing agency plan falls back to
 *      step 4.
 *   4. orgs.tier, the explicit entitlement of a standalone workspace
 *   5. the retired orgs.plan field (pre-migration rows only)
 *   6. "core", the least privileged tier
 *
 * This is main's precedence: the agency's plan overrides orgs.tier, so a
 * studio created through the agency console (stamped with a default tier)
 * runs at the agency's tier, and a Stripe up/downgrade that only changes
 * agencies.plan reaches every studio. The one exception is the beta flag.
 *
 * Graduation: a graduated beta studio under an agency follows the agency
 * plan like every other studio. Graduation sets orgs.tier, which only takes
 * effect for a studio that is not under an agency (or after it leaves one).
 */
async function resolveTier(
  ctx: QueryCtx | MutationCtx,
  org: OrgTierFields | null,
): Promise<TierKey> {
  let agencyPlan: string | undefined;
  if (org?.agencyId && !inBeta(org)) {
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
      .first();
    agencyPlan = agency?.plan;
  }
  return resolveTierPure(org, agencyPlan);
}

export async function tierForOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<TierKey> {
  if (orgId === DEMO_ORG) return "max";
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  return resolveTier(ctx, org);
}

/** Tier plus the operator's switched-off module list, from ONE org read.
 *  The access engine needs both on every metered check, and reading the row
 *  twice for two fields is the kind of thing that quietly doubles latency. */
export async function orgGate(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<{ tier: TierKey; disabled: Set<string> }> {
  if (orgId === DEMO_ORG) return { tier: "max", disabled: new Set() };
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  return {
    tier: await resolveTier(ctx, org),
    disabled: new Set(org?.disabledFeatures ?? []),
  };
}
