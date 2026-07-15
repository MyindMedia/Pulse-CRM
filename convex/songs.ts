import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg, currentOrgWithCapability} from "./lib/tenant";
import { isReleasable } from "./lib/guardrails";

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
    return (
      await Promise.all(
        rows.map(async (r) => ({
          ...r,
          artistName: artists.get(r.artistId)?.name ?? "Unknown",
          coverUrl: r.coverArtId ? await ctx.storage.getUrl(r.coverArtId) : null,
        })),
      )
    ).sort((a, b) => b._creationTime - a._creationTime);
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
      coverUrl: song.coverArtId ? await ctx.storage.getUrl(song.coverArtId) : null,
      sessions: sessions.sort((a, b) => a.startTime - b.startTime),
      deliverables: deliverables.sort((a, b) => b.version - a.version),
      openComments: comments.filter((c) => !c.resolved).length,
      split,
      campaign,
      syncs,
    };
  },
});

/**
 * Aggregate snapshot for the Song Workspace overview card: stage, owner,
 * deadline, linked client, the open balance across the song's sessions, and a
 * derived next-action heuristic. Returns null when the song is out of org.
 */
export const overview = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(songId);
    if (!song || song.orgId !== orgId) return null;

    const [artist, owner, sessions, split] = await Promise.all([
      ctx.db.get(song.artistId),
      song.ownerMemberId ? ctx.db.get(song.ownerMemberId) : Promise.resolve(null),
      ctx.db.query("sessions").withIndex("by_song", (q) => q.eq("songId", songId)).collect(),
      ctx.db.query("splitSheets").withIndex("by_song", (q) => q.eq("songId", songId)).first(),
    ]);

    // Open balance = sum of what's still owed across the song's sessions.
    // Outstanding mirrors payments.ts: rateCents - amountPaidCents, floored at 0.
    let openBalanceCents = 0;
    for (const s of sessions) {
      openBalanceCents += Math.max(0, s.rateCents - (s.amountPaidCents ?? 0));
    }

    // Has any completed session that has not yet produced a recap artifact?
    const completed = sessions.filter((s) => s.status === "completed");
    let completedAwaitingRecap = false;
    for (const s of completed) {
      const recap = await ctx.db
        .query("aiArtifacts")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .filter((q) => q.eq(q.field("kind"), "session_recap"))
        .first();
      if (!recap) {
        completedAwaitingRecap = true;
        break;
      }
    }

    const splitIncomplete = !split || split.status === "draft";

    // Next-action heuristic, in priority order.
    let nextAction: string;
    if (openBalanceCents > 0) nextAction = "Collect balance";
    else if (completedAwaitingRecap) nextAction = "Send recap";
    else if (splitIncomplete) nextAction = "Complete split sheet";
    else nextAction = "On track";

    return {
      songId,
      stage: song.stage,
      deadline: song.deadline,
      ownerMemberId: song.ownerMemberId ?? null,
      ownerName: owner?.name ?? null,
      clientId: artist?._id ?? null,
      clientName: artist?.name ?? null,
      openBalanceCents,
      sessionCount: sessions.length,
      splitStatus: split?.status ?? null,
      nextAction,
    };
  },
});

/**
 * AI activity for a song: artifacts generated against the song's sessions,
 * org-level artifacts (no session link), and insights pinned to the song or
 * one of its sessions. Newest-first, with the source tag preserved so the UI
 * can badge openai vs fallback. Dismissed items are hidden.
 */
