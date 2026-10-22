import { v } from "convex/values";
import { query } from "./_generated/server";
import { resolveViewer } from "./lib/access";
import { DEMO_ORG } from "./lib/tenant";
import { isClient } from "./lib/catalogArtists";

const DAY = 86_400_000;

function monthKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/* ============================================================
   Dashboard - every KPI and chart series the home screen needs,
   computed in one pass so the page makes a single round trip.
   ============================================================ */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await resolveViewer(ctx);
    const orgId = viewer.orgId ?? DEMO_ORG;
    // Money fields are leadership-only (owner / manager / accountant). Everyone
    // else gets the operational KPIs with financial figures nulled out.
    const canSeeFinancials = viewer.capabilities.has("invoices.read");
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    const now = Date.now();
    const monthStart = (() => {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const lastMonthStart = (() => {
      const d = new Date(monthStart);
      d.setMonth(d.getMonth() - 1);
      return d.getTime();
    })();

    // Sessions/invoices/opportunities grow with the studio's lifetime; every
    // KPI this query surfaces looks back at most ~13 months, so bound those
    // reads to a rolling 400-day window (by_org indexes order by _creationTime,
    // making this an indexed range, not a scan). Trade-off: an unpaid invoice
    // or open opportunity older than ~13 months ages out of Outstanding /
    // Pipeline value. Artists + songs stay whole-table (roster + catalog are
    // human-scale and back all-time counts).
    const windowStart = now - 400 * 86_400_000;
    const [artists, songs, sessions, invoices, opportunities] = await Promise.all([
      ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db
        .query("sessions")
        .withIndex("by_org", (q) => q.eq("orgId", orgId).gte("_creationTime", windowStart))
        .collect(),
      ctx.db
        .query("invoices")
        .withIndex("by_org", (q) => q.eq("orgId", orgId).gte("_creationTime", windowStart))
        .collect(),
      ctx.db
        .query("opportunities")
        .withIndex("by_org", (q) => q.eq("orgId", orgId).gte("_creationTime", windowStart))
        .collect(),
    ]);

    // ── Revenue (collected, by paidAt) ──
    const paid = invoices.filter((i) => i.status === "paid" && i.paidAt);
    const revenueThisMonth = paid
      .filter((i) => i.paidAt! >= monthStart)
      .reduce((s, i) => s + i.amountCents, 0);
    // Like-for-like: compare month-to-date against the SAME elapsed span of
    // last month, not the whole of it. Measuring 3 weeks against a full month
    // makes the delta read negative every day of every month regardless of how
    // the studio is actually doing, which is worse than useless on day 2.
    const elapsedThisMonth = now - monthStart;
    const revenueLastMonth = paid
      .filter(
        (i) =>
          i.paidAt! >= lastMonthStart && i.paidAt! < lastMonthStart + elapsedThisMonth,
      )
      .reduce((s, i) => s + i.amountCents, 0);
    const revenueDelta =
      revenueLastMonth > 0
        ? (revenueThisMonth - revenueLastMonth) / revenueLastMonth
        : revenueThisMonth > 0
          ? 1
          : 0;

    // ── Sessions ──
    const sessionsThisMonth = sessions.filter((s) => s.startTime >= monthStart).length;

    // ── Booked hours, month to date, like-for-like against last month ──
    // A session counts for the hours that fall inside the span; cancelled and
    // no-show sessions were never studio time.
    const bookedHours = (from: number, to: number) =>
      sessions
        .filter((s) => s.status !== "cancelled" && s.status !== "no_show")
        .reduce((sum, s) => sum + Math.max(0, Math.min(s.endTime, to) - Math.max(s.startTime, from)), 0) /
      3_600_000;
    const monthEnd = (() => {
      const d = new Date(monthStart);
      d.setMonth(d.getMonth() + 1);
      return d.getTime();
    })();
    // The whole month's bookings, including what is still to come, against
    // last month over the same number of days.
    const bookedHoursThisMonth = Math.round(bookedHours(monthStart, monthEnd) * 10) / 10;
    const bookedHoursLastMonth = bookedHours(lastMonthStart, Math.min(monthStart, lastMonthStart + (monthEnd - monthStart)));
    const bookedHoursDelta =
      bookedHoursLastMonth > 0 ? (bookedHoursThisMonth - bookedHoursLastMonth) / bookedHoursLastMonth : null;

    // ── Deposits held: paid deposits on bookings that have not happened yet ──
    const held = sessions.filter(
      (s) => s.depositPaid && s.depositCents > 0 && s.endTime > now && s.status !== "cancelled" && s.status !== "no_show",
    );
    const depositsHeldCents = held.reduce((sum, s) => sum + s.depositCents, 0);
    const completedSessions = sessions.filter((s) => s.status === "completed");
    const avgSessionValue = completedSessions.length
      ? Math.round(
          completedSessions.reduce((s, x) => s + x.rateCents, 0) / completedSessions.length,
        )
      : 0;

    // ── Pipeline ──
    const openOpps = opportunities.filter((o) => o.stage !== "won" && o.stage !== "lost");
    const pipelineValue = openOpps.reduce((s, o) => s + o.valueCents, 0);

    // ── Invoices ──
    // A raw "sent"/"viewed" invoice past its due date still carries that
    // status in the row - so these three cover every outstanding invoice.
    const outstanding = invoices.filter(
      (i) => i.status === "sent" || i.status === "viewed" || i.status === "overdue",
    );
    const overdueCount = invoices.filter(
      (i) =>
        i.status === "overdue" ||
        ((i.status === "sent" || i.status === "viewed") && i.dueDate < now),
    ).length;

    // ── Leads ──
    const newLeadsThisWeek = artists.filter(
      (a) => a.status === "lead" && a._creationTime >= now - 7 * DAY,
    ).length;

    // ── 12-month revenue trend ──
    const trendMap = new Map<string, number>();
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() - i);
      trendMap.set(monthKey(d.getTime()), 0);
    }
    for (const inv of paid) {
      const k = monthKey(inv.paidAt!);
      if (trendMap.has(k)) trendMap.set(k, trendMap.get(k)! + inv.amountCents);
    }
    const revenueTrend = [...trendMap.entries()].map(([key, cents]) => ({
      month: new Date(`${key}-01T00:00:00`).toLocaleDateString("en-US", { month: "short" }),
      revenue: Math.round(cents / 100),
    }));

    // ── Pipeline stage distribution ──
    const stageDist: Record<string, number> = {};
    for (const o of openOpps) stageDist[o.stage] = (stageDist[o.stage] ?? 0) + 1;
    const pipelineByStage = Object.entries(stageDist).map(([stage, count]) => ({
      stage: stage.replace("_", " "),
      count,
    }));

    // ── Bookings by service type ──
    const svcDist: Record<string, number> = {};
    for (const s of sessions) svcDist[s.serviceType] = (svcDist[s.serviceType] ?? 0) + 1;
    const bookingsByService = Object.entries(svcDist).map(([service, count]) => ({
      service,
      count,
    }));

    // ── Song catalog by stage ──
    const songDist: Record<string, number> = {};
    for (const s of songs) songDist[s.stage] = (songDist[s.stage] ?? 0) + 1;
    const songsByStage = Object.entries(songDist).map(([stage, count]) => ({ stage, count }));

    return {
      canSeeFinancials,
      kpis: {
        revenueThisMonth: canSeeFinancials ? revenueThisMonth : null,
        revenueDelta: canSeeFinancials ? revenueDelta : null,
        sessionsThisMonth,
        pipelineValue: canSeeFinancials ? pipelineValue : null,
        outstandingCents: canSeeFinancials ? outstanding.reduce((s, i) => s + i.amountCents, 0) : null,
        overdueCount: canSeeFinancials ? overdueCount : null,
        newLeadsThisWeek,
        avgSessionValue: canSeeFinancials ? avgSessionValue : null,
        bookedHoursThisMonth,
        bookedHoursDelta,
        depositsHeldCents: canSeeFinancials ? depositsHeldCents : null,
        depositsHeldCount: canSeeFinancials ? held.length : null,
        // The monthly revenue goal (money), and whether this viewer may set it.
        monthlyGoalCents: canSeeFinancials ? org?.monthlyRevenueGoalCents ?? null : null,
        canSetGoal: canSeeFinancials && viewer.capabilities.has("branding.edit"),
        activeSongs: songs.filter((s) => s.stage !== "released" && s.stage !== "delivered").length,
        rosterSize: artists.filter(isClient).length,
      },
      charts: {
        revenueTrend: canSeeFinancials ? revenueTrend : [],
        pipelineByStage,
        bookingsByService,
        songsByStage,
      },
    };
  },
});

