/* ============================================================
   Custom report engine - the declarative core behind the Reports
   page "Report Builder".

   A small, PURE aggregation engine: given a set of normalized
   records (gathered org-scoped in reportBuilder.ts) and a spec
   (which source, date range, group-by dimension, and metrics), it
   buckets, aggregates, sorts and totals - with no Convex / ctx
   dependency, so it is fully unit-testable and safe to import from
   BOTH the server query and the client builder UI (single source of
   truth for the available sources, dimensions and metrics).

   "Any type of report" = pick a source (sessions / money / invoices
   / staffing), a date window, one dimension to group by, and one or
   more metrics to aggregate. The output is a table the UI renders,
   prints to PDF, or exports to CSV.
   ============================================================ */

export type MetricFormat = "money" | "number" | "hours";
export type ColumnFormat = MetricFormat | "text";

/** How a metric is reduced over the records in a group. */
export type MetricCompute =
  | { kind: "count" }
  | { kind: "sum"; field: string }
  /** A derived ratio, e.g. average = sum(num) / count. `den: "count"` divides
   *  by the bucket's record count; otherwise by another summed field. */
  | { kind: "ratio"; num: string; den: string };

export type MetricDef = {
  key: string;
  label: string;
  format: MetricFormat;
  compute: MetricCompute;
};

export type DimDef = { key: string; label: string };

export type SourceDef = {
  key: string;
  label: string;
  description: string;
  dims: DimDef[];
  metrics: MetricDef[];
  defaultDim: string;
  defaultMetrics: string[];
};

/** A record normalized for the engine: a timestamp for date filtering, the
 *  group-label for every dimension, and the raw numeric fields metrics read. */
export type NormRecord = {
  ts: number;
  dims: Record<string, string>;
  nums: Record<string, number>;
};

export type ReportSpec = {
  source: string;
  from?: number | null;
  to?: number | null;
  groupBy: string;
  metrics: string[];
  /** A metric key, or "group" to sort by the dimension label. */
  sortBy?: string | null;
  sortDir?: "asc" | "desc";
  limit?: number | null;
};

export type ReportColumn = { key: string; label: string; format: ColumnFormat };
export type ReportRow = { group: string; values: Record<string, number> };
export type ReportResult = {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, number>;
  rowCount: number;
};

/* ----------------------------------------------------------------
   The catalog - every source the builder can report on, with the
   dimensions you can group by and the metrics you can aggregate.
   ---------------------------------------------------------------- */
export const SOURCES: SourceDef[] = [
  {
    key: "sessions",
    label: "Sessions & bookings",
    description: "Studio sessions - hours booked, revenue, what's collected vs owed, comps.",
    defaultDim: "room",
    defaultMetrics: ["sessions", "hours", "revenue"],
    dims: [
      { key: "room", label: "Room" },
      { key: "engineer", label: "Engineer" },
      { key: "client", label: "Client" },
      { key: "service", label: "Service type" },
      { key: "status", label: "Status" },
      { key: "month", label: "Month" },
      { key: "weekday", label: "Weekday" },
      { key: "comped", label: "Comped vs charged" },
    ],
    metrics: [
      { key: "sessions", label: "Sessions", format: "number", compute: { kind: "count" } },
      { key: "hours", label: "Booked hours", format: "hours", compute: { kind: "sum", field: "hours" } },
      { key: "revenue", label: "Booked revenue", format: "money", compute: { kind: "sum", field: "revenue" } },
      { key: "collected", label: "Collected", format: "money", compute: { kind: "sum", field: "collected" } },
      { key: "outstanding", label: "Outstanding", format: "money", compute: { kind: "sum", field: "outstanding" } },
      { key: "compedValue", label: "Comped value", format: "money", compute: { kind: "sum", field: "comped" } },
      { key: "avgRevenue", label: "Avg / session", format: "money", compute: { kind: "ratio", num: "revenue", den: "count" } },
    ],
  },
  {
    key: "payments",
    label: "Payments (money in)",
    description: "Cleared payments from the booking ledger - cash collected, by type and time.",
    defaultDim: "month",
    defaultMetrics: ["payments", "amount"],
    dims: [
      { key: "kind", label: "Payment type" },
      { key: "provider", label: "Provider" },
      { key: "month", label: "Month" },
      { key: "weekday", label: "Weekday" },
    ],
    metrics: [
      { key: "payments", label: "Payments", format: "number", compute: { kind: "count" } },
      { key: "amount", label: "Amount collected", format: "money", compute: { kind: "sum", field: "amount" } },
      { key: "avgPayment", label: "Avg payment", format: "money", compute: { kind: "ratio", num: "amount", den: "count" } },
    ],
  },
  {
    key: "invoices",
    label: "Invoices & AR",
    description: "Invoices billed, collected and still outstanding - by status, client or month.",
    defaultDim: "status",
    defaultMetrics: ["invoices", "billed", "outstanding"],
    dims: [
      { key: "status", label: "Status" },
      { key: "client", label: "Client" },
      { key: "month", label: "Month" },
    ],
    metrics: [
      { key: "invoices", label: "Invoices", format: "number", compute: { kind: "count" } },
      { key: "billed", label: "Billed", format: "money", compute: { kind: "sum", field: "amount" } },
      { key: "collected", label: "Collected", format: "money", compute: { kind: "sum", field: "collected" } },
      { key: "outstanding", label: "Outstanding", format: "money", compute: { kind: "sum", field: "outstanding" } },
    ],
  },
  {
    key: "shifts",
    label: "Staff schedule",
    description: "Staff shifts and hours scheduled - by team member, role, room or time.",
    defaultDim: "member",
    defaultMetrics: ["shifts", "hours"],
    dims: [
      { key: "member", label: "Team member" },
      { key: "role", label: "Role" },
      { key: "room", label: "Room" },
      { key: "status", label: "Status" },
      { key: "month", label: "Month" },
      { key: "weekday", label: "Weekday" },
    ],
    metrics: [
      { key: "shifts", label: "Shifts", format: "number", compute: { kind: "count" } },
      { key: "hours", label: "Scheduled hours", format: "hours", compute: { kind: "sum", field: "hours" } },
    ],
  },
];

