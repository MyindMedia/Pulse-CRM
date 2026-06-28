/* ============================================================
   Studio Knowledge Base - codified best-practice benchmarks.

   A pure, versioned, in-repo knowledge layer the Operations Agent
   reasons AGAINST. It holds NO tenant data: it is the global "what a
   well-run recording studio looks like" reference - benchmark bands
   for the metrics that drive profitability, plus the operational
   traits that separate top performers from strugglers.

   The profitability engine (convex/profitability.ts) computes a
   studio's own metrics from its OWN org-scoped records, then calls the
   pure scoring functions here to grade each metric and surface ranked,
   dollar-quantified improvement levers. Because this module is pure and
   reads nothing from the database, it can never cross a tenant
   boundary, and it stays fully unit-testable.

   Sourcing: numbers are codified from recording-studio + appointment-
   based-service operating norms. They are intentionally easy to refine:
   bump a threshold here and every score moves. A parallel web-research
   pass refines the bands with cited industry figures; when it lands,
   update BENCHMARKS + bump KB_VERSION.
   ============================================================ */

export const KB_VERSION = "2026.06.27";

/* Sources behind the benchmark bands (web-researched 2026-06-27). Studio-
   specific where it exists; otherwise the closest service-business analog,
   marked [ANALOG]. Refresh these alongside BENCHMARKS.
   - Utilization 60-80% healthy / <40% critical: dojobusiness.com recording-studio
     break-even + complete guide; thestudiohero.com pricing.
   - No-show <10% healthy / >20% critical [ANALOG appointment services]: etisia.com,
     fathomhq.com non-attendance KPI, agentzap.ai.
   - Lead->booking 7-12% healthy / <2% critical [ANALOG service biz]: ruleranalytics.com,
     firstpagesage.com, bspkn.co.
   - Deposit 25-50% of value, gate all high-value bookings: grabmyslot.com, bookedin.com.
   - AR aging 80/12/5/3 rule, >20% past-due = problem: crestmontcapital.com, creditpulse.com.
   - Staff/labor 30-50% of revenue, variable labor >40% = leak: dojobusiness.com,
     financialmodelslab.com, rippling.com.
   - Net margin 15-30% top / gross 50-70%: dojobusiness.com profitability, venasolutions.com.
   - Revisions 1-3 included then billed: joeysturgistones.com, eliottglinnaudio.com.
   - Repeat rate 20-30% healthy [ANALOG]: trypropel.ai, customergauge.com.
   - Pipeline 3-4x coverage, 14/30/45-day staleness [ANALOG B2B]: outreach.ai, landbase.com.
   - Billable utilization 74-84%, single-source concentration warning >15% [ANALOG PS]:
     mosaicapp.com, wallstreetprep.com customer-concentration.
   - Splits executed before release; PROs freeze royalties + takedown risk otherwise:
     soundcharts.com, blog.songtrust.com, corderolawgroup.com. */

/** Quality bands, best -> worst. */
export type Band = "top" | "healthy" | "warning" | "critical";

export const BAND_RANK: Record<Band, number> = { top: 0, healthy: 1, warning: 2, critical: 3 };

/** The metrics the agent grades a studio on. */
export type MetricKey =
  | "utilization" // booked bookable-hours / available bookable-hours
  | "noShowRate" // no-show + late-cancel share of scheduled sessions
  | "leadConversion" // leads that became a booking
  | "depositCapture" // bookings protected by a paid deposit
  | "collectionRate" // collected / (collected + overdue)
  | "arOver30Pct" // share of open receivable value aged > 30 days
  | "staffCostRatio" // staff/labor cost / revenue
  | "repeatRate" // clients with > 1 session
  | "pipelineCoverage" // open weighted pipeline / monthly booked revenue
  | "revisionOverageRate" // active songs over their included-revision budget
  | "splitExecutionRate" // near-release songs with a fully executed split sheet
  | "concentrationRisk"; // share of revenue carried by the single top engineer

/** Higher value is better, or lower value is better. */
type Direction = "higher" | "lower";

export type Benchmark = {
  key: MetricKey;
  label: string;
  unit: "pct" | "ratio" | "usd";
  direction: Direction;
  /** Band edges, expressed in the metric's own units (pct as 0-100). For a
   *  "higher is better" metric: value >= top => top, >= healthy => healthy,
   *  >= warning => warning, else critical. Mirrored for "lower is better". */
  top: number;
  healthy: number;
  warning: number;
  /** One-line reason this metric drives profitability. */
  why: string;
  /** The lever to pull when it is below healthy. */
  lever: string;
};

/* The benchmark table. One row per metric. Edit numbers here to retune the
   whole agent; the research pass refines these with citations. */
