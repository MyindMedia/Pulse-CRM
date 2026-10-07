import { v } from "convex/values";
import { internalMutation } from "./functions";
import { tierV } from "./lib/tierV";
import type { TierKey } from "./lib/pricing";
import {
  LEGACY_ORG_PLAN_MAP,
  LEGACY_PLAN_NAME_MAP,
  migrateTierValue,
} from "./lib/legacyPlans";

/* ============================================================
   One-shot migrations. Each one is idempotent: safe to run on
   every deploy. Run via the Convex dashboard or `convex run`.
   No public mutation trigger to avoid TS circular self-reference;
   agency admins invoke through the dashboard.
   ============================================================ */

/** Pure mapping for one org row, exported for tests.
 *
 *  orgs.tier old values map through LEGACY_TIER_MAP (studio -> core,
 *  pro -> growth, label -> max, flow -> core, enterprise and agency -> max).
 *  When an org has no tier, the retired orgs.plan field decides, through its
 *  OWN map: plan "studio" meant the old pro tier, so it becomes growth.
 *  orgs.plan is always cleared. An org with neither stays without a tier
 *  and keeps following its agency's plan (lib/tier.ts). */
export function migratedOrgFields(org: {
  tier?: string;
  plan?: string;
}): { tier: TierKey | undefined; clearPlan: boolean; changed: boolean } {
  const fromTier = migrateTierValue(org.tier);
  const fromPlan = org.plan ? LEGACY_ORG_PLAN_MAP[org.plan] : undefined;
  const tier = fromTier ?? fromPlan ?? undefined;
  const clearPlan = org.plan !== undefined;
  const changed = clearPlan || tier !== org.tier;
  return { tier, clearPlan, changed };
}

/** Pure mapping for an agency plan, exported for tests. Unknown values fall
 *  to core, the least privileged tier. */
export function migratedAgencyPlan(plan: string): TierKey {
  return migrateTierValue(plan) ?? "core";
}

/** "Studio" -> "Core", "Studio Pro - Early Adopter" -> "Growth - Early
 *  Adopter". Names that are not one of the old seeded plans are returned
 *  unchanged, so an agency's own plan names are never touched. */
export function migratedPlanName(name: string): string {
  const suffix = " - Early Adopter";
  const base = name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  const mapped = LEGACY_PLAN_NAME_MAP[base];
  if (!mapped) return name;
  return name.endsWith(suffix) ? `${mapped}${suffix}` : mapped;
}

/**
 * Core / Growth / Max. Rewrites every stored plan value from the old ladder.
 *
 *   orgs.tier      studio -> core, pro -> growth, label -> max,
 *                  flow -> core, enterprise / agency -> max
 *   orgs.plan      folded into orgs.tier when tier is unset (solo -> core,
 *                  studio -> growth, label -> max), then cleared
 *   agencies.plan  same map as orgs.tier, agency_plus -> max
 *   agencyPlans    the seeded names Studio / Studio Pro / Label (and their
 *                  "- Early Adopter" twins) renamed Core / Growth / Max
 *
 * Idempotent: a second run reports zero changes. `dryRun` reports what it
 * would change without writing. NEVER run against production without
 * Lawrence's go-ahead; run it locally first.
 */
export const migrateToCoreGrowthMax = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const orgChanges: { orgId: string; from: string; to: string }[] = [];
    for (const org of await ctx.db.query("orgs").collect()) {
      const m = migratedOrgFields(org);
      if (!m.changed) continue;
      orgChanges.push({
        orgId: org.orgId,
        from: `tier=${org.tier ?? "unset"} plan=${org.plan ?? "unset"}`,
        to: `tier=${m.tier ?? "unset"}`,
      });
      if (!dryRun) {
        await ctx.db.patch(org._id, {
          tier: m.tier,
          ...(m.clearPlan ? { plan: undefined } : {}),
        });
      }
    }

    const agencyChanges: { agencyId: string; from: string; to: string }[] = [];
    for (const ag of await ctx.db.query("agencies").collect()) {
      const to = migratedAgencyPlan(ag.plan);
      if (to === ag.plan) continue;
      agencyChanges.push({ agencyId: ag.agencyId, from: ag.plan, to });
      if (!dryRun) await ctx.db.patch(ag._id, { plan: to });
    }

    const planNameChanges: { id: string; from: string; to: string }[] = [];
    for (const p of await ctx.db.query("agencyPlans").collect()) {
      const to = migratedPlanName(p.name);
      if (to === p.name) continue;
      planNameChanges.push({ id: p._id, from: p.name, to });
      if (!dryRun) await ctx.db.patch(p._id, { name: to });
    }

    return {
      dryRun: Boolean(dryRun),
      orgs: orgChanges.length,
      agencies: agencyChanges.length,
      agencyPlans: planNameChanges.length,
      orgChanges,
      agencyChanges,
      planNameChanges,
    };
  },
});

/* Put one workspace on a named tier.
 *
 * `orgs.tier` is only ever WRITTEN at creation or by graduateBeta, which
 * refuses anything outside the beta cohort - so a workspace provisioned on the
 * wrong tier has no supported way back. This is that way, spelled out rather
 * than done by hand in the dashboard where nothing records that it happened.
 *
 * The studio's own tier wins over its agency's plan (lib/tier.ts), so this is
 * what the workspace actually gets, unless it is in the beta and has not
 * graduated: the beta flag gives Max until graduation.
 */
export const setOrgTier = internalMutation({
  args: {
    orgId: v.string(),
    tier: tierV,
  },
  handler: async (ctx, { orgId, tier }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error(`No workspace with orgId ${orgId}`);
    const was = org.tier ?? "unset";
    if (was === tier) return { orgId, name: org.name, was, now: tier, changed: false };

    await ctx.db.patch(org._id, { tier });
    await ctx.db.insert("activity", {
      orgId,
      kind: "account.tier_changed",
      summary: `${org.name} moved from ${was} to ${tier}`,
    });
    return { orgId, name: org.name, was, now: tier, changed: true };
  },
});
