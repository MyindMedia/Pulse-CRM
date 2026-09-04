/* ============================================================
   Profitability engine - per-org financial evaluation.

   Reads ONLY the caller's own org-scoped records (every query is
   `by_org`-indexed; the orgId is derived server-side, never trusted
   from the client), reduces them to a small set of raw counts, then
   grades each metric against the global Studio Knowledge Base
   (lib/studioKnowledge.ts). The output is an explainable, 0-100
   profitability score plus a ranked list of dollar-quantified
   improvement levers.

   Split into a PURE core (computeMetricValues / buildReport /
   profitLeverCandidates - fully unit-testable, no ctx) and a thin
   Convex layer (gather + query + internal cron hooks). The agent never
   invents financial numbers: it reads these graded results.

   Autonomy: the overall score + weakest-metric summary auto-post as an
   internal `insights` row (low-risk, no outbound). The actionable
   levers feed the opsActions inbox as `profit_improvement` proposals
   (note_only - they recommend, they never send), so anything that would
   touch a client or money still goes through the human approval +
   autonomy-graduation rail in opsActions.
   ============================================================ */
import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server";
import { internalMutation } from "./functions";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { currentOrgWithCapability } from "./lib/tenant";
import { money } from "./lib/money";
import {
  BENCHMARKS,
  BAND_RANK,
  TOP_PERFORMER_CRITERIA,
  gradeMetric,
  rollUp,
  type Band,
  type MetricKey,
  type MetricGrade,
  KB_VERSION,
} from "./lib/studioKnowledge";
import type { ProposedAction, Priority } from "./opsBrain";

const DAY = 86_400_000;
const WINDOW_DAYS = 56; // 8-week trailing window for rate/utilization metrics
const SELLABLE_HOURS_PER_DAY = 8;

/* ----------------------------------------------------------------
   Pure core
   ---------------------------------------------------------------- */

/** Reduced, org-scoped facts the metric math runs on. Every field is a
 *  plain number so the math layer stays pure and testable. */
export type RawCounts = {
  now: number;
  windowDays: number;
  // utilization
  bookableRoomCount: number;
  bookedHours: number;
  avgRoomHourlyRateCents: number;
  // sessions / no-show
  scheduledInWindow: number; // sessions that were due in window (completed+no_show+cancelled)
  noShowInWindow: number; // no_show + cancelled
  avgSessionValueCents: number;
  // lead conversion
  leadCount: number;
  bookedLeadCount: number;
  // deposit capture
  depositConsidered: number; // bookings that should carry a deposit
  depositPaidCount: number;
  unprotectedValueCents: number; // upcoming confirmed/tentative value with no deposit
  // collection / AR
  collectedCents: number;
  overdueCents: number;
  openARCents: number;
  arOver30Cents: number;
  // retention
  clientsWithSession: number;
  repeatClients: number;
  // pipeline
  weightedPipelineCents: number;
  monthlyBookedCents: number;
  // revision overage
  activeSongsWithBudget: number;
  overBudgetSongs: number;
  // split execution
  nearReleaseSongs: number;
  executedSplitSongs: number;
  unexecutedNearReleaseSongs: number;
  // concentration
  engineerRevenueCents: number[]; // revenue per engineer over window (only engineers with revenue)
};

function pct(numer: number, denom: number): number {
  return denom > 0 ? (numer / denom) * 100 : 0;
}

/** Turn raw counts into metric VALUES, omitting any metric whose
 *  denominator is too thin to be meaningful (so we never grade noise). */