export function findSource(key: string): SourceDef | undefined {
  return SOURCES.find((s) => s.key === key);
}

/* ----------------------------------------------------------------
   The pure aggregator.
   ---------------------------------------------------------------- */

function valueOf(m: MetricDef, count: number, sums: Record<string, number>): number {
  const c = m.compute;
  if (c.kind === "count") return count;
  if (c.kind === "sum") return sums[c.field] ?? 0;
  const den = c.den === "count" ? count : sums[c.den] ?? 0;
  return den ? (sums[c.num] ?? 0) / den : 0;
}

/** Aggregate normalized records into a report table. Pure - no ctx, no IO. */
export function buildReport(records: NormRecord[], spec: ReportSpec, source: SourceDef): ReportResult {
  const dim = source.dims.find((d) => d.key === spec.groupBy);
  if (!dim) throw new Error(`Unknown dimension "${spec.groupBy}" for ${source.label}`);

  // Resolve + validate the requested metrics against the source (skip unknowns).
  const metricDefs = spec.metrics
    .map((k) => source.metrics.find((m) => m.key === k))
    .filter((m): m is MetricDef => Boolean(m));
  if (metricDefs.length === 0) throw new Error("Pick at least one metric to report on.");

  // Which summed fields do we need to accumulate (for sums + ratio num/den)?
  const sumFields = new Set<string>();
  for (const m of metricDefs) {
    if (m.compute.kind === "sum") sumFields.add(m.compute.field);
    else if (m.compute.kind === "ratio") {
      sumFields.add(m.compute.num);
      if (m.compute.den !== "count") sumFields.add(m.compute.den);
    }
  }

  type Bucket = { group: string; count: number; sums: Record<string, number> };
  const groups = new Map<string, Bucket>();
  const totalsBucket: Bucket = { group: "Total", count: 0, sums: {} };

  const add = (b: Bucket, rec: NormRecord) => {
    b.count += 1;
    for (const f of sumFields) b.sums[f] = (b.sums[f] ?? 0) + (rec.nums[f] ?? 0);
  };

  const from = spec.from ?? null;
  const to = spec.to ?? null;
  for (const rec of records) {
    if (from != null && rec.ts < from) continue;
    if (to != null && rec.ts > to) continue;
    const g = rec.dims[spec.groupBy] || "—";
    let bucket = groups.get(g);
    if (!bucket) {
      bucket = { group: g, count: 0, sums: {} };
      groups.set(g, bucket);
    }
    add(bucket, rec);
    add(totalsBucket, rec);
  }

  let rows: ReportRow[] = [...groups.values()].map((b) => ({
    group: b.group,
    values: Object.fromEntries(metricDefs.map((m) => [m.key, valueOf(m, b.count, b.sums)])),
  }));

  // Sort: default to the first metric, descending (biggest first).
  const sortBy = spec.sortBy ?? metricDefs[0].key;
  const dir = spec.sortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    if (sortBy === "group") return a.group.localeCompare(b.group) * dir;
    return ((a.values[sortBy] ?? 0) - (b.values[sortBy] ?? 0)) * dir;
  });

  if (spec.limit && spec.limit > 0) rows = rows.slice(0, spec.limit);

  const totals = Object.fromEntries(
    metricDefs.map((m) => [m.key, valueOf(m, totalsBucket.count, totalsBucket.sums)]),
  );

  const columns: ReportColumn[] = [
    { key: "group", label: dim.label, format: "text" },
    ...metricDefs.map((m) => ({ key: m.key, label: m.label, format: m.format })),
  ];

  return { columns, rows, totals, rowCount: rows.length };
}