export const BENCHMARKS: Record<MetricKey, Benchmark> = {
  utilization: {
    key: "utilization",
    label: "Room utilization",
    unit: "pct",
    direction: "higher",
    top: 70,
    healthy: 55,
    warning: 40,
    why: "Empty bookable hours are perishable revenue you can never resell.",
    lever: "Fill idle rooms with promos, waitlist outreach, and off-peak rates; cut or repurpose a chronically empty room.",
  },
  noShowRate: {
    key: "noShowRate",
    label: "No-show / late-cancel rate",
    unit: "pct",
    direction: "lower",
    top: 5,
    healthy: 10,
    warning: 20,
    why: "Every no-show is a paid-staff hour and a sold room slot lost with no revenue.",
    lever: "Require deposits, send 24h/2h confirmations, and enforce a cancellation window.",
  },
  leadConversion: {
    key: "leadConversion",
    label: "Lead -> booking conversion",
    unit: "pct",
    direction: "higher",
    top: 12,
    healthy: 7,
    warning: 3,
    why: "Leads are the top of revenue; a low conversion wastes marketing spend and demand.",
    lever: "Reply within an hour with concrete times + a deposit ask; tighten or cut weak lead sources.",
  },
  depositCapture: {
    key: "depositCapture",
    label: "Deposit capture",
    unit: "pct",
    direction: "higher",
    top: 90,
    healthy: 70,
    warning: 45,
    why: "Deposits are the single biggest lever on no-shows and cash flow.",
    lever: "Make a deposit mandatory to confirm any booking; default deposit to 25-50% of the session value.",
  },
  collectionRate: {
    key: "collectionRate",
    label: "Collection rate",
    unit: "pct",
    direction: "higher",
    top: 97,
    healthy: 90,
    warning: 80,
    why: "Revenue you booked but never collected is pure margin lost.",
    lever: "Automate dunning on overdue invoices; collect balances on delivery, not after.",
  },
  arOver30Pct: {
    key: "arOver30Pct",
    label: "Receivables aged > 30 days",
    unit: "pct",
    direction: "lower",
    top: 12,
    healthy: 20,
    warning: 35,
    why: "Aging receivables tie up cash and rarely fully collect past 90 days.",
    lever: "Escalate dunning at 30/60/90 days; require pay-on-delivery for repeat late payers.",
  },
  staffCostRatio: {
    key: "staffCostRatio",
    label: "Staff cost ratio",
    unit: "pct",
    direction: "lower",
    top: 30,
    healthy: 45,
    warning: 60,
    why: "Labor is the largest controllable cost; a high ratio erodes net margin fast.",
    lever: "Lift billable utilization per engineer, trim idle scheduled hours, and watch overtime.",
  },
  repeatRate: {
    key: "repeatRate",
    label: "Repeat-client rate",
    unit: "pct",
    direction: "higher",
    top: 40,
    healthy: 25,
    warning: 15,
    why: "Repeat clients cost nothing to acquire; retention compounds into stable revenue.",
    lever: "Run post-session recaps, reengage quiet clients, and offer membership/retainer packages.",
  },
  pipelineCoverage: {
    key: "pipelineCoverage",
    label: "Pipeline coverage",
    unit: "ratio",
    direction: "higher",
    top: 4,
    healthy: 3,
    warning: 1.5,
    why: "A thin pipeline means next month's revenue is unprotected against losses.",
    lever: "Add qualified opportunities, advance stalled deals, and lift proposal win-rate.",
  },
  revisionOverageRate: {
    key: "revisionOverageRate",
    label: "Revision overage rate",
    unit: "pct",
    direction: "lower",
    top: 5,
    healthy: 15,
    warning: 30,
    why: "Unbilled revisions are scope creep - free labor that silently destroys per-song margin.",
    lever: "Set an included-revision cap up front and invoice overages instead of absorbing them.",
  },
  splitExecutionRate: {
    key: "splitExecutionRate",
    label: "Split-sheet execution",
    unit: "pct",
    direction: "higher",
    top: 100,
    healthy: 90,
    warning: 70,
    why: "A release without executed splits is a royalty dispute and a legal liability waiting to happen.",
    lever: "Lock every contributor's split BEFORE a song is delivered or released - never after.",
  },
  concentrationRisk: {
    key: "concentrationRisk",
    label: "Engineer concentration",
    unit: "pct",
    direction: "lower",
    top: 40,
    healthy: 60,
    warning: 75,
    why: "If one engineer carries most of the revenue, their absence is a single point of failure.",
    lever: "Cross-train staff and route bookings to build a second reliable engineer.",
  },
};