export function computeMetricValues(c: RawCounts): Partial<Record<MetricKey, number>> {
  const out: Partial<Record<MetricKey, number>> = {};

  const capacityHours = c.bookableRoomCount * c.windowDays * SELLABLE_HOURS_PER_DAY;
  if (capacityHours > 0) out.utilization = Math.min(100, pct(c.bookedHours, capacityHours));

  if (c.scheduledInWindow >= 3) out.noShowRate = pct(c.noShowInWindow, c.scheduledInWindow);

  if (c.leadCount >= 5) out.leadConversion = pct(c.bookedLeadCount, c.leadCount);

  if (c.depositConsidered >= 3) out.depositCapture = pct(c.depositPaidCount, c.depositConsidered);

  if (c.collectedCents + c.overdueCents > 0) out.collectionRate = pct(c.collectedCents, c.collectedCents + c.overdueCents);

  if (c.openARCents > 0) out.arOver30Pct = pct(c.arOver30Cents, c.openARCents);

  if (c.clientsWithSession >= 3) out.repeatRate = pct(c.repeatClients, c.clientsWithSession);

  if (c.monthlyBookedCents > 0) out.pipelineCoverage = c.weightedPipelineCents / c.monthlyBookedCents;

  if (c.activeSongsWithBudget >= 2) out.revisionOverageRate = pct(c.overBudgetSongs, c.activeSongsWithBudget);

  if (c.nearReleaseSongs >= 1) out.splitExecutionRate = pct(c.executedSplitSongs, c.nearReleaseSongs);

  // Concentration only means something with >= 2 revenue-earning engineers.
  if (c.engineerRevenueCents.length >= 2) {
    const total = c.engineerRevenueCents.reduce((s, n) => s + n, 0);
    const top = Math.max(...c.engineerRevenueCents);
    if (total > 0) out.concentrationRisk = pct(top, total);
  }

  return out;
}

export type ProfitLever = {
  key: MetricKey;
  label: string;
  band: Band;
  recommendation: string;
  detail: string;
  /** Estimated monthly revenue upside in cents, when defensibly computable. */
  estImpactCents?: number;
  /** Cash/legal exposure in cents (not recoverable revenue), when relevant. */
  exposureCents?: number;
};

export type ProfitReport = {
  kbVersion: string;
  generatedAt: number;
  overall: number;
  band: Band;
  metrics: MetricGrade[];
  levers: ProfitLever[];
  criteria: { key: string; label: string; detail: string }[];
  /** How many metrics had enough data to grade. */
  graded: number;
};

/** Estimate the dollar upside / exposure of fixing one below-healthy metric.
 *  Conservative and clearly bounded; returns {} for qualitative-only metrics. */
function leverEconomics(key: MetricKey, value: number, c: RawCounts): { estImpactCents?: number; exposureCents?: number } {
  const b = BENCHMARKS[key];
  const monthScale = 30 / Math.max(1, c.windowDays);
  switch (key) {
    case "utilization": {
      const monthlyCapacityHours = c.bookableRoomCount * 30 * SELLABLE_HOURS_PER_DAY;
      const recoverableFrac = Math.max(0, b.healthy - value) / 100;
      const cents = Math.round(recoverableFrac * monthlyCapacityHours * c.avgRoomHourlyRateCents);
      return cents > 0 ? { estImpactCents: cents } : {};
    }
    case "noShowRate": {
      const monthlySessions = c.scheduledInWindow * monthScale;
      const excessFrac = Math.max(0, value - b.healthy) / 100;
      const cents = Math.round(excessFrac * monthlySessions * c.avgSessionValueCents);
      return cents > 0 ? { estImpactCents: cents } : {};
    }
    case "collectionRate":
    case "arOver30Pct":
      return c.overdueCents > 0 ? { exposureCents: c.overdueCents } : {};
    case "depositCapture":
      return c.unprotectedValueCents > 0 ? { exposureCents: c.unprotectedValueCents } : {};
    case "pipelineCoverage": {
      const shortfall = Math.max(0, b.healthy - value); // coverage points short
      const cents = Math.round(shortfall * c.monthlyBookedCents);
      return cents > 0 ? { estImpactCents: cents } : {};
    }
    default:
      return {};
  }
}

