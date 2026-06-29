import { query } from "./_generated/server";
import { currentOrgWithCapability } from "./lib/tenant";

/* ============================================================
   Revenue Command Center - read-only, org-scoped reporting.
   Five lenses on the same studio data, each computed in a single
   pass so the /reports page makes a handful of round trips.
   Money is integer cents; durations are ms.
   ============================================================ */

const DAY = 86_400_000;

/** Balance still owed on a session (rate minus everything cleared). */
function sessionBalance(s: { rateCents: number; amountPaidCents?: number }) {
  return Math.max(0, s.rateCents - (s.amountPaidCents ?? 0));
}

/* ────────────────────────────────────────────────────────────
   1. Unpaid-balance aging
   Per artist, the outstanding balance across their sessions,
   bucketed by how long the session has been owed (using its
   start time as the age anchor). Sessions that are fully paid,
   cancelled, or still in the future contribute nothing.
   ──────────────────────────────────────────────────────────── */
export const unpaidAging = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const now = Date.now();

    const [artists, sessions] = await Promise.all([
      ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);
    const artistName = new Map(artists.map((a) => [a._id, a.name]));

    type Row = {
      artistId: string;
      artistName: string;
      b0: number; // 0-30d
      b30: number; // 31-60d
      b60: number; // 61-90d
      b90: number; // 90+d
      total: number;
    };
    const rows = new Map<string, Row>();
    const totals = { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 };

    for (const s of sessions) {
      if (s.status === "cancelled") continue;
      if (s.startTime > now) continue; // not yet owed
      const balance = sessionBalance(s);
      if (balance <= 0) continue;

      const ageDays = Math.floor((now - s.startTime) / DAY);
      let row = rows.get(s.artistId);
      if (!row) {
        row = {
          artistId: s.artistId,
          artistName: artistName.get(s.artistId) ?? "Unknown",
          b0: 0,
          b30: 0,
          b60: 0,
          b90: 0,
          total: 0,
        };
        rows.set(s.artistId, row);
      }
      if (ageDays <= 30) {
        row.b0 += balance;
        totals.b0 += balance;
      } else if (ageDays <= 60) {
        row.b30 += balance;
        totals.b30 += balance;
      } else if (ageDays <= 90) {
        row.b60 += balance;
        totals.b60 += balance;
      } else {
        row.b90 += balance;
        totals.b90 += balance;
      }
      row.total += balance;
      totals.total += balance;
    }

    const list = [...rows.values()].sort((a, b) => b.total - a.total);
    return { rows: list, totals };
  },
});

/* ────────────────────────────────────────────────────────────
   2. Room utilization (last 30 days)
   Per room, booked hours against an available-hours baseline.
   Baseline = a working day of 12 bookable hours x 30 days. Only
   non-cancelled sessions whose start falls in the window count,
   clamped to the window so a long-running session doesn't skew.
   ──────────────────────────────────────────────────────────── */
const UTIL_WINDOW_DAYS = 30;
const BOOKABLE_HOURS_PER_DAY = 12;

export const roomUtilization = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const now = Date.now();
    const windowStart = now - UTIL_WINDOW_DAYS * DAY;
    const availableHours = UTIL_WINDOW_DAYS * BOOKABLE_HOURS_PER_DAY;

    const [rooms, sessions] = await Promise.all([
      ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db
        .query("sessions")
        .withIndex("by_org_start", (q) =>
          q.eq("orgId", orgId).gte("startTime", windowStart).lte("startTime", now),
        )
        .collect(),
    ]);

    const bookedMs = new Map<string, number>();
    for (const s of sessions) {
      if (s.status === "cancelled" || !s.roomId) continue;
      const start = Math.max(s.startTime, windowStart);
      const end = Math.min(s.endTime, now);
      const dur = Math.max(0, end - start);
      bookedMs.set(s.roomId, (bookedMs.get(s.roomId) ?? 0) + dur);
    }

    const rows = rooms
      .filter((r) => r.status !== "retired")
      .map((r) => {
        const bookedHours = (bookedMs.get(r._id) ?? 0) / 3_600_000;
        const utilization = availableHours > 0 ? bookedHours / availableHours : 0;
        return {
          roomId: r._id,
          roomName: r.name,
          roomType: r.roomType ?? null,
          bookedHours: Math.round(bookedHours * 10) / 10,
          availableHours,
          utilization, // 0..1
        };
      })
      .sort((a, b) => b.utilization - a.utilization);

    const totalBooked = rows.reduce((s, r) => s + r.bookedHours, 0);
    const totalAvailable = rows.length * availableHours;
    return {
      rows,
      windowDays: UTIL_WINDOW_DAYS,
      bookableHoursPerDay: BOOKABLE_HOURS_PER_DAY,
      avgUtilization: totalAvailable > 0 ? totalBooked / totalAvailable : 0,
    };
  },
});

