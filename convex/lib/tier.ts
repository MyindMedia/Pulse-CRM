import type { QueryCtx, MutationCtx } from "../_generated/server";
import { PLAN_LIMITS, type TierKey } from "./plans";

/* ============================================================
   Tier resolution - a leaf module on purpose.

   It imports nothing but plans.ts, so the access engine, usage
   metering and entitlements can all resolve an org's tier the same
   way without an import cycle (access -> entitlements -> usage ->
   tenant -> access). usage.ts re-exports these for its callers.
   ============================================================ */

/**
 * Resolve a stored org/agency plan string into a valid PLAN_LIMITS tier.
 * orgs.tier is one of the TierKeys; agencies.plan can also be "agency_plus".
 * Unknown values fall back to "studio" (the least privileged tier), so a
 * typo can never silently unlock a paid capability.
 */
export function tierForPlan(plan: string | undefined): TierKey {
  if (plan && plan in PLAN_LIMITS) return plan as TierKey;
  if (plan === "agency_plus") return "agency";
  return "studio";
}

/** The seeded sandbox workspace. It resolves to the top tier on purpose: a
 *  demo that hides half the product is a worse demo, and this org is also the
 *  no-auth fallback used by the test harness. */
export const DEMO_ORG = "pulse-demo";

/** orgs.plan is the original, always-present tier signal ("solo" | "studio" |
 *  "label"). orgs.tier was added later and is optional, so an org provisioned
 *  before it existed has no tier at all. Falling back through plan keeps those
 *  workspaces on the entitlements they were sold, instead of silently
 *  demoting every legacy studio to the cheapest tier on deploy. */
const PLAN_TO_TIER: Record<string, TierKey> = {
  solo: "studio",
  studio: "pro",
  label: "label",
};

/**
 * An org's effective tier, in precedence order:
 *   1. the demo sandbox, always top tier
 *   2. orgs.tier, the explicit entitlement
 *   3. its agency's plan, when the org rolls up to an agency
 *   4. orgs.plan, mapped through PLAN_TO_TIER (legacy rows)
 *   5. "studio", the least privileged tier
 */
export async function tierForOrg(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<TierKey> {
  if (orgId === DEMO_ORG) return "label";
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  let planString: string | undefined = org?.tier;
  if (org?.agencyId) {
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
      .first();
    if (agency?.plan) planString = agency.plan;
  }
  if (!planString && org?.plan) planString = PLAN_TO_TIER[org.plan];
  return tierForPlan(planString);
}


/** Tier plus the operator's switched-off module list, from ONE org read.
 *  The access engine needs both on every metered check, and reading the row
 *  twice for two fields is the kind of thing that quietly doubles latency. */
export async function orgGate(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<{ tier: TierKey; disabled: Set<string> }> {
  if (orgId === DEMO_ORG) return { tier: "label", disabled: new Set() };
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  let planString: string | undefined = org?.tier;
  if (org?.agencyId) {
    const agency = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
      .first();
    if (agency?.plan) planString = agency.plan;
  }
  if (!planString && org?.plan) planString = PLAN_TO_TIER[org.plan];
  return {
    tier: tierForPlan(planString),
    disabled: new Set(org?.disabledFeatures ?? []),
  };
}