/** Build the full graded report from raw counts. Pure. */
export function buildReport(c: RawCounts): ProfitReport {
  const values = computeMetricValues(c);
  const metrics: MetricGrade[] = (Object.keys(values) as MetricKey[])
    .map((k) => gradeMetric(k, values[k] as number))
    .sort((a, b) => a.score - b.score); // weakest first

  // Weight the metrics that move money hardest a touch higher in the roll-up.
  const weights: Partial<Record<MetricKey, number>> = {
    utilization: 1.5,
    collectionRate: 1.3,
    noShowRate: 1.2,
    splitExecutionRate: 1.2,
    depositCapture: 1.1,
  };
  const { score, band } = rollUp(metrics, weights);

  const levers: ProfitLever[] = metrics
    .filter((m) => m.band === "warning" || m.band === "critical")
    .map((m) => {
      const econ = leverEconomics(m.key, m.value, c);
      const unitVal = m.unit === "pct" ? `${Math.round(m.value)}%` : m.unit === "ratio" ? `${m.value.toFixed(1)}x` : money(m.value);
      return {
        key: m.key,
        label: m.label,
        band: m.band,
        recommendation: m.lever,
        detail: `${m.label} is at ${unitVal} (${m.band}). ${m.why}`,
        ...econ,
      } satisfies ProfitLever;
    })
    .sort((a, b) => {
      // Critical before warning (BAND_RANK is best=0..worst=3, so worst first),
      // then by the largest dollar figure attached.
      if (a.band !== b.band) return BAND_RANK[b.band] - BAND_RANK[a.band];
      const av = (a.estImpactCents ?? 0) + (a.exposureCents ?? 0);
      const bv = (b.estImpactCents ?? 0) + (b.exposureCents ?? 0);
      return bv - av;
    });

  return {
    kbVersion: KB_VERSION,
    generatedAt: c.now,
    overall: score,
    band,
    metrics,
    levers,
    criteria: TOP_PERFORMER_CRITERIA,
    graded: metrics.length,
  };
}

const PROFIT_PRIORITY: Record<Band, Priority> = { critical: "high", warning: "medium", healthy: "low", top: "low" };

/** Turn the report's levers into opsActions candidates (note_only, internal
 *  recommendations). These never send anything; they surface in the inbox so
 *  an owner can act. Client-facing/financial follow-through still flows through
 *  the existing approval-gated action types. */
export function profitLeverCandidates(report: ProfitReport): ProposedAction[] {
  return report.levers.map((lv) => {
    const dollars =
      lv.estImpactCents != null
        ? ` Est. ${money(lv.estImpactCents)}/mo upside.`
        : lv.exposureCents != null
          ? ` ${money(lv.exposureCents)} at risk.`
          : "";
    return {
      type: "profit_improvement",
      priority: PROFIT_PRIORITY[lv.band],
      title: `Improve ${lv.label.toLowerCase()}`,
      rationale: `${lv.detail} ${lv.recommendation}${dollars}`,
      entityType: "metric",
      entityId: lv.key,
      payload: { kind: "note_only" },
    } satisfies ProposedAction;
  });
}

/* ----------------------------------------------------------------
   Convex layer - org-scoped gather + query + cron hooks
   ---------------------------------------------------------------- */

/** Read the caller-org's live records and reduce to RawCounts. orgId is passed
 *  in already resolved from the access engine - never from client args. */