/** A graded metric result. `score` is a 0-100 health score for the metric. */
export type MetricGrade = {
  key: MetricKey;
  label: string;
  value: number;
  unit: "pct" | "ratio" | "usd";
  band: Band;
  score: number;
  /** Signed distance to the healthy edge, in the metric's units. Positive
   *  means "this far past healthy"; negative means "this far short". */
  gapToHealthy: number;
  why: string;
  lever: string;
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Classify a raw value into a band against its benchmark. */
export function bandFor(key: MetricKey, value: number): Band {
  const b = BENCHMARKS[key];
  if (b.direction === "higher") {
    if (value >= b.top) return "top";
    if (value >= b.healthy) return "healthy";
    if (value >= b.warning) return "warning";
    return "critical";
  }
  // lower is better
  if (value <= b.top) return "top";
  if (value <= b.healthy) return "healthy";
  if (value <= b.warning) return "warning";
  return "critical";
}

/** Map a value to a 0-100 score by piecewise-linear interpolation across the
 *  benchmark edges. Healthy sits at 70, top at 100, warning at 45, the
 *  critical floor at 0 - so a metric exactly "healthy" reads as a solid 70. */
export function scoreFor(key: MetricKey, value: number): number {
  const b = BENCHMARKS[key];
  // Anchor points as [edgeValue, score], ordered worst->best for interpolation.
  const anchors: Array<[number, number]> =
    b.direction === "higher"
      ? [
          [b.warning - (b.healthy - b.warning), 0],
          [b.warning, 45],
          [b.healthy, 70],
          [b.top, 100],
        ]
      : [
          [b.warning + (b.warning - b.healthy), 0],
          [b.warning, 45],
          [b.healthy, 70],
          [b.top, 100],
        ];
  // For "lower is better", flip so anchors are ascending in value.
  const pts = b.direction === "higher" ? anchors : [...anchors].reverse();
  // pts is ascending in value now.
  if (value <= pts[0][0]) return clamp(pts[0][1]);
  if (value >= pts[pts.length - 1][0]) return clamp(pts[pts.length - 1][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const [v0, s0] = pts[i];
    const [v1, s1] = pts[i + 1];
    if (value >= v0 && value <= v1) {
      const t = v1 === v0 ? 0 : (value - v0) / (v1 - v0);
      return clamp(s0 + t * (s1 - s0));
    }
  }
  return clamp(pts[pts.length - 1][1]);
}

/** Grade one metric end-to-end. */
export function gradeMetric(key: MetricKey, value: number): MetricGrade {
  const b = BENCHMARKS[key];
  const band = bandFor(key, value);
  const score = Math.round(scoreFor(key, value));
  const gapToHealthy = b.direction === "higher" ? value - b.healthy : b.healthy - value;
  return {
    key,
    label: b.label,
    value,
    unit: b.unit,
    band,
    score,
    gapToHealthy: Math.round(gapToHealthy * 100) / 100,
    why: b.why,
    lever: b.lever,
  };
}

/* ----------------------------------------------------------------
   Top-performer operating criteria. The qualitative checklist the
   agent uses alongside the numeric grades - "what well-run studios
   do". Each is phrased as a yes/no the engine can evaluate from a
   studio's own data.
   ---------------------------------------------------------------- */
export type TopPerformerCriterion = {
  key: string;
  label: string;
  detail: string;
};

export const TOP_PERFORMER_CRITERIA: TopPerformerCriterion[] = [
  { key: "deposits_mandatory", label: "Deposits gate every booking", detail: "Top studios never hold a room without money down - it is their no-show insurance." },
  { key: "fast_lead_response", label: "Leads answered within the hour", detail: "Speed-to-lead is the strongest predictor of conversion in appointment businesses." },
  { key: "high_utilization", label: "Rooms run at 50%+ utilization", detail: "Capacity is filled with promos, waitlists, and off-peak rates rather than left idle." },
  { key: "repeat_engine", label: "Retention is engineered, not hoped for", detail: "Recaps, reengagement, and membership packages turn one-off clients into regulars." },
  { key: "tight_ar", label: "Receivables collected on delivery", detail: "Cash is collected as work ships; dunning is automated, not manual and late." },
  { key: "scope_discipline", label: "Revisions are capped and billed", detail: "Included revisions are explicit and overages are invoiced, protecting per-song margin." },
  { key: "rights_before_release", label: "Splits executed before release", detail: "Rights metadata and split sheets are locked before delivery, never chased afterward." },
  { key: "bench_depth", label: "No single-engineer dependency", detail: "Revenue is spread across cross-trained staff so one absence does not stall the studio." },
];

/** Overall band from a set of metric grades, weighted equally unless weights
 *  are supplied. Returns a 0-100 score and a coarse band label. */
export function rollUp(
  grades: MetricGrade[],
  weights: Partial<Record<MetricKey, number>> = {},
): { score: number; band: Band } {
  if (grades.length === 0) return { score: 70, band: "healthy" };
  let wSum = 0;
  let acc = 0;
  for (const g of grades) {
    const w = weights[g.key] ?? 1;
    wSum += w;
    acc += g.score * w;
  }
  const score = Math.round(acc / Math.max(1, wSum));
  const band: Band = score >= 85 ? "top" : score >= 65 ? "healthy" : score >= 45 ? "warning" : "critical";
  return { score, band };
}
