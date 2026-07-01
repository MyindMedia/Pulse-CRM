import { query } from "./_generated/server";
import { v } from "convex/values";
import { Doc } from "./_generated/dataModel";
import { resolveViewer } from "./lib/access";
import { DEMO_ORG } from "./lib/tenant";

/* ============================================================
   Today - the operator command center. One query that answers
   "what is happening in the studio right now?" for the current
   day: sessions in time order, room busy-until, next arrivals,
   balances due today, who's on shift, and a tomorrow teaser.

   Everything is computed server-side against a single `now`
   (Date.now() by default; an explicit `nowMs` makes it testable),
   org-scoped, and gated to studio members through resolveViewer.
   ============================================================ */

const DAY = 86_400_000;
const PRE_WINDOW_MS = 5 * 60 * 1000; // a session "starting soon" already occupies its room
const BUFFER_MS = 15 * 60 * 1000; // reset buffer between bookings (mirror roomStatus)

/** Sessions in these states occupy a room / count as live work. */
const ACTIVE_STATUSES: Doc<"sessions">["status"][] = ["confirmed", "in_progress"];
/** Sessions that never happened - excluded from timeline math. */
const DEAD_STATUSES: Doc<"sessions">["status"][] = ["cancelled", "no_show"];

/** Local midnight for the day containing `ts`. */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const today = query({
  args: { nowMs: v.optional(v.number()) },
  handler: async (ctx, { nowMs }) => {
    const viewer = await resolveViewer(ctx);
    const orgId = viewer.orgId ?? DEMO_ORG;
    // Balances are money - leadership-only, mirroring dashboard.overview.
    const canSeeFinancials = viewer.capabilities.has("invoices.read");

    const now = nowMs ?? Date.now();
    const dayStart = startOfDay(now);
    const dayEnd = dayStart + DAY; // exclusive
    const tomorrowStart = dayEnd;
    const tomorrowEnd = tomorrowStart + DAY;

    // One indexed sweep covers today + tomorrow (so the teaser is free).
    const windowSessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", dayStart).lt("startTime", tomorrowEnd),
      )
      .collect();

    const todaysRaw = windowSessions
      .filter((s) => s.startTime >= dayStart && s.startTime < dayEnd)
      .sort((a, b) => a.startTime - b.startTime);

    // Hydrate names once for today's sessions.
    const sessions = await Promise.all(
      todaysRaw.map(async (s) => {
        const [artist, room, engineer] = await Promise.all([
          ctx.db.get(s.artistId),
          s.roomId ? ctx.db.get(s.roomId) : null,
          s.engineerId ? ctx.db.get(s.engineerId) : null,
        ]);
        const outstandingCents = Math.max(0, s.rateCents - (s.amountPaidCents ?? 0));
        return {
          _id: s._id,
          title: s.title,
          clientName: artist?.name ?? "Unknown",
          roomId: s.roomId ?? null,
          roomName: room?.name ?? null,
          engineerName: engineer?.name ?? null,
          serviceType: s.serviceType,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status,
          rateCents: canSeeFinancials ? s.rateCents : null,
          outstandingCents: canSeeFinancials ? outstandingCents : null,
        };
      }),
    );

    // ── Rooms + per-room busy-until ──
    // For each room, find a currently-live/soon session (active status, its
    // window - minus pre-window, plus reset buffer - straddles `now`) and take
    // its end time as "busy until". Rooms with no live session read as free.
    const rooms = await ctx.db
      .query("rooms")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const now_ = now;
    const roomStatus = rooms
      .filter((r) => r.status !== "retired")
      .map((r) => {
        const live = todaysRaw
          .filter(
            (s) =>
              s.roomId === r._id &&
              ACTIVE_STATUSES.includes(s.status) &&
              s.startTime - PRE_WINDOW_MS <= now_ &&
              s.endTime + BUFFER_MS >= now_,
          )
          .sort((a, b) => b.endTime - a.endTime)[0];
        // Next session still to come in this room today (for the "free until" hint).
        const nextUp = todaysRaw
          .filter(
            (s) =>
              s.roomId === r._id &&
              !DEAD_STATUSES.includes(s.status) &&
              s.startTime > now_,
          )
          .sort((a, b) => a.startTime - b.startTime)[0];
        return {
          roomId: r._id,
          roomName: r.name,
          status: r.status,
          busyUntil: live ? live.endTime : null,
          busyWith: live ? live.title : null,
          nextStart: nextUp ? nextUp.startTime : null,
        };
      });

    // ── Next arrivals - today's sessions not yet started / checked in ──
    const arrivals = sessions
      .filter(
        (s) =>
          s.startTime > now &&
          (s.status === "tentative" || s.status === "confirmed"),
      )
      .slice(0, 8);

    // ── Balances due today ──
    const dueList = canSeeFinancials
      ? sessions.filter(
          (s) => !DEAD_STATUSES.includes(s.status) && (s.outstandingCents ?? 0) > 0,
        )
      : [];
    const balancesDueCents = canSeeFinancials
      ? dueList.reduce((sum, s) => sum + (s.outstandingCents ?? 0), 0)
      : null;

    // ── Staff on shift today ──
    // Shifts whose window intersects today (a shift can start yesterday and
    // run into today, so we widen the index scan by a day and clip).
    const shiftRows = await ctx.db
      .query("shifts")
      .withIndex("by_org_start", (q) =>
        q.eq("orgId", orgId).gte("startTime", dayStart - DAY).lt("startTime", dayEnd),
      )
      .collect();
    const onShiftRaw = shiftRows
      .filter(
        (sh) =>
          sh.status !== "cancelled" &&
          sh.startTime < dayEnd &&
          sh.endTime > dayStart,
      )
      .sort((a, b) => a.startTime - b.startTime);
    const staffOnShift = await Promise.all(
      onShiftRaw.map(async (sh) => {
        const [member, room] = await Promise.all([
          ctx.db.get(sh.memberId),
          sh.roomId ? ctx.db.get(sh.roomId) : null,
        ]);
        return {
          _id: sh._id,
          memberName: member?.name ?? "-",
          memberRole: member?.role ?? null,
          roomName: room?.name ?? null,
          startTime: sh.startTime,
          endTime: sh.endTime,
          onNow: sh.startTime <= now && sh.endTime >= now,
        };
      }),
    );

    // ── Tomorrow teaser ──
    const tomorrowSessions = windowSessions
      .filter(
        (s) =>
          s.startTime >= tomorrowStart &&
          s.startTime < tomorrowEnd &&
          !DEAD_STATUSES.includes(s.status),
      )
      .sort((a, b) => a.startTime - b.startTime);
    const tomorrow = {
      count: tomorrowSessions.length,
      firstStart: tomorrowSessions.length ? tomorrowSessions[0].startTime : null,
    };

    // ── Day-at-a-glance counters ──
    const liveCount = sessions.filter((s) => s.status === "in_progress").length;
    const remainingCount = sessions.filter(
      (s) => s.startTime > now && !DEAD_STATUSES.includes(s.status),
    ).length;

    return {
      now,
      dayStart,
      canSeeFinancials,
      counts: {
        sessionsToday: sessions.filter((s) => !DEAD_STATUSES.includes(s.status)).length,
        live: liveCount,
        remaining: remainingCount,
        arrivals: arrivals.length,
        staffOnShift: staffOnShift.filter((s) => s.onNow).length,
      },
      sessions,
      rooms: roomStatus,
      arrivals,
      balances: {
        dueCents: balancesDueCents,
        count: dueList.length,
        list: dueList,
      },
      staffOnShift,
      tomorrow,
    };
  },
});
