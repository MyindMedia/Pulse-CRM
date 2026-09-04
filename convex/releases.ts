import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { currentOrg, assertOrg, currentOrgWithCapability} from "./lib/tenant";
import { isReleasable } from "./lib/guardrails";

/** The standard pre-built rollout - offsets are days relative to release day. */
const DEFAULT_TASKS = [
  { label: "Announce the release date", offsetDays: -14, done: false },
  { label: "Teaser clip #1", offsetDays: -12, done: false },
  { label: "Behind-the-scenes post", offsetDays: -9, done: false },
  { label: "Open pre-save / pre-order", offsetDays: -7, done: false },
  { label: "Email the fan list", offsetDays: -6, done: false },
  { label: "Teaser clip #2", offsetDays: -4, done: false },
  { label: "Cover-art reveal", offsetDays: -2, done: false },
  { label: "Release day - all platforms live", offsetDays: 0, done: false },
  { label: "Release-day SMS blast", offsetDays: 0, done: false },
  { label: "Thank-you + momentum post", offsetDays: 2, done: false },
  { label: "Playlist pitch follow-up", offsetDays: 5, done: false },
  { label: "First-week numbers recap", offsetDays: 7, done: false },
] as const;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("releaseCampaigns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const songIds = [...new Set(rows.map((r) => r.songId))];
    const songs = new Map(
      (await Promise.all(songIds.map((id) => ctx.db.get(id))))
        .filter(Boolean)
        .map((s) => [s!._id, s!]),
    );
    const artistIds = [...new Set([...songs.values()].map((s) => s.artistId))];
    const artists = new Map(
      (await Promise.all(artistIds.map((id) => ctx.db.get(id))))
        .filter(Boolean)
        .map((a) => [a!._id, a!]),
    );
    return rows
      .map((r) => {
        const song = songs.get(r.songId);
        const done = r.tasks.filter((t) => t.done).length;
        return {
          ...r,
          songTitle: song?.title ?? "Unknown",
          artistName: song ? (artists.get(song.artistId)?.name ?? "Unknown") : "Unknown",
          progress: r.tasks.length ? done / r.tasks.length : 0,
          taskCount: r.tasks.length,
          doneCount: done,
        };
      })
      .sort((a, b) => a.releaseDate - b.releaseDate);
  },
});

export const forSong = query({
  args: { songId: v.id("songs") },
  handler: async (ctx, { songId }) => {
    const orgId = await currentOrg(ctx);
    const row = await ctx.db
      .query("releaseCampaigns")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .first();
    return row && row.orgId === orgId ? row : null;
  },
});

export const create = mutation({
  args: { songId: v.id("songs"), releaseDate: v.number() },
  handler: async (ctx, { songId, releaseDate }) => {
    const orgId = await currentOrgWithCapability(ctx, "releases.edit");
    const song = await ctx.db.get(songId);
    assertOrg(song, orgId);
    const id = await ctx.db.insert("releaseCampaigns", {
      orgId,
      songId,
      releaseDate,
      status: "planning",
      tasks: DEFAULT_TASKS.map((t) => ({ ...t })),
    });
    await ctx.db.patch(songId, { releaseDate });
    await ctx.db.insert("activity", {
      orgId,
      kind: "campaign.created",
      summary: `Release campaign built for "${song.title}"`,
      entityType: "song",
      entityId: songId,
      accent: "gold",
    });
    return id;
  },
});

export const toggleTask = mutation({
  args: { id: v.id("releaseCampaigns"), index: v.number() },
  handler: async (ctx, { id, index }) => {
    const orgId = await currentOrgWithCapability(ctx, "releases.edit");
    const campaign = await ctx.db.get(id);
    assertOrg(campaign, orgId);
    const tasks = campaign.tasks.map((t, i) => (i === index ? { ...t, done: !t.done } : t));
    await ctx.db.patch(id, { tasks });
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("releaseCampaigns"),
    status: v.union(v.literal("planning"), v.literal("active"), v.literal("released")),
  },
  handler: async (ctx, { id, status }) => {
    const orgId = await currentOrgWithCapability(ctx, "releases.edit");
    const campaign = await ctx.db.get(id);
    assertOrg(campaign, orgId);
    if (status === "released") {
      // Same hard split-sheet gate as songs.advanceStage - a campaign cannot
      // flip a song live without executed splits.
      const sheet = await ctx.db
        .query("splitSheets")
        .withIndex("by_song", (q) => q.eq("songId", campaign.songId))
        .first();
      if (!isReleasable("released", sheet?.status)) {
        throw new Error(
          "Cannot mark this campaign released: the song's split sheet is not fully executed. Lock every contributor's split first to avoid frozen royalties and takedown risk.",
        );
      }
    }
    await ctx.db.patch(id, { status });
    if (status === "released") {
      const song = await ctx.db.get(campaign.songId);
      if (song) await ctx.db.patch(campaign.songId, { stage: "released" });
      await ctx.db.insert("activity", {
        orgId,
        kind: "campaign.released",
        summary: `"${song?.title ?? "Track"}" is live - campaign moved to released`,
        entityType: "song",
        entityId: campaign.songId,
        accent: "positive",
      });
    }
  },
});