/* ────────────────────────────────────────────────────────────
   3. Dormant clients
   Artists with no session inside the last 60 days, ranked by
   lifetime value. Each row carries the gap since last contact /
   last session and a 60-vs-90-day band so the page can split them.
   ──────────────────────────────────────────────────────────── */
const DORMANT_MIN_DAYS = 60;

export const dormantClients = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const now = Date.now();

    const [artists, sessions] = await Promise.all([
      ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);

    // Most-recent session start per artist.
    const lastSession = new Map<string, number>();
    for (const s of sessions) {
      if (s.status === "cancelled") continue;
      const prev = lastSession.get(s.artistId) ?? 0;
      if (s.startTime > prev) lastSession.set(s.artistId, s.startTime);
    }

    const rows = artists
      .map((a) => {
        const last = lastSession.get(a._id) ?? a.lastContactAt ?? a._creationTime;
        const daysSince = Math.floor((now - last) / DAY);
        return {
          artistId: a._id,
          artistName: a.name,
          status: a.status,
          lifetimeValueCents: a.lifetimeValueCents,
          sessionCount: a.sessionCount,
          lastActivityAt: last,
          daysSince,
          band: daysSince >= 90 ? ("90+" as const) : ("60-90" as const),
        };
      })
      // Only clients who have actually worked before and have gone quiet.
      .filter((r) => r.daysSince >= DORMANT_MIN_DAYS && r.sessionCount > 0)
      .sort((a, b) => b.lifetimeValueCents - a.lifetimeValueCents);

    return {
      rows,
      count60: rows.length,
      count90: rows.filter((r) => r.daysSince >= 90).length,
      dormantValueCents: rows.reduce((s, r) => s + r.lifetimeValueCents, 0),
    };
  },
});

/* ────────────────────────────────────────────────────────────
   4. No-show risk
   Artists flagged "watch"/"flagged" or with no-show sessions on
   record. A simple additive risk score: reliability band weight
   plus a per-no-show penalty, capped at 100.
   ──────────────────────────────────────────────────────────── */
const RELIABILITY_WEIGHT: Record<string, number> = {
  solid: 0,
  watch: 30,
  flagged: 60,
};
const PER_NO_SHOW = 20;

export const noShowRisk = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");

    const [artists, sessions] = await Promise.all([
      ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);

    const noShowCount = new Map<string, number>();
    for (const s of sessions) {
      if (s.status === "no_show") {
        noShowCount.set(s.artistId, (noShowCount.get(s.artistId) ?? 0) + 1);
      }
    }

    const rows = artists
      .map((a) => {
        const noShows = noShowCount.get(a._id) ?? 0;
        const score = Math.min(
          100,
          (RELIABILITY_WEIGHT[a.reliability] ?? 0) + noShows * PER_NO_SHOW,
        );
        return {
          artistId: a._id,
          artistName: a.name,
          reliability: a.reliability,
          noShows,
          sessionCount: a.sessionCount,
          riskScore: score,
          band:
            score >= 60 ? ("high" as const) : score >= 30 ? ("medium" as const) : ("low" as const),
        };
      })
      // Surface only artists that carry some risk.
      .filter((r) => r.reliability !== "solid" || r.noShows > 0)
      .sort((a, b) => b.riskScore - a.riskScore);

    return {
      rows,
      flaggedCount: rows.filter((r) => r.reliability === "flagged").length,
      watchCount: rows.filter((r) => r.reliability === "watch").length,
      totalNoShows: rows.reduce((s, r) => s + r.noShows, 0),
    };
  },
});

/* ────────────────────────────────────────────────────────────
   5. Lead-source ROI
   Group artists by acquisition source. For each source: lead
   count, booked/won value (lifetime value of those artists plus
   won-opportunity value attributed to the source), and a
   conversion rate (artists with a paid session / total leads).
   ──────────────────────────────────────────────────────────── */
const UNATTRIBUTED = "Unattributed";

