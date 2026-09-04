import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { currentOrg, assertOrg, currentOrgWithCapability} from "./lib/tenant";

/* ============================================================
   Licensing - two revenue streams off the song catalog:
   sync placements (film/TV/ad/game) and beat licenses.
   ============================================================ */

const syncStageV = v.union(
  v.literal("pitched"),
  v.literal("heard"),
  v.literal("shortlisted"),
  v.literal("negotiating"),
  v.literal("placed"),
  v.literal("passed"),
);
const tierV = v.union(
  v.literal("mp3"),
  v.literal("wav"),
  v.literal("trackout"),
  v.literal("exclusive"),
);

// ── Sync opportunities ──
export const syncBoard = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("syncOpportunities")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const songIds = [...new Set(rows.map((r) => r.songId))];
    const songs = new Map(
      (await Promise.all(songIds.map((id) => ctx.db.get(id))))
        .filter(Boolean)
        .map((s) => [s!._id, s!]),
    );
    return rows
      .map((r) => ({ ...r, songTitle: songs.get(r.songId)?.title ?? "Unknown" }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

export const createSync = mutation({
  args: {
    songId: v.id("songs"),
    supervisorName: v.string(),
    outlet: v.string(),
    feeCents: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const song = await ctx.db.get(args.songId);
    assertOrg(song, orgId);
    const id = await ctx.db.insert("syncOpportunities", {
      orgId,
      songId: args.songId,
      supervisorName: args.supervisorName,
      outlet: args.outlet,
      stage: "pitched",
      feeCents: args.feeCents,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "sync.pitched",
      summary: `"${song.title}" pitched to ${args.supervisorName} (${args.outlet})`,
      entityType: "song",
      entityId: args.songId,
      accent: "gold",
    });
    return id;
  },
});

/** Edit a sync opportunity's details from the drill-down sheet. */
export const updateSync = mutation({
  args: {
    id: v.id("syncOpportunities"),
    supervisorName: v.optional(v.string()),
    outlet: v.optional(v.string()),
    feeCents: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const row = await ctx.db.get(id);
    assertOrg(row, orgId);
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

export const moveSyncStage = mutation({
  args: { id: v.id("syncOpportunities"), stage: syncStageV },
  handler: async (ctx, { id, stage }) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const row = await ctx.db.get(id);
    assertOrg(row, orgId);
    await ctx.db.patch(id, { stage, updatedAt: Date.now() });
    if (stage === "placed") {
      const song = await ctx.db.get(row.songId);
      await ctx.db.insert("activity", {
        orgId,
        kind: "sync.placed",
        summary: `Sync placed - "${song?.title ?? "Track"}" with ${row.supervisorName}`,
        entityType: "song",
        entityId: row.songId,
        accent: "positive",
      });
    }
  },
});

// ── Beat licenses ──
export const licensesForSong = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("licenses")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .collect();
    return rows.filter((r) => r.orgId === orgId).sort((a, b) => b.soldAt - a.soldAt);
  },
});

export const allLicenses = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("licenses")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const songIds = [...new Set(rows.map((r) => r.songId))];
    const songs = new Map(
      (await Promise.all(songIds.map((id) => ctx.db.get(id))))
        .filter(Boolean)
        .map((s) => [s!._id, s!]),
    );
    return rows
      .map((r) => ({ ...r, songTitle: songs.get(r.songId)?.title ?? "Unknown" }))
      .sort((a, b) => b.soldAt - a.soldAt);
  },
});

export const sellLicense = mutation({
  args: {
    songId: v.id("songs"),
    buyerName: v.string(),
    buyerArtistId: v.optional(v.id("artists")),
    tier: tierV,
    priceCents: v.number(),
    termMonths: v.optional(v.number()),
    streamCap: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const song = await ctx.db.get(args.songId);
    assertOrg(song, orgId);
    // Exclusive licenses retire the beat from the non-exclusive market.
    if (args.tier === "exclusive") {
      const prior = await ctx.db
        .query("licenses")
        .withIndex("by_song", (q) => q.eq("songId", args.songId))
        .collect();
      for (const p of prior.filter((p) => p.active && p.tier !== "exclusive")) {
        await ctx.db.patch(p._id, { active: false });
      }
    }
    const id = await ctx.db.insert("licenses", {
      orgId,
      songId: args.songId,
      buyerName: args.buyerName,
      buyerArtistId: args.buyerArtistId,
      tier: args.tier,
      priceCents: args.priceCents,
      termMonths: args.termMonths,
      streamCap: args.streamCap,
      active: true,
      soldAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "license.sold",
      summary: `${args.tier.toUpperCase()} license sold - "${song.title}" to ${args.buyerName}`,
      entityType: "song",
      entityId: args.songId,
      accent: "positive",
    });
    return id;
  },
});

export const deactivateLicense = mutation({
  args: { id: v.id("licenses") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "licenses.edit");
    const row = await ctx.db.get(id);
    assertOrg(row, orgId);
    await ctx.db.patch(id, { active: false });
  },
});
