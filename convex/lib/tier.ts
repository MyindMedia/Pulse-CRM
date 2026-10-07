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

/**
 * An org's effective tier, in precedence order:
 *   1. the demo sandbox, always the top tier
 *   2. the beta flag: betaCohort and not graduated means Max
 *   3. orgs.tier, the explicit entitlement (a graduation, a checkout, or the
 *      tier an agency gave this studio)
 *   4. its agency's plan, when the org rolls up to an agency and has no
 *      tier of its own
 *   5. the retired orgs.plan field (pre-migration rows only)
 *   6. "core", the least privileged tier
 *
 * The agency plan used to OVERRIDE orgs.tier, which meant a studio an agency
 * had put on Core ran on whatever the agency bought, and a beta studio under
 * a Core agency lost its Max access. The studio's own tier now wins.
 */
async function resolveTier(
  ctx: QueryCtx | MutationCtx,
  org: OrgTierFields | null,
): Promise<TierKey> {
  if (inBeta(org)) return BETA_TIER;
  const own = migrateTierValue(org?.tier);
  if (own) return own;
  if (org?.agencyId) {
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
      .first();
    const fromAgency = migrateTierValue(agency?.plan);
    if (fromAgency) return fromAgency;
  }
  if (org?.plan && LEGACY_ORG_PLAN_MAP[org.plan]) return LEGACY_ORG_PLAN_MAP[org.plan];
  return "core";
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
