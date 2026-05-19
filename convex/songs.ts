import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

const stageV = v.union(
  v.literal("writing"),
  v.literal("demo"),
  v.literal("tracking"),
  v.literal("editing"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("delivered"),
  v.literal("released"),
);
const kindV = v.union(
  v.literal("single"),
  v.literal("album_track"),
  v.literal("beat"),
  v.literal("spec"),
  v.literal("ep"),
);

export const STAGE_ORDER = [
  "writing",
  "demo",
  "tracking",
  "editing",
  "mixing",
  "mastering",
  "delivered",
  "released",
] as const;

export const list = query({
  args: { stage: v.optional(stageV), kind: v.optional(kindV), search: v.optional(v.string()) },
  handler: async (ctx, { stage, kind, search }) => {
    const orgId = await currentOrg(ctx);
    let rows;
    if (search && search.trim()) {
      rows = await ctx.db
        .query("songs")
        .withSearchIndex("search_title", (q) => q.search("title", search).eq("orgId", orgId))
        .take(60);
    } else if (stage) {
      rows = await ctx.db
        .query("songs")
        .withIndex("by_org_stage", (q) => q.eq("orgId", orgId).eq("stage", stage))
        .collect();
    } else {
      rows = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    }
    if (kind) rows = rows.filter((r) => r.kind === kind);

    const artistIds = [...new Set(rows.map((r) => r.artistId))];
    const artists = new Map(
      (await Promise.all(artistIds.map((id) => ctx.db.get(id)))).filter(Boolean).map((a) => [a!._id, a!]),
    );
    return rows
      .map((r) => ({ ...r, artistName: artists.get(r.artistId)?.name ?? "Unknown" }))
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

export const byStage = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const counts: Record<string, number> = {};
    for (const s of STAGE_ORDER) counts[s] = 0;
    for (const r of rows) counts[r.stage] = (counts[r.stage] ?? 0) + 1;
    return counts;
  },
});

export const get = query({
  args: { id: v.id("songs") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) return null;

    const [artist, sessions, deliverables, comments, split, campaign, syncs] = await Promise.all([
      ctx.db.get(song.artistId),
      ctx.db.query("sessions").withIndex("by_song", (q) => q.eq("songId", id)).collect(),
      ctx.db.query("deliverables").withIndex("by_song", (q) => q.eq("songId", id)).collect(),
      ctx.db.query("revisionComments").withIndex("by_song", (q) => q.eq("songId", id)).collect(),
      ctx.db.query("splitSheets").withIndex("by_song", (q) => q.eq("songId", id)).first(),
      ctx.db.query("releaseCampaigns").withIndex("by_song", (q) => q.eq("songId", id)).first(),
      ctx.db.query("syncOpportunities").withIndex("by_song", (q) => q.eq("songId", id)).collect(),
    ]);

    return {
      ...song,
      artist,
      sessions: sessions.sort((a, b) => a.startTime - b.startTime),
      deliverables: deliverables.sort((a, b) => b.version - a.version),
      openComments: comments.filter((c) => !c.resolved).length,
      split,
      campaign,
      syncs,
    };
  },
});

export const picker = query({
  args: { artistId: v.optional(v.id("artists")) },
  handler: async (ctx, { artistId }) => {
    const orgId = await currentOrg(ctx);
    let rows = await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    if (artistId) rows = rows.filter((r) => r.artistId === artistId);
    return rows.map((r) => ({ _id: r._id, title: r.title, stage: r.stage }));
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    artistId: v.id("artists"),
    kind: kindV,
    genre: v.optional(v.string()),
    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
    mode: v.optional(v.string()),
    brief: v.optional(v.string()),
    revisionsIncluded: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(args.artistId);
    if (!artist || artist.orgId !== orgId) throw new Error("Artist not found");
    const id = await ctx.db.insert("songs", {
      orgId,
      title: args.title,
      artistId: args.artistId,
      kind: args.kind,
      stage: "writing",
      genre: args.genre,
      bpm: args.bpm,
      musicalKey: args.musicalKey,
      mode: args.mode,
      moodTags: [],
      brief: args.brief,
      referenceTracks: [],
      revisionsIncluded: args.revisionsIncluded ?? 3,
      revisionsUsed: 0,
      specStatus: args.kind === "spec" ? "idea" : undefined,
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "song.created",
      summary: `New song "${args.title}" started for ${artist.name}`,
      entityType: "song",
      entityId: id,
      accent: "gold",
    });
    return id;
  },
});

export const advanceStage = mutation({
  args: { id: v.id("songs"), stage: stageV },
  handler: async (ctx, { id, stage }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { stage });
    await ctx.db.insert("activity", {
      orgId,
      kind: "song.stage",
      summary: `"${song.title}" moved to ${stage}`,
      entityType: "song",
      entityId: id,
      accent: stage === "released" ? "positive" : "info",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("songs"),
    title: v.optional(v.string()),
    genre: v.optional(v.string()),
    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
    mode: v.optional(v.string()),
    brief: v.optional(v.string()),
    isrc: v.optional(v.string()),
    iswc: v.optional(v.string()),
    moodTags: v.optional(v.array(v.string())),
    revisionsIncluded: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");

    // Metadata vault: enforce ISRC uniqueness within the org.
    if (patch.isrc) {
      const dupe = (
        await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
      ).find((s) => s._id !== id && s.isrc === patch.isrc);
      if (dupe) throw new Error(`ISRC ${patch.isrc} is already assigned to "${dupe.title}"`);
    }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    await ctx.db.patch(id, clean);
  },
});

export const addReferenceTrack = mutation({
  args: { id: v.id("songs"), title: v.string(), url: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { id, title, url, note }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { referenceTracks: [...song.referenceTracks, { title, url, note }] });
  },
});

export const remove = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