export async function gatherProfitCounts(ctx: QueryCtx | MutationCtx, orgId: string): Promise<RawCounts> {
  const now = Date.now();
  const windowStart = now - WINDOW_DAYS * DAY;
  const monthStart = now - 30 * DAY;

  const [sessions, rooms, invoices, artists, opps, songs, splitSheets, members] = await Promise.all([
    ctx.db.query("sessions").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("rooms").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("artists").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("opportunities").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("songs").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("splitSheets").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
    ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
  ]);

  // Rooms / utilization.
  const bookableRooms = rooms.filter((r) => r.bookable !== false && r.status !== "retired");
  const roomRates = bookableRooms.map((r) => r.hourlyRateCents ?? 0).filter((n) => n > 0);
  const avgRoomHourlyRateCents = roomRates.length ? Math.round(roomRates.reduce((s, n) => s + n, 0) / roomRates.length) : 0;

  const windowSessions = sessions.filter((s) => s.startTime >= windowStart && s.startTime <= now);
  const bookedHours = windowSessions
    .filter((s) => s.status !== "cancelled" && s.status !== "no_show")
    .reduce((sum, s) => sum + Math.max(0, s.endTime - s.startTime) / 3_600_000, 0);

  // No-show: sessions that were due in window with a terminal outcome.
  const dueInWindow = windowSessions.filter((s) => s.status === "completed" || s.status === "no_show" || s.status === "cancelled");
  const noShowInWindow = dueInWindow.filter((s) => s.status === "no_show" || s.status === "cancelled").length;

  const valued = windowSessions.filter((s) => (s.rateCents ?? 0) > 0);
  const avgSessionValueCents = valued.length ? Math.round(valued.reduce((s, x) => s + x.rateCents, 0) / valued.length) : 0;

  // Lead conversion: artists that arrived as leads (have a source) vs booked.
  const sourcedArtists = artists.filter((a) => !!a.source);
  const leadCount = sourcedArtists.length;
  const bookedLeadCount = sourcedArtists.filter((a) => (a.sessionCount ?? 0) > 0).length;

  // Deposit capture across recent + upcoming bookings that should carry one.
  const depositPool = sessions.filter(
    (s) => (s.rateCents ?? 0) > 0 && s.endTime >= windowStart && s.status !== "cancelled" && s.status !== "no_show",
  );
  const depositConsidered = depositPool.length;
  const depositPaidCount = depositPool.filter((s) => s.depositPaid).length;
  const unprotectedValueCents = sessions
    .filter((s) => s.startTime > now && (s.status === "confirmed" || s.status === "tentative") && !s.depositPaid)
    .reduce((sum, s) => sum + (s.rateCents ?? 0), 0);

  // Collection + AR aging.
  const collectedCents = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const openInvoices = invoices.filter((i) => i.status === "sent" || i.status === "viewed" || i.status === "overdue");
  const overdue = openInvoices.filter((i) => (i.dueDate ?? Infinity) < now);
  const overdueCents = overdue.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const openARCents = openInvoices.reduce((s, i) => s + (i.amountCents ?? 0), 0);
  const arOver30Cents = openInvoices
    .filter((i) => (i.dueDate ?? Infinity) < now - 30 * DAY)
    .reduce((s, i) => s + (i.amountCents ?? 0), 0);

  // Retention.
  const withSession = artists.filter((a) => (a.sessionCount ?? 0) > 0);
  const repeatClients = withSession.filter((a) => (a.sessionCount ?? 0) > 1).length;

  // Pipeline coverage.
  const openOpps = opps.filter((o) => o.stage !== "won" && o.stage !== "lost");
  const weightedPipelineCents = openOpps.reduce((s, o) => s + (o.valueCents ?? 0) * (o.probability ?? 0), 0);
  const monthlyBookedCents = sessions
    .filter((s) => s.startTime >= monthStart && s.startTime <= now && (s.status === "confirmed" || s.status === "completed" || s.status === "in_progress"))
    .reduce((s, x) => s + (x.rateCents ?? 0), 0);

  // Revision overage.
  const ACTIVE = (st: string) => st !== "delivered" && st !== "released";
  const budgetSongs = songs.filter((s) => ACTIVE(s.stage) && (s.revisionsIncluded ?? 0) > 0);
  const overBudgetSongs = budgetSongs.filter((s) => (s.revisionsUsed ?? 0) > (s.revisionsIncluded ?? 0)).length;

  // Split execution near release.
  const NEAR = new Set(["mastering", "delivered", "released"]);
  const sheetBySong = new Map(splitSheets.map((sh) => [sh.songId, sh] as const));
  const nearSongs = songs.filter((s) => NEAR.has(s.stage));
  const executedSplitSongs = nearSongs.filter((s) => sheetBySong.get(s._id)?.status === "fully_executed").length;
  const unexecutedNearReleaseSongs = nearSongs.length - executedSplitSongs;

  // Engineer revenue concentration over the window.
  const revByEngineer = new Map<string, number>();
  for (const s of windowSessions) {
    if (!s.engineerId) continue;
    if (s.status === "cancelled" || s.status === "no_show") continue;
    revByEngineer.set(s.engineerId, (revByEngineer.get(s.engineerId) ?? 0) + (s.rateCents ?? 0));
  }
  // Only count engineers that still exist on the team.
  const memberIds = new Set(members.map((m) => m._id));
  const engineerRevenueCents = Array.from(revByEngineer.entries())
    .filter(([id, cents]) => memberIds.has(id as never) && cents > 0)
    .map(([, cents]) => cents);

  return {
    now,
    windowDays: WINDOW_DAYS,
    bookableRoomCount: bookableRooms.length,
    bookedHours,
    avgRoomHourlyRateCents,
    scheduledInWindow: dueInWindow.length,
    noShowInWindow,
    avgSessionValueCents,
    leadCount,
    bookedLeadCount,
    depositConsidered,
    depositPaidCount,
    unprotectedValueCents,
    collectedCents,
    overdueCents,
    openARCents,
    arOver30Cents,
    clientsWithSession: withSession.length,
    repeatClients,
    weightedPipelineCents,
    monthlyBookedCents,
    activeSongsWithBudget: budgetSongs.length,
    overBudgetSongs,
    nearReleaseSongs: nearSongs.length,
    executedSplitSongs,
    unexecutedNearReleaseSongs,
    engineerRevenueCents,
  };
}

