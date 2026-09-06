import { v } from "convex/values";
import { internalMutation } from "./functions";

/* ============================================================
   One-shot migrations. Each one is idempotent: safe to run on
   every deploy. Run via the Convex dashboard or `convex run`.
   No public mutation trigger to avoid TS circular self-reference;
   agency admins invoke through the dashboard.
   ============================================================ */

export const backfillOrgTier = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    let touched = 0;
    for (const org of orgs) {
      if (org.tier) continue;
      let tier: "studio" | "pro" | "agency" = "studio";
      if (org.agencyId) {
        const ag = await ctx.db
          .query("agencies")
          .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
          .first();
        if (ag?.plan === "pro") tier = "pro";
        else if (ag?.plan === "agency" || ag?.plan === "agency_plus") tier = "agency";
      }
      await ctx.db.patch(org._id, { tier });
      touched++;
    }
    return { touched, total: orgs.length };
  },
});


/* Put one workspace on a named tier.
 *
 * `orgs.tier` is only ever WRITTEN at creation or by graduateBeta, which
 * refuses anything outside the beta cohort - so a workspace provisioned on the
 * wrong tier has no supported way back. This is that way, spelled out rather
 * than done by hand in the dashboard where nothing records that it happened.
 *
 * Worth knowing before reaching for it: on a workspace that rolls up to an
 * agency, `orgs.tier` does NOT decide entitlements. tierForOrg lets the
 * AGENCY's plan override it, so a sub-account under an "agency"-plan agency
 * already has every capability that plan carries whatever this column says.
 * Setting it makes the row and the agency console agree with what the caller
 * actually gets, and covers the day the agency plan changes.
 */
export const setOrgTier = internalMutation({
  args: {
    orgId: v.string(),
    tier: v.union(
      v.literal("flow"),
      v.literal("studio"),
      v.literal("pro"),
      v.literal("label"),
      v.literal("enterprise"),
    ),
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