export const leadSourceRoi = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");

    const [artists, opportunities] = await Promise.all([
      ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("opportunities").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);
    const artistSource = new Map(artists.map((a) => [a._id, a.source || UNATTRIBUTED]));

    type Agg = {
      source: string;
      leads: number;
      converted: number; // artists with >=1 completed session (sessionCount > 0)
      lifetimeValueCents: number;
      wonValueCents: number;
    };
    const bySource = new Map<string, Agg>();
    const get = (src: string): Agg => {
      let a = bySource.get(src);
      if (!a) {
        a = { source: src, leads: 0, converted: 0, lifetimeValueCents: 0, wonValueCents: 0 };
        bySource.set(src, a);
      }
      return a;
    };

    for (const a of artists) {
      const agg = get(a.source || UNATTRIBUTED);
      agg.leads += 1;
      agg.lifetimeValueCents += a.lifetimeValueCents;
      if (a.sessionCount > 0) agg.converted += 1;
    }

    // Won opportunities add their value to the source. An opportunity's
    // own source wins; otherwise it inherits its artist's source.
    for (const o of opportunities) {
      if (o.stage !== "won" && o.stage !== "booked") continue;
      const src = o.source || artistSource.get(o.artistId) || UNATTRIBUTED;
      get(src).wonValueCents += o.valueCents;
    }

    const rows = [...bySource.values()]
      .map((a) => ({
        ...a,
        conversionRate: a.leads > 0 ? a.converted / a.leads : 0,
      }))
      .sort((x, y) => y.wonValueCents + y.lifetimeValueCents - (x.wonValueCents + x.lifetimeValueCents));

    return {
      rows,
      totalLeads: rows.reduce((s, r) => s + r.leads, 0),
      totalWonValueCents: rows.reduce((s, r) => s + r.wonValueCents, 0),
      totalLifetimeValueCents: rows.reduce((s, r) => s + r.lifetimeValueCents, 0),
    };
  },
});

/* ────────────────────────────────────────────────────────────
   6. Comped revenue loss
   Sessions that were booked and run but never billed - a label or
   the studio owner waived the charge. Each comp carries the value it
   WOULD have billed in `compedValueCents`; we total that forgone
   revenue and break it down by client (who's being comped) and by
   room (where the comps land) so owners see the cost of giving
   sessions away. Cancelled / no-show comps contribute nothing.
   ──────────────────────────────────────────────────────────── */
const COMP_WINDOW_DAYS = 90;

export const compedRevenueLoss = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const now = Date.now();
    const windowStart = now - COMP_WINDOW_DAYS * DAY;

    const [artists, rooms, sessions] = await Promise.all([
      ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ]);
    const artistName = new Map(artists.map((a) => [a._id, a.name]));
    const roomName = new Map(rooms.map((r) => [r._id, r.name]));

    const comped = sessions.filter(
      (s) => s.comped && s.status !== "cancelled" && s.status !== "no_show",
    );

    type ClientRow = { artistId: string; artistName: string; count: number; lossCents: number };
    type RoomRow = { roomId: string; roomName: string; count: number; lossCents: number };
    const byClient = new Map<string, ClientRow>();
    const byRoom = new Map<string, RoomRow>();
    let totalLossCents = 0;
    let windowLossCents = 0;
    let windowCount = 0;

    for (const s of comped) {
      const loss = s.compedValueCents ?? 0;
      totalLossCents += loss;
      if (s.startTime >= windowStart) {
        windowLossCents += loss;
        windowCount += 1;
      }

      const cr =
        byClient.get(s.artistId) ??
        { artistId: s.artistId, artistName: artistName.get(s.artistId) ?? "Unknown", count: 0, lossCents: 0 };
      cr.count += 1;
      cr.lossCents += loss;
      byClient.set(s.artistId, cr);

      if (s.roomId) {
        const rr =
          byRoom.get(s.roomId) ??
          { roomId: s.roomId, roomName: roomName.get(s.roomId) ?? "Unassigned", count: 0, lossCents: 0 };
        rr.count += 1;
        rr.lossCents += loss;
        byRoom.set(s.roomId, rr);
      }
    }

    return {
      windowDays: COMP_WINDOW_DAYS,
      totalCount: comped.length,
      totalLossCents,
      windowCount,
      windowLossCents,
      byClient: [...byClient.values()].sort((a, b) => b.lossCents - a.lossCents),
      byRoom: [...byRoom.values()].sort((a, b) => b.lossCents - a.lossCents),
    };
  },
});