/** Public read: the studio's profitability report. Financial surface, so it is
 *  gated by `insights.read` (owner/manager/accountant) like the other reports. */
export const report = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    return buildReport(await gatherProfitCounts(ctx, orgId));
  },
});

/** Internal read for crons / the agent context. */
export const reportFor = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => buildReport(await gatherProfitCounts(ctx, orgId)),
});

/** Auto-post (or refresh) one open profitability insight per org. Low-risk,
 *  no outbound - the "auto for internal analyses" half of the autonomy policy.
 *  Deduped on a single open row tagged entityType "profitability". */
export const postSummaryInsight = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const report = buildReport(await gatherProfitCounts(ctx, orgId));
    if (report.graded === 0) return { posted: false };

    const weakest = report.metrics.filter((m) => m.band === "warning" || m.band === "critical").slice(0, 3);
    const lines = weakest.map((m) => {
      const val = m.unit === "pct" ? `${Math.round(m.value)}%` : m.unit === "ratio" ? `${m.value.toFixed(1)}x` : money(m.value);
      return `- ${m.label}: ${val} (${m.band})`;
    });
    const topLever = report.levers[0];
    const leverLine = topLever
      ? `\n\nBiggest lever: ${topLever.recommendation}${
          topLever.estImpactCents != null
            ? ` (~${money(topLever.estImpactCents)}/mo)`
            : topLever.exposureCents != null
              ? ` (${money(topLever.exposureCents)} at risk)`
              : ""
        }`
      : "";
    const body =
      weakest.length > 0
        ? `Scored ${report.overall}/100 across ${report.graded} metrics.\n\nWeakest areas:\n${lines.join("\n")}${leverLine}`
        : `Scored ${report.overall}/100 across ${report.graded} metrics. No metric is below healthy - keep it up.`;

    const severity = report.band === "critical" ? "warning" : report.band === "warning" ? "warning" : report.band === "top" ? "info" : "opportunity";

    const existing = await ctx.db
      .query("insights")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const open = existing.find((i) => i.entityType === "profitability" && (i.status === "new" || i.status === "seen"));

    const title = `Profitability ${report.overall}/100 (${report.band})`;
    if (open) {
      await ctx.db.patch(open._id, { title, body, severity, status: "new" });
      return { posted: true, updated: true, score: report.overall };
    }
    await ctx.db.insert("insights", {
      orgId,
      kind: "revenue",
      title,
      body,
      entityType: "profitability",
      status: "new",
      severity,
    });
    return { posted: true, updated: false, score: report.overall };
  },
});
