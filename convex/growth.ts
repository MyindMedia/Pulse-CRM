/* ============================================================
   Settings > Growth (openspec/changes/off-peak-and-google-reviews):
   off-peak pricing, fill-the-gap deal texts, the Google review link.

   Owners and managers (branding.edit, the settings gate). Off-peak
   changes prices, so it also needs money sight, like a room's rate.
   Every switch that changes leaves one activity entry.
   ============================================================ */
import { v, ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { mutation } from "./functions";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { currentOrgWithCapability, currentMoneySight, currentActor, assertOrg } from "./lib/tenant";
import { offPeakWindowError, OFF_PEAK_MAX_WINDOWS, describeWindow } from "./lib/offPeak";
import { cleanGoogleReviewUrl } from "./lib/gaps";
import { dealsMode, dealTextsLive } from "./lib/deals";

const windowV = v.object({
  days: v.array(v.number()),
  startHour: v.number(),
  endHour: v.number(),
  pct: v.number(),
});

async function orgDoc(ctx: { db: QueryCtx["db"] }, orgId: string) {
  return ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
}

async function log(ctx: MutationCtx, org: Doc<"orgs">, actor: string, summary: string) {
  await ctx.db.insert("activity", {
    orgId: org.orgId,
    kind: "settings.growth",
    summary: `${summary} by ${actor}`,
    actorName: actor,
    entityType: "org",
    entityId: org.orgId,
    accent: "info",
  });
}

/** The Growth tab: switches, the review link, each room's windows. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await orgDoc(ctx, orgId);
    const money = (await currentMoneySight(ctx)).money;
    const rooms = (await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect())
      .filter((r) => r.status !== "retired")
      .sort((a, b) => a.name.localeCompare(b.name));
    const artists = await ctx.db
      .query("artists")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return {
      canEditPricing: money,
      offPeakEnabled: org?.offPeakEnabled === true,
      dealTexts: { enabled: org?.dealTexts?.enabled === true, mode: dealsMode(org), live: dealTextsLive() },
      googleReviewUrl: org?.googleReviewUrl ?? "",
      dealsOptedIn: artists.filter((a) => a.dealsOptInAt && !a.erasedAt).length,
      rooms: rooms.map((r) => ({
        _id: r._id,
        name: r.name,
        ...(money ? { hourlyRateCents: r.hourlyRateCents ?? 0 } : {}),
        offPeakWindows: r.offPeakWindows ?? [],
      })),
    };
  },
});

/** Flip the switches or save the review link. Undefined fields are left alone. */
export const set = mutation({
  args: {
    offPeakEnabled: v.optional(v.boolean()),
    dealTexts: v.optional(v.object({ enabled: v.boolean(), mode: v.union(v.literal("approve"), v.literal("auto")) })),
    googleReviewUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "branding.edit");
    const org = await orgDoc(ctx, orgId);
    if (!org) throw new ConvexError({ code: "NOT_FOUND", message: "Studio not found." });
    const actor = await currentActor(ctx);

    if (args.offPeakEnabled !== undefined && args.offPeakEnabled !== (org.offPeakEnabled === true)) {
      if (!(await currentMoneySight(ctx)).money) {
        throw new ConvexError({ code: "FORBIDDEN", message: "Only someone who sets prices can change off-peak pricing." });
      }
      await ctx.db.patch(org._id, { offPeakEnabled: args.offPeakEnabled });
      await log(ctx, org, actor, `Off-peak pricing turned ${args.offPeakEnabled ? "on" : "off"}`);
    }

    if (args.dealTexts) {
      const before = { enabled: org.dealTexts?.enabled === true, mode: dealsMode(org) };
      if (before.enabled !== args.dealTexts.enabled || before.mode !== args.dealTexts.mode) {
        await ctx.db.patch(org._id, { dealTexts: args.dealTexts });
        await log(
          ctx,
          org,
          actor,
          `Deal texts ${args.dealTexts.enabled ? "on" : "off"} (${args.dealTexts.mode === "auto" ? "Auto" : "Approve each"})`,
        );
      }
    }

    if (args.googleReviewUrl !== undefined) {
      const cleaned = cleanGoogleReviewUrl(args.googleReviewUrl);
      if ("error" in cleaned) throw new ConvexError({ code: "INVALID", message: cleaned.error });
      if ((cleaned.url ?? undefined) !== org.googleReviewUrl) {
        await ctx.db.patch(org._id, { googleReviewUrl: cleaned.url ?? undefined });
        await log(ctx, org, actor, cleaned.url ? "Google review link saved" : "Google review link removed");
      }
    }
  },
});

/** Replace one room's off-peak windows. An empty list clears them. */
export const setRoomWindows = mutation({
  args: { roomId: v.id("rooms"), windows: v.array(windowV) },
  handler: async (ctx, { roomId, windows }) => {
    const orgId = await currentOrgWithCapability(ctx, "rooms.edit");
    if (!(await currentMoneySight(ctx)).money) {
      throw new ConvexError({ code: "FORBIDDEN", message: "Only someone who sets prices can change off-peak windows." });
    }
    const room = await ctx.db.get(roomId);
    assertOrg(room, orgId);
    if (windows.length > OFF_PEAK_MAX_WINDOWS) {
      throw new ConvexError({ code: "INVALID", message: `Up to ${OFF_PEAK_MAX_WINDOWS} windows per room.` });
    }
    const clean = windows.map((w) => ({ ...w, days: [...new Set(w.days)].sort((a, b) => a - b) }));
    for (const w of clean) {
      const err = offPeakWindowError(w);
      if (err) throw new ConvexError({ code: "INVALID", message: err });
    }
    await ctx.db.patch(roomId, { offPeakWindows: clean.length ? clean : undefined });
    const org = await orgDoc(ctx, orgId);
    if (org) {
      await log(
        ctx,
        org,
        await currentActor(ctx),
        clean.length
          ? `Off-peak for ${room!.name} set to ${clean.map(describeWindow).join("; ")}`
          : `Off-peak windows cleared for ${room!.name}`,
      );
    }
  },
});