export const aiActivity = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const song = await ctx.db.get(songId);
    if (!song || song.orgId !== orgId) return { artifacts: [], insights: [] };

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .collect();
    const sessionIds = new Set(sessions.map((s) => s._id as string));

    // Per-session artifacts.
    const sessionArtifacts = (
      await Promise.all(
        sessions.map((s) =>
          ctx.db
            .query("aiArtifacts")
            .withIndex("by_session", (q) => q.eq("sessionId", s._id))
            .collect(),
        ),
      )
    ).flat();

    // Org-level artifacts that aren't tied to a specific session (weekly
    // briefings, reactivation campaigns, etc.) - relevant context for the song.
    const orgArtifacts = (
      await ctx.db.query("aiArtifacts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    ).filter((a) => a.sessionId == null);

    const seen = new Set<string>();
    const artifacts = [...sessionArtifacts, ...orgArtifacts]
      .filter((a) => a.orgId === orgId && a.status !== "dismissed")
      .filter((a) => (seen.has(a._id) ? false : (seen.add(a._id), true)))
      .sort((a, b) => b.generatedAt - a.generatedAt)
      .map((a) => ({
        _id: a._id,
        kind: a.kind,
        title: a.title,
        summary: a.summary,
        source: a.source,
        model: a.model ?? null,
        status: a.status,
        generatedAt: a.generatedAt,
        scope: a.sessionId ? ("session" as const) : ("org" as const),
      }));

    // Insights pinned to this song or one of its sessions.
    const insights = (
      await ctx.db.query("insights").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
    )
      .filter((i) => {
        if (i.status === "dismissed") return false;
        if (i.entityType === "song" && i.entityId === (songId as string)) return true;
        if (i.entityType === "session" && i.entityId && sessionIds.has(i.entityId)) return true;
        return false;
      })
      .sort((a, b) => b._creationTime - a._creationTime)
      .map((i) => ({
        _id: i._id,
        kind: i.kind,
        title: i.title,
        body: i.body,
        severity: i.severity,
        status: i.status,
        createdAt: i._creationTime,
      }));

    return { artifacts, insights };
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
    const orgId = await currentOrgWithCapability(ctx, "songs.edit");
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
    const orgId = await currentOrgWithCapability(ctx, "songs.edit");
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");
    // Safeguard: never release a song without an executed split sheet. An
    // unresolved split freezes royalties and invites takedowns, so this is a
    // hard gate, not a soft warning.
    if (stage === "released") {
      const sheet = await ctx.db
        .query("splitSheets")
        .withIndex("by_song", (q) => q.eq("songId", id))
        .first();
      if (!isReleasable(stage, sheet?.status)) {
        throw new Error(
          "Cannot release this song: its split sheet is not fully executed. Lock every contributor's split first to avoid frozen royalties and takedown risk.",
        );
      }
    }
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
    deadline: v.optional(v.union(v.number(), v.null())),
    ownerMemberId: v.optional(v.union(v.id("members"), v.null())),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrgWithCapability(ctx, "songs.edit");
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");

    // Owner must be a member of this org (when set).
    if (patch.ownerMemberId) {
      const owner = await ctx.db.get(patch.ownerMemberId);
      if (!owner || owner.orgId !== orgId) throw new Error("Owner not found");
    }

    // Metadata vault: enforce ISRC uniqueness within the org.
    if (patch.isrc) {
      const dupe = (
        await ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect()
      ).find((s) => s._id !== id && s.isrc === patch.isrc);
      if (dupe) throw new Error(`ISRC ${patch.isrc} is already assigned to "${dupe.title}"`);
    }
    // Drop keys the caller did not send (undefined). A passed `null` is an
    // explicit clear -> map to `undefined` so db.patch removes the field.
    const clean = Object.fromEntries(
      Object.entries(patch)
        .filter(([, val]) => val !== undefined)
        .map(([k, val]) => [k, val === null ? undefined : val]),
    );
    await ctx.db.patch(id, clean);
  },
});

/** Upload target for manual cover art (the PhotoUpload component's pattern). */
export const generateCoverUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await currentOrgWithCapability(ctx, "songs.edit");
    return ctx.storage.generateUploadUrl();
  },
});

export const setCoverArt = mutation({
  args: { id: v.id("songs"), storageId: v.union(v.id("_storage"), v.null()) },
  handler: async (ctx, { id, storageId }) => {
    const orgId = await currentOrgWithCapability(ctx, "songs.edit");
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { coverArtId: storageId ?? undefined });
  },
});

export const addReferenceTrack = mutation({
  args: { id: v.id("songs"), title: v.string(), url: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { id, title, url, note }) => {
    const orgId = await currentOrgWithCapability(ctx, "songs.edit");
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, { referenceTracks: [...song.referenceTracks, { title, url, note }] });
  },
});

export const remove = mutation({
  args: { id: v.id("songs") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrgWithCapability(ctx, "songs.delete");
    const song = await ctx.db.get(id);
    if (!song || song.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