/* Collected revenue over a range, for the overview's booking revenue chart:
   30 days by day, 90 days by week, the year to date by month. Same source as
   the Revenue tile (paid invoices by paidAt), so the two always agree.
   Money: callers without invoices.read get no points. */
export const revenueSeries = query({
  args: { range: v.union(v.literal("30d"), v.literal("90d"), v.literal("ytd")) },
  handler: async (ctx, { range }) => {
    const viewer = await resolveViewer(ctx);
    const orgId = viewer.orgId ?? DEMO_ORG;
    if (!viewer.capabilities.has("invoices.read")) return { range, points: [] as SeriesPoint[] };

    const now = Date.now();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const buckets: { start: number; end: number; label: string }[] = [];
    const short = (t: number, withDay: boolean) =>
      new Date(t).toLocaleDateString("en-US", withDay ? { month: "short", day: "numeric" } : { month: "short" });
    if (range === "30d") {
      for (let i = 29; i >= 0; i--) {
        const start = today.getTime() - i * DAY;
        buckets.push({ start, end: start + DAY, label: short(start, true) });
      }
    } else if (range === "90d") {
      // 13 weeks ending today; the last bucket is the current partial week.
      for (let i = 12; i >= 0; i--) {
        const end = today.getTime() + DAY - i * 7 * DAY;
        buckets.push({ start: end - 7 * DAY, end, label: short(end - 7 * DAY, true) });
      }
    } else {
      for (let m = 0; m <= today.getMonth(); m++) {
        const start = new Date(today.getFullYear(), m, 1).getTime();
        const end = new Date(today.getFullYear(), m + 1, 1).getTime();
        buckets.push({ start, end, label: short(start, false) });
      }
    }

    const from = buckets[0].start;
    const paid = (
      await ctx.db
        .query("invoices")
        .withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).gte("paidAt", from).lte("paidAt", now))
        .collect()
    ).filter((i) => i.status === "paid" && i.paidAt);
    const points: SeriesPoint[] = buckets.map((b) => ({
      label: b.label,
      start: b.start,
      cents: paid.filter((i) => i.paidAt! >= b.start && i.paidAt! < b.end).reduce((sum, i) => sum + i.amountCents, 0),
    }));
    return { range, points };
  },
});

