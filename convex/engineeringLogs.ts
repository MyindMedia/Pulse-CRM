import { query } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { currentOrg, assertOrg } from "./lib/tenant";

const signalChainV = v.object({
  track: v.string(),
  source: v.string(),
  mic: v.optional(v.string()),
  preamp: v.optional(v.string()),
  outboard: v.optional(v.string()),
  input: v.optional(v.string()),
  micPosition: v.optional(v.string()),
});

export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const log = await ctx.db
      .query("engineeringLogs")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    return log && log.orgId === orgId ? log : null;
  },
});

/** Create or update the recall sheet for a session. */
export const save = mutation({
  args: {
    sessionId: v.id("sessions"),
    sampleRate: v.optional(v.string()),
    bitDepth: v.optional(v.string()),
    tuningRef: v.optional(v.string()),
    monitoring: v.optional(v.string()),
    tempoMap: v.optional(v.string()),
    signalChains: v.optional(v.array(signalChainV)),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, ...patch }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    assertOrg(session, orgId);

    const existing = await ctx.db
      .query("engineeringLogs")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .first();
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));

    if (existing && existing.orgId === orgId) {
      await ctx.db.patch(existing._id, { ...clean, updatedAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("engineeringLogs", {
      orgId,
      sessionId,
      songId: session.songId,
      sampleRate: patch.sampleRate,
      bitDepth: patch.bitDepth,
      tuningRef: patch.tuningRef,
      monitoring: patch.monitoring,
      tempoMap: patch.tempoMap,
      signalChains: patch.signalChains ?? [],
      notes: patch.notes,
      updatedAt: Date.now(),
    });
  },
});
