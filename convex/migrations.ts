import { v } from "convex/values";
import { internalMutation } from "./functions";
import { tierV } from "./lib/tierV";
import { tierRank, type TierKey } from "./lib/pricing";
import { resolveTierPure } from "./lib/tier";
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

/** orgs.plan values as main's tier.ts read them (PLAN_TO_TIER). */
const MAIN_PLAN_TO_TIER: Record<string, string> = {
  solo: "studio",
  studio: "pro",
  label: "label",
};

/** The tier main's tier.ts would resolve for this org, expressed in the new
 *  keys: the agency's plan OVERRIDES orgs.tier, then orgs.plan, then the
 *  least privileged tier. Pure, exported for tests. */
export function oldRuleTier(
  org: { tier?: string; plan?: string; agencyId?: string },
  agencyPlan: string | undefined,
): TierKey {
  let planString: string | undefined = org.tier;
  if (org.agencyId && agencyPlan) planString = agencyPlan;
  if (!planString && org.plan) planString = MAIN_PLAN_TO_TIER[org.plan];
  return migrateTierValue(planString) ?? "core";
}

/** The tier the org resolves to once its own row and its agency's row have
 *  been migrated, under the branch's rule (lib/tier.ts). Pure. */
export function newRuleTier(
  org: { tier?: string; plan?: string; agencyId?: string; betaCohort?: boolean; graduatedAt?: number },
  agencyPlan: string | undefined,
): TierKey {
  const m = migratedOrgFields(org);
  return resolveTierPure(
    { ...org, tier: m.tier, plan: undefined },
    agencyPlan === undefined ? undefined : migratedAgencyPlan(agencyPlan),
  );
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
 * Never lowers anyone. For EVERY org the run computes the tier main's rule
 * would resolve (the agency's plan overrides orgs.tier) and the tier the new
 * rule resolves after migration. If any org would resolve lower, the real run
 * throws before writing a single row; the dry run lists them under `lowered`.
 *
 * Idempotent: a second run reports zero changes. `dryRun` reports what it
 * would change without writing. NEVER run against production without
 * Lawrence's go-ahead; run it locally first.
 */
export const migrateToCoreGrowthMax = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const agencyPlans = new Map<string, string>();
    for (const ag of await ctx.db.query("agencies").collect()) agencyPlans.set(ag.agencyId, ag.plan);

    const orgs = await ctx.db.query("orgs").collect();
    const orgTiers = orgs.map((org) => {
      const agencyPlan = org.agencyId ? agencyPlans.get(org.agencyId) : undefined;
      return {
        orgId: org.orgId,
        oldRule: oldRuleTier(org, agencyPlan),
        newRule: newRuleTier(org, agencyPlan),
      };
    });
    const lowered = orgTiers.filter((o) => tierRank(o.newRule) < tierRank(o.oldRule));
    if (lowered.length > 0 && !dryRun) {
      throw new Error(
        `migrateToCoreGrowthMax refused, nothing written: ${lowered.length} org(s) would resolve lower than under the old rule: ` +
          lowered.map((o) => `${o.orgId} ${o.oldRule} -> ${o.newRule}`).join(", "),
      );
    }

    const orgChanges: { orgId: string; from: string; to: string }[] = [];
    for (const org of orgs) {
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
      orgTiers,
      lowered,
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
 * An agency's plan overrides orgs.tier (lib/tier.ts), so this takes effect for
 * a standalone workspace, or one that has left its agency. A studio under an
 * agency follows the agency plan; move the agency, not the studio. The beta
 * flag gives Max until graduation.
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
