import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

const stageV = v.union(
  v.literal("inquiry"),
  v.literal("qualified"),
  v.literal("proposal"),
  v.literal("booked"),
  v.literal("in_progress"),
  v.literal("delivered"),
  v.literal("won"),
  v.literal("lost"),
);
const serviceV = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
);

export const PIPELINE_STAGES = [
  "inquiry",
  "qualified",
  "proposal",
  "booked",
  "in_progress",
  "delivered",
  "won",
] as const;

/** All open opportunities, hydrated with the artist name, grouped-ready. */
export const board = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("opportunities")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const artistIds = [...new Set(rows.map((r) => r.artistId))];
    const artists = new Map(
      (await Promise.all(artistIds.map((id) => ctx.db.get(id))))
        .filter(Boolean)
        .map((a) => [a!._id, a!]),
    );
    return rows
      .map((r) => ({
        ...r,
        artistName: artists.get(r.artistId)?.name ?? "Unknown",
        artistType: artists.get(r.artistId)?.type ?? "other",
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** Weighted pipeline metrics for the dashboard / summary bar. */
export const metrics = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("opportunities")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const open = rows.filter((r) => r.stage !== "won" && r.stage !== "lost");
    const totalValue = open.reduce((s, r) => s + r.valueCents, 0);
    const weightedValue = open.reduce((s, r) => s + r.valueCents * r.probability, 0);
    const won = rows.filter((r) => r.stage === "won").length;
    const lost = rows.filter((r) => r.stage === "lost").length;
    const closed = won + lost;
    return {
      openCount: open.length,
      totalValue,
      weightedValue: Math.round(weightedValue),
      winRate: closed ? won / closed : 0,
    };
  },
});

export const get = query({
  args: { id: v.id("opportunities") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const opp = await ctx.db.get(id);
    if (!opp || opp.orgId !== orgId) return null;
    const [artist, song] = await Promise.all([
      ctx.db.get(opp.artistId),
      opp.songId ? ctx.db.get(opp.songId) : null,
    ]);
    return { ...opp, artist, songTitle: song?.title ?? null };
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    artistId: v.id("artists"),
    serviceType: serviceV,
    valueCents: v.number(),
    source: v.optional(v.string()),
    songId: v.optional(v.id("songs")),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrg(ctx);
    const artist = await ctx.db.get(args.artistId);
    if (!artist || artist.orgId !== orgId) throw new Error("Artist not found");
    const id = await ctx.db.insert("opportunities", {
      orgId,
      title: args.title,
      artistId: args.artistId,
      stage: "inquiry",
      valueCents: args.valueCents,
      serviceType: args.serviceType,
      probability: 0.1,
      source: args.source,
      songId: args.songId,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("activity", {
      orgId,
      kind: "opportunity.created",
      summary: `New inquiry - ${args.title}`,
      entityType: "opportunity",
      entityId: id,
      accent: "gold",
    });
    return id;
  },
});

/** Default win-probability per stage - used on stage moves. */
const STAGE_PROBABILITY: Record<string, number> = {
  inquiry: 0.1,
  qualified: 0.25,
  proposal: 0.45,
  booked: 0.7,
  in_progress: 0.85,
  delivered: 0.95,
  won: 1,
  lost: 0,
};

export const moveStage = mutation({
  args: { id: v.id("opportunities"), stage: stageV },
  handler: async (ctx, { id, stage }) => {
    const orgId = await currentOrg(ctx);
    const opp = await ctx.db.get(id);
    if (!opp || opp.orgId !== orgId) throw new Error("Not found");
    await ctx.db.patch(id, {
      stage,
      probability: STAGE_PROBABILITY[stage] ?? opp.probability,
      updatedAt: Date.now(),
    });
    const artist = await ctx.db.get(opp.artistId);
    await ctx.db.insert("activity", {
      orgId,
      kind: "opportunity.stage",
      summary:
        stage === "won"
          ? `Deal won - ${opp.title} (${artist?.name ?? "client"})`
          : stage === "lost"
            ? `Deal lost - ${opp.title}`
            : `${opp.title} moved to ${stage.replace("_", " ")}`,
      entityType: "opportunity",
      entityId: id,
      accent: stage === "won" ? "positive" : stage === "lost" ? "critical" : "info",
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("opportunities"),
    title: v.optional(v.string()),
    valueCents: v.optional(v.number()),
    probability: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const opp = await ctx.db.get(id);
    if (!opp || opp.orgId !== orgId) throw new Error("Not found");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(id, { ...clean, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("opportunities") },
  handler: async (ctx, { id }) => {
    const orgId = await currentOrg(ctx);
    const opp = await ctx.db.get(id);
    if (!opp || opp.orgId !== orgId) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
