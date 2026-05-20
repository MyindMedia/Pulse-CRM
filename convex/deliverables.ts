import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";

const kindV = v.union(
  v.literal("mix"),
  v.literal("master"),
  v.literal("stems"),
  v.literal("instrumental"),
  v.literal("reference"),
  v.literal("backup"),
);
const statusV = v.union(
  v.literal("delivered"),
  v.literal("in_review"),
  v.literal("approved"),
  v.literal("final"),
);

/** All deliverables for a song, newest version first, with comment counts. */
export const forSong = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("deliverables")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .collect();
    const comments = await ctx.db
      .query("revisionComments")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .collect();
    return rows
      .filter((r) => r.orgId === orgId)
      .map((r) => ({
        ...r,
        commentCount: comments.filter((c) => c.deliverableId === r._id).length,
        openCommentCount: comments.filter((c) => c.deliverableId === r._id && !c.resolved).length,
      }))
      .sort((a, b) => b.version - a.version);
  },
});

export const create = mutation({
  args: {
    songId: v.id("songs"),
    kind: kindV,
    label: v.string(),
    durationSec: v.optional(v.number()),
    paymentGated: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(args.songId);
    assertOrg(song, orgId);
    // Auto-increment version within the song.
    const existing = await ctx.db
      .query("deliverables")
      .withIndex("by_song", (q) => q.eq("songId", args.songId))
      .collect();
    const version = existing.reduce((max, d) => Math.max(max, d.version), 0) + 1;
    const id = await ctx.db.insert("deliverables", {
      orgId,
      songId: args.songId,
      kind: args.kind,
      version,
      label: args.label,
      status: "delivered",
      durationSec: args.durationSec,
      paymentGated: args.paymentGated ?? false,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "deliverable.created",
      summary: `${args.label} v${version} delivered for "${song.title}"`,
      entityType: "song",
      entityId: args.songId,
      accent: "info",
    });
    return id;
  },
});

export const setStatus = mutation({
  args: { id: v.id("deliverables"), status: statusV, approvedBy: v.optional(v.string()) },
  handler: async (ctx, { id, status, approvedBy }) => {
    const orgId = await currentOrg(ctx);
    const d = await ctx.db.get(id);
    assertOrg(d, orgId);
    const patch: Record<string, unknown> = { status };
    if (status === "approved" || status === "final") {
      patch.approvedAt = Date.now();
      patch.approvedBy = approvedBy ?? "Studio";
    }
    await ctx.db.patch(id, patch);
    if (status === "approved") {
      const song = await ctx.db.get(d.songId);
      await ctx.db.insert("activity", {
        orgId,
        kind: "deliverable.approved",
        summary: `${d.label} v${d.version} approved${song ? ` - "${song.title}"` : ""}`,
        entityType: "song",
        entityId: d.songId,
        accent: "positive",
      });
    }
  },
});

/** Revision comments - timestamped against a deliverable version. */
export const comments = query({
  args: { deliverableId: v.id("deliverables") },
  handler: async (ctx, { deliverableId }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("revisionComments")
      .withIndex("by_deliverable", (q) => q.eq("deliverableId", deliverableId))
      .collect();
    return rows
      .filter((r) => r.orgId === orgId)
      .sort((a, b) => a.timestampSec - b.timestampSec);
  },
});

export const addComment = mutation({
  args: {
    deliverableId: v.id("deliverables"),
    timestampSec: v.number(),
    body: v.string(),
    authorName: v.string(),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const d = await ctx.db.get(args.deliverableId);
    assertOrg(d, orgId);
    // Revision-budget guard: bump usage on the parent song.
    const song = await ctx.db.get(d.songId);
    if (song) {
      await ctx.db.patch(d.songId, { revisionsUsed: song.revisionsUsed + 0 });
    }
    return await ctx.db.insert("revisionComments", {
      orgId,
      songId: d.songId,
      deliverableId: args.deliverableId,
      timestampSec: args.timestampSec,
      body: args.body,
      authorName: args.authorName,
      resolved: false,
    });
  },
});

export const resolveComment = mutation({
  args: { id: v.id("revisionComments"), resolved: v.boolean() },
  handler: async (ctx, { id, resolved }) => {
    const orgId = await currentOrg(ctx);
    const c = await ctx.db.get(id);
    assertOrg(c, orgId);
    await ctx.db.patch(id, { resolved });
  },
});

/** Spend one revision from the song's included budget. */
export const consumeRevision = mutation({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(songId);
    assertOrg(song, orgId);
    const used = song.revisionsUsed + 1;
    await ctx.db.patch(songId, { revisionsUsed: used });
    if (used > song.revisionsIncluded) {
      await ctx.db.insert("insights", {
        orgId,
        kind: "revenue",
        severity: "opportunity",
        title: `Revision overage - "${song.title}"`,
        body: `This song has used ${used} of ${song.revisionsIncluded} included revisions. Bill the overage or upsell a revision pack.`,
        entityType: "song",
        entityId: songId,
        status: "new",
      });
    }
    return used;
  },
});
