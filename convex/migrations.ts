import { internalMutation } from "./_generated/server";

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

