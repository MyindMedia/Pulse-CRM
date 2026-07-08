import { query } from "./_generated/server";
import { resolveViewer } from "./lib/access";
import { DEMO_ORG } from "./lib/tenant";

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
    const revenueLastMonth = paid
      .filter((i) => i.paidAt! >= lastMonthStart && i.paidAt! < monthStart)
      .reduce((s, i) => s + i.amountCents, 0);
    const revenueDelta =
      revenueLastMonth > 0
        ? (revenueThisMonth - revenueLastMonth) / revenueLastMonth
        : revenueThisMonth > 0
          ? 1
          : 0;

    // ── Sessions ──
    const sessionsThisMonth = sessions.filter((s) => s.startTime >= monthStart).length;
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
        activeSongs: songs.filter((s) => s.stage !== "released" && s.stage !== "delivered").length,
        rosterSize: artists.length,
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
