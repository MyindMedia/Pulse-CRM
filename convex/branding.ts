import { fileRefV } from "./lib/fileRef";
import { claimFile, retireFile } from "./lib/media";
import { mutation } from "./functions";
import { v } from "convex/values";
import { requireCapability } from "./lib/access";
import { PLAN_LIMITS } from "./lib/plans";
import { tierForPlan } from "./lib/tier";

/* ============================================================
   Branding mutations - both agency-level (white-label) and
   per-sub-account. All gated by branding.edit + a plan-tier
   check for premium features (custom domain → Agency tier).
   ============================================================ */

export const updateAgencyBranding = mutation({
  args: {
    accentColor: v.optional(v.string()),
    appName: v.optional(v.string()),
    customDomain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "branding.edit");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .first();
    if (!ag) throw new Error("agency not found");

    if (args.customDomain) {
      if (!PLAN_LIMITS[tierForPlan(ag.plan)].customDomain) {
        throw new Error("A custom domain needs the Max plan.");
      }
    }
    await ctx.db.patch(ag._id, {
      accentColor: args.accentColor ?? ag.accentColor,
      appName: args.appName ?? ag.appName,
      customDomain: args.customDomain ?? ag.customDomain,
    });
  },
});

/** Set the agency white-label logo. Saves immediately, like the studio side. */
export const setAgencyLogo = mutation({
  args: { storageId: fileRefV },
  handler: async (ctx, { storageId }) => {
    const viewer = await requireCapability(ctx, "branding.edit");
    if (viewer.kind !== "agency_member") throw new Error("agency only");
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_agency", (q) => q.eq("agencyId", viewer.agencyId))
      .first();
    if (!ag) throw new Error("agency not found");
    await claimFile(ctx, storageId, `agency:${viewer.agencyId}`);
    const previous = ag.logoId;
    await ctx.db.patch(ag._id, { logoId: storageId });
    await retireFile(ctx, previous, storageId);
  },
});

export const updateStudioBranding = mutation({
  args: {
    accentColor: v.optional(v.string()),
    tagline: v.optional(v.string()),
    bookingHeadline: v.optional(v.string()),
    bookingIntro: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireCapability(ctx, "branding.edit");
    const orgId = "orgId" in viewer ? viewer.orgId : undefined;
    if (!orgId) throw new Error("requires active org");
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    if (!org) throw new Error("org not found");
    await ctx.db.patch(org._id, {
      accentColor: args.accentColor ?? org.accentColor,
      tagline: args.tagline ?? org.tagline,
      bookingHeadline: args.bookingHeadline ?? org.bookingHeadline,
      bookingIntro: args.bookingIntro ?? org.bookingIntro,
    });
  },
});
