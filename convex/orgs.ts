import { query, mutation, QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { currentOrg, currentActor } from "./lib/tenant";

/* Orgs - one row per studio subaccount. `current` is the active workspace;
   `getBySlug` powers the public /book/<slug> page. Branding (logo, accent,
   booking-page theming) lives here and flows into the app + booking site. */

/** Shape an org doc into the branding payload the UI consumes. */
async function brandOf(ctx: QueryCtx, org: Doc<"orgs"> | null, orgId: string) {
  return {
    orgId,
    name: org?.name ?? "Pulse Studio",
    slug: org?.slug ?? "pulse-studio",
    plan: org?.plan ?? "studio",
    status: org?.status ?? "active",
    accentColor: org?.accentColor ?? "#fdb913",
    tagline: org?.tagline ?? "Your music business runs itself.",
    logoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null,
    bookingHeroUrl: org?.bookingHeroId ? await ctx.storage.getUrl(org.bookingHeroId) : null,
    bookingHeadline: org?.bookingHeadline ?? null,
    bookingIntro: org?.bookingIntro ?? null,
    depositPolicyText: org?.depositPolicyText ?? null,
    ownerName: org?.ownerName ?? null,
    ownerEmail: org?.ownerEmail ?? null,
    configured: Boolean(org),
  };
}

/** The caller's active workspace + branding. */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
    const actor = await currentActor(ctx);
    return { ...(await brandOf(ctx, org, orgId)), actor };
  },
});

/** Public - resolve a studio by its slug for the /book/<slug> page. */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!org) return null;
    return brandOf(ctx, org, org.orgId);
  },
});

/** Ensure the active org has a row, then return it. */
async function ensureOrg(ctx: { db: QueryCtx["db"] }, orgId: string) {
  return ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

export const update = mutation({
  args: {
    name: v.optional(v.string()),
    plan: v.optional(v.union(v.literal("solo"), v.literal("studio"), v.literal("label"))),
    accentColor: v.optional(v.string()),
    tagline: v.optional(v.string()),
    bookingHeadline: v.optional(v.string()),
    bookingIntro: v.optional(v.string()),
    depositPolicyText: v.optional(v.string()),
  },
  handler: async (ctx, patch) => {
    const orgId = await currentOrg(ctx);
    const org = await ensureOrg(ctx, orgId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    if (org) {
      await ctx.db.patch(org._id, clean);
    } else {
      await ctx.db.insert("orgs", {
        orgId,
        name: (patch.name as string) ?? "Pulse Studio",
        slug: "pulse-studio",
        plan: patch.plan ?? "studio",
        status: "active",
        accentColor: patch.accentColor,
        tagline: patch.tagline,
        bookingHeadline: patch.bookingHeadline,
        bookingIntro: patch.bookingIntro,
        depositPolicyText: patch.depositPolicyText,
      });
    }
  },
});

/** Upload URL for a branding asset (logo / booking hero). */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrg(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const setLogo = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const orgId = await currentOrg(ctx);
    const org = await ensureOrg(ctx, orgId);
    if (org) await ctx.db.patch(org._id, { logoId: storageId });
    else
      await ctx.db.insert("orgs", {
        orgId,
        name: "Pulse Studio",
        slug: "pulse-studio",
        plan: "studio",
        status: "active",
        logoId: storageId,
      });
  },
});

export const setBookingHero = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const orgId = await currentOrg(ctx);
    const org = await ensureOrg(ctx, orgId);
    if (org) await ctx.db.patch(org._id, { bookingHeroId: storageId });
    else
      await ctx.db.insert("orgs", {
        orgId,
        name: "Pulse Studio",
        slug: "pulse-studio",
        plan: "studio",
        status: "active",
        bookingHeroId: storageId,
      });
  },
});
