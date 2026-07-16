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
export const WRAP_STEPS = ["files", "billing", "gear", "notes"] as const;
export const REFRESH_STEPS = ["reset", "refresh", "zero", "stage"] as const;

const stepV = v.union(
  // Arrival prep
  v.literal("details"),
  v.literal("parking"),
  v.literal("room"),
  v.literal("welcome"),
  // Session wrap-up
  v.literal("files"),
  v.literal("billing"),
  v.literal("gear"),
  v.literal("notes"),
  // Studio refresh / turnover
  v.literal("reset"),
  v.literal("refresh"),
  v.literal("zero"),
  v.literal("stage"),
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

/** Sessions in their wrap-up window: ending within the next 45 minutes or
 *  ended within the last 45 (in progress / confirmed / completed). Each row
 *  carries the NEXT session in the same room within 2h of the end - the
 *  studio-refresh target. */
export const wrapping = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const now = Date.now();
    const WINDOW = 45 * 60_000;
    // Sessions rarely run longer than 12h - a bounded index window.
    const candidates = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", now - 12 * 3_600_000).lte("startTime", now + WINDOW),
      )
      .collect();
    const wrappingRows = candidates
      .filter(
        (s) =>
          ["in_progress", "confirmed", "completed"].includes(s.status) &&
          s.endTime >= now - WINDOW &&
          s.endTime <= now + WINDOW,
      )
      .sort((a, b) => a.endTime - b.endTime)
      .slice(0, 4);

    return Promise.all(
      wrappingRows.map(async (s) => {
        const [artist, room] = await Promise.all([
          s.artistId ? ctx.db.get(s.artistId) : null,
          s.roomId ? ctx.db.get(s.roomId) : null,
        ]);
        // The refresh target: next booking in the same room within 2h.
        let next: { artistName: string; startTime: number } | null = null;
        if (s.roomId) {
          const upcoming = await ctx.db
            .query("sessions")
            .withIndex("by_org_start", (q) =>
              q.eq("orgId", orgId).gte("startTime", s.endTime).lte("startTime", s.endTime + 2 * 3_600_000),
            )
            .collect();
          const candidate = upcoming
            .filter((n) => n.roomId === s.roomId && n._id !== s._id && n.status !== "cancelled")
            .sort((a, b) => a.startTime - b.startTime)[0];
          if (candidate) {
            const nextArtist = candidate.artistId ? await ctx.db.get(candidate.artistId) : null;
            next = { artistName: nextArtist?.name ?? "Next client", startTime: candidate.startTime };
          }
        }
        return {
          _id: s._id,
          title: s.title,
          status: s.status,
          startTime: s.startTime,
          endTime: s.endTime,
          artistName: artist?.name ?? "Unknown",
          roomName: room?.name ?? null,
          next,
        };
      }),
    );
  },
});

/** Everything the Pre-session brief page needs for one session: the booking
 *  (artist, room, engineer, times), the live checklist with its
 *  accountability trail, the studio's require-all policy, and the next
 *  booking in the room (the refresh target). */
export const brief = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const s = await ctx.db.get(sessionId);
    if (!s || s.orgId !== orgId) return null;

    const [artist, room, engineer, org, prep] = await Promise.all([
      s.artistId ? ctx.db.get(s.artistId) : null,
      s.roomId ? ctx.db.get(s.roomId) : null,
      s.engineerId ? ctx.db.get(s.engineerId) : null,
      ctx.db
        .query("orgs")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .first(),
      ctx.db
        .query("arrivalPrep")
        .withIndex("by_org_session", (q) => q.eq("orgId", orgId).eq("sessionId", sessionId))
        .first(),
    ]);

    let next: { artistName: string; startTime: number } | null = null;
    if (s.roomId) {
      const upcoming = await ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gte("startTime", s.endTime).lte("startTime", s.endTime + 2 * 3_600_000),
        )
        .collect();
      const candidate = upcoming
        .filter((n) => n.roomId === s.roomId && n._id !== s._id && n.status !== "cancelled")
        .sort((a, b) => a.startTime - b.startTime)[0];
      if (candidate) {
        const nextArtist = candidate.artistId ? await ctx.db.get(candidate.artistId) : null;
        next = { artistName: nextArtist?.name ?? "Next client", startTime: candidate.startTime };
      }
    }

    return {
      _id: s._id,
      title: s.title,
      status: s.status,
      serviceType: s.serviceType,
      startTime: s.startTime,
      endTime: s.endTime,
      notes: s.notes ?? null,
      artistName: artist?.name ?? "Unknown",
      roomName: room?.name ?? null,
      engineerName: engineer?.name ?? null,
      done: prep?.done ?? [],
      attribution: prep?.attribution ?? [],
      requireAll: org?.briefRequireAll === true,
      next,
    };
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

    // Accountability trail: who checked the step, when. Uncheck clears it.
    const identity = await ctx.auth.getUserIdentity();
    const by = (identity?.name as string) ?? (identity?.email as string) ?? "Staff";
    const attribution = (row?.attribution ?? []).filter((a) => a.step !== step);
    if (done) attribution.push({ step, by, at: Date.now() });

    if (row) await ctx.db.patch(row._id, { done: next, attribution });
    else await ctx.db.insert("arrivalPrep", { orgId, sessionId, done: next, attribution });
    return { done: next };
  },
});
