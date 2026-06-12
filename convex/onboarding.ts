import { query, mutation, QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { requireCapability } from "./lib/access";

/* ============================================================
   Branded studio onboarding. Drives the /welcome wizard a new
   sub-account owner walks after accepting their invite:
   basics + logo, company/contact, branding, first room.
   "Active immediately, resumable" - the org is already live; the
   dashboard nudges until onboardingCompletedAt is set.
   ============================================================ */

async function myOrg(ctx: QueryCtx | MutationCtx) {
  const orgId = await currentOrg(ctx);
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  return { orgId, org };
}

/** Current onboarding state for the signed-in owner's studio (or null). */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const { orgId, org } = await myOrg(ctx);
    if (!org) return null;
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      orgId,
      name: org.name,
      slug: org.slug,
      accentColor: org.accentColor ?? "#fdb913",
      tagline: org.tagline ?? "",
      bookingHeadline: org.bookingHeadline ?? "",
      bookingIntro: org.bookingIntro ?? "",
      depositPolicyText: org.depositPolicyText ?? "",
      contact: org.contact ?? null,
      logoUrl: org.logoId ? await ctx.storage.getUrl(org.logoId) : null,
      roomCount: rooms.length,
      onboardingCompletedAt: org.onboardingCompletedAt ?? null,
      termsAcceptedAt: org.termsAcceptedAt ?? null,
      termsVersion: org.termsVersion ?? null,
      // Per-step completion the wizard uses to show ticks / compute progress.
      steps: {
        basics: Boolean(org.name && org.name !== "New studio" && org.slug),
        logo: Boolean(org.logoId),
        contact: Boolean(org.contact?.legalName || org.contact?.phone || org.contact?.address),
        branding: Boolean(org.tagline || org.bookingIntro),
        rooms: rooms.length > 0,
      },
    };
  },
});

/** Step 1 - studio basics: display name, public slug, accent color. */
export const saveBasics = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    accentColor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, org } = await myOrg(ctx);
    await requireCapability(ctx, "branding.edit", { orgId });
    if (!org) throw new ConvexError("No studio to set up.");

    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Give your studio a name (2+ characters).");

    const slug = args.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (slug.length < 2) throw new ConvexError("Pick a booking-page address (2+ characters).");
    const clash = await ctx.db
      .query("orgs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (clash && clash.orgId !== orgId) {
      throw new ConvexError(`The address "/book/${slug}" is taken. Try another.`);
    }

    await ctx.db.patch(org._id, {
      name,
      slug,
      ...(args.accentColor ? { accentColor: args.accentColor } : {}),
    });
  },
});

/** Step 2 - company / contact info. */
export const saveContact = mutation({
  args: {
    legalName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    website: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { orgId, org } = await myOrg(ctx);
    await requireCapability(ctx, "branding.edit", { orgId });
    if (!org) throw new ConvexError("No studio to set up.");
    const trim = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    await ctx.db.patch(org._id, {
      contact: {
        legalName: trim(args.legalName),
        contactEmail: trim(args.contactEmail),
        phone: trim(args.phone),
        address: trim(args.address),
        website: trim(args.website),
      },
    });
  },
});

/** Step 4 - create the studio's first bookable room. */
export const addRoom = mutation({
  args: {
    name: v.string(),
    roomType: v.optional(v.string()),
    hourlyRateCents: v.optional(v.number()),
    depositPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { orgId } = await myOrg(ctx);
    await requireCapability(ctx, "rooms.edit", { orgId });
    const name = args.name.trim();
    if (name.length < 1) throw new ConvexError("Give the room a name.");
    return await ctx.db.insert("rooms", {
      orgId,
      name,
      roomType: args.roomType?.trim() || undefined,
      hourlyRateCents: args.hourlyRateCents,
      status: "available",
      depositPct: args.depositPct,
      bookable: true,
      statusSource: "auto",
    });
  },
});

/** Mark onboarding finished (clears the dashboard nudge). Idempotent. */
export const complete = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId, org } = await myOrg(ctx);
    await requireCapability(ctx, "branding.edit", { orgId });
    if (org && !org.onboardingCompletedAt) {
      await ctx.db.patch(org._id, { onboardingCompletedAt: Date.now() });
    }
  },
});

/** Record acceptance of the Terms of Service during onboarding. The wizard
    gates everything behind this; re-acceptance is required when the terms
    version changes. */
export const acceptTerms = mutation({
  args: { version: v.string() },
  handler: async (ctx, { version }) => {
    const { org } = await myOrg(ctx);
    if (!org) throw new Error("No studio for this account yet.");
    const identity = await ctx.auth.getUserIdentity();
    await ctx.db.patch(org._id, {
      termsAcceptedAt: Date.now(),
      termsVersion: version,
      termsAcceptedBy: identity?.email ?? identity?.subject ?? "unknown",
    });
    return { acceptedAt: Date.now() };
  },
});