type SeriesPoint = { label: string; start: number; cents: number };

/* The overview's period keys (Day / Week / Month). The browser sends the
   period's bounds in the studio owner's own time zone, and the previous
   period's, so "today" means their today. Revenue compares like for like
   (the same elapsed span of the previous period); booked hours compare whole
   periods, since bookings for later today or this week already count. */
export const periodKpis = query({
  args: { start: v.number(), end: v.number(), prevStart: v.number(), prevEnd: v.number() },
  handler: async (ctx, { start, end, prevStart, prevEnd }) => {
    const viewer = await resolveViewer(ctx);
    const orgId = viewer.orgId ?? DEMO_ORG;
    const money = viewer.capabilities.has("invoices.read");
    const ok =
      start < end && prevStart < prevEnd && prevEnd <= start && end - start <= 32 * DAY && prevEnd - prevStart <= 32 * DAY;
    if (!ok) throw new Error("That period does not make sense.");

    const now = Date.now();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).gte("startTime", prevStart - DAY).lt("startTime", end))
      .collect();
    const live = sessions.filter((s) => s.status !== "cancelled" && s.status !== "no_show");
    const hours = (from: number, to: number) =>
      live.reduce((sum, s) => sum + Math.max(0, Math.min(s.endTime, to) - Math.max(s.startTime, from)), 0) / 3_600_000;
    const bookedHours = Math.round(hours(start, end) * 10) / 10;
    const prevHours = hours(prevStart, prevEnd);

    let revenueCents: number | null = null;
    let revenueDelta: number | null = null;
    if (money) {
      const upTo = Math.min(end, now);
      const elapsed = Math.max(0, upTo - start);
      const paid = (
        await ctx.db
          .query("invoices")
          .withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).gte("paidAt", prevStart).lte("paidAt", upTo))
          .collect()
      ).filter((i) => i.status === "paid" && i.paidAt);
      revenueCents = paid.filter((i) => i.paidAt! >= start).reduce((s, i) => s + i.amountCents, 0);
      const prev = paid
        .filter((i) => i.paidAt! >= prevStart && i.paidAt! < Math.min(prevEnd, prevStart + elapsed))
        .reduce((s, i) => s + i.amountCents, 0);
      revenueDelta = prev > 0 ? (revenueCents - prev) / prev : null;
    }

    return {
      money,
      revenueCents,
      revenueDelta,
      bookedHours,
      bookedHoursDelta: prevHours > 0 ? (bookedHours - prevHours) / prevHours : null,
      sessions: live.filter((s) => s.startTime >= start && s.startTime < end).length,
    };
  },
});
