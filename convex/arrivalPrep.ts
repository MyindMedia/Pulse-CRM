import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";

/* ============================================================
   Arrival prep - the front-desk checklist for upcoming client
   arrivals. One row per session holds which steps are done, so
   every staffer sees the same prep state live. Steps are a
   fixed allowlist; the dashboard widget renders them.
   ============================================================ */

export const PREP_STEPS = ["details", "parking", "room", "welcome"] as const;

const stepV = v.union(
  v.literal("details"),
  v.literal("parking"),
  v.literal("room"),
  v.literal("welcome"),
);

/** Prep state for a set of sessions (the widget passes the upcoming ones).
 *  Returns { [sessionId]: doneSteps[] } - sessions with no row are simply
 *  absent (nothing done yet). */
export const forSessions = query({
  args: { sessionIds: v.array(v.id("sessions")) },
  handler: async (ctx, { sessionIds }) => {
    const orgId = await currentOrg(ctx);
    const out: Record<string, string[]> = {};
    for (const sessionId of sessionIds.slice(0, 24)) {
      const row = await ctx.db
        .query("arrivalPrep")
        .withIndex("by_org_session", (q) => q.eq("orgId", orgId).eq("sessionId", sessionId))
        .first();
      if (row) out[sessionId] = row.done;
    }
    return out;
  },
});

/** Mark a prep step done / not done for a session in the caller's org. */
export const setStep = mutation({
  args: { sessionId: v.id("sessions"), step: stepV, done: v.boolean() },
  handler: async (ctx, { sessionId, step, done }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) throw new Error("Session not found");

    const row = await ctx.db
      .query("arrivalPrep")
      .withIndex("by_org_session", (q) => q.eq("orgId", orgId).eq("sessionId", sessionId))
      .first();

    const current = new Set(row?.done ?? []);
    if (done) current.add(step);
    else current.delete(step);
    const next = [...current];

    if (row) await ctx.db.patch(row._id, { done: next });
    else await ctx.db.insert("arrivalPrep", { orgId, sessionId, done: next });
    return { done: next };
  },
});
