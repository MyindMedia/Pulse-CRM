"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { SOURCES, findSource } from "@convex/lib/reportEngine";
import { FileDown, Printer, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, Input } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { FileBarChart } from "lucide-react";
import { longDate } from "@/lib/format";
import {
  formatMetric,
  printReport,
  buildCsv,
  downloadCsv,
  type PrintableReport,
} from "@/lib/report-export";

const DAY = 86_400_000;

/** "YYYY-MM-DD" -> ms at local start of day (or null). */
function startMs(d: string): number | null {
  return d ? new Date(`${d}T00:00:00`).getTime() : null;
}
function endMs(d: string): number | null {
  return d ? new Date(`${d}T23:59:59.999`).getTime() : null;
}
/** ms -> "YYYY-MM-DD" for the date inputs. */
function toInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Preset = { label: string; days: number | "ytd" | "all" };
const PRESETS: Preset[] = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "12 months", days: 365 },
  { label: "Year to date", days: "ytd" },
  { label: "All time", days: "all" },
];

export function ReportBuilder() {
  const org = useQuery(api.orgs.current) as { name?: string } | undefined;
  const orgName = org?.name ?? "Pulse Studio";

  const [sourceKey, setSourceKey] = React.useState(SOURCES[0].key);
  const source = findSource(sourceKey) ?? SOURCES[0];

  const [groupBy, setGroupBy] = React.useState(source.defaultDim);
  const [metrics, setMetrics] = React.useState<Set<string>>(new Set(source.defaultMetrics));
  const [title, setTitle] = React.useState("");
  const [from, setFrom] = React.useState(() => toInput(Date.now() - 90 * DAY));
  const [to, setTo] = React.useState("");
  const [sortBy, setSortBy] = React.useState<string>("__default");
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const [limit, setLimit] = React.useState("");

  // Switching source resets the dimension + metrics to that source's defaults.
  function changeSource(key: string) {
    const next = findSource(key);
    if (!next) return;
    setSourceKey(key);
    setGroupBy(next.defaultDim);
    setMetrics(new Set(next.defaultMetrics));
    setSortBy("__default");
    setTitle("");
  }

  function toggleMetric(key: string) {
    setMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least one
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Stable ordered metric list (source order), for the query + the table.
  const metricKeys = React.useMemo(
    () => source.metrics.filter((m) => metrics.has(m.key)).map((m) => m.key),
    [source, metrics],
  );

  const fromMs = startMs(from);
  const toMs = endMs(to);

  const report = useQuery(
    api.reportBuilder.generate,
    metricKeys.length
      ? {
          source: sourceKey,
          from: fromMs,
          to: toMs,
          groupBy,
          metrics: metricKeys,
          sortBy: sortBy === "__default" ? null : sortBy,
          sortDir,
          limit: limit ? Math.max(1, parseInt(limit, 10) || 0) : null,
        }
      : "skip",
  );

  const dimLabel = source.dims.find((d) => d.key === groupBy)?.label ?? groupBy;
  const reportTitle = title.trim() || `${source.label} by ${dimLabel}`;

  function applyPreset(p: Preset) {
    setTo("");
    if (p.days === "all") {
      setFrom("");
    } else if (p.days === "ytd") {
      const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
      setFrom(toInput(jan1));
    } else {
      // eslint-disable-next-line react-hooks/purity -- click handler, not render
      setFrom(toInput(Date.now() - p.days * DAY));
    }
  }

  function dateRangeText(): string {
    if (!fromMs && !toMs) return "All time";
    const a = fromMs ? longDate(fromMs) : "Beginning";
    const b = toMs ? longDate(toMs) : "Today";
    return `${a} — ${b}`;
  }

  function buildPrintable(): PrintableReport | null {
    if (!report) return null;
    return {
      orgName,
      title: reportTitle,
      source: `${source.label} · grouped by ${dimLabel}`,
      dateRange: dateRangeText(),
      generatedAt: report.generatedAt,
      columns: report.columns,
      rows: report.rows,
      totals: report.totals,
    };
  }

  function onPrint() {
    const p = buildPrintable();
    if (!p) return;
    if (!printReport(p)) {
      toast.error("Allow pop-ups for this site to print / save the PDF.");
    }
  }

  function onCsv() {
    const p = buildPrintable();
    if (!p) return;
    const safe = reportTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    downloadCsv(`${safe || "report"}.csv`, buildCsv(p));
    toast.success("CSV downloaded");
  }

  const loading = report === undefined;
  const empty = report !== undefined && report.rows.length === 0;
  const canExport = report !== undefined && report.rows.length > 0;

  return (
    <div className="space-y-5">
      {/* ── Builder controls ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-gold" />
            Build a report
          </CardTitle>
          <CardDescription>
            Pick what to pull, the window, how to group it and which numbers to total. Then print to
            PDF or export the data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Report name" hint="Shown as the title on the printout.">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${source.label} by ${dimLabel}`}
              />
            </Field>

            <Field label="Data source">
              <Select value={sourceKey} onValueChange={changeSource}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <p className="-mt-1 text-xs text-steel/70">{source.description}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Group by">
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {source.dims.map((d) => (
                    <SelectItem key={d.key} value={d.key}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Limit" hint="Top N rows - leave blank for all.">
              <Input
                inputMode="numeric"
                value={limit}
                onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="All"
              />
            </Field>
          </div>

          {/* Metrics */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-steel">Metrics to total</p>
            <div className="flex flex-wrap gap-2">
              {source.metrics.map((m) => {
                const on = metrics.has(m.key);
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => toggleMetric(m.key)}
                    className={
                      "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors " +
                      (on
                        ? "border-gold/50 bg-gold/10 text-bone"
                        : "border-graphite/60 bg-coal-2 text-steel/80 hover:text-bone")
                    }
                  >
                    <Checkbox checked={on} className="pointer-events-none" />
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date range + presets */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-steel">Date range</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="From" htmlFor="rb-from" className="w-40">
                <Input id="rb-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="To" htmlFor="rb-to" className="w-40">
                <Input id="rb-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <div className="flex flex-wrap gap-1.5 pb-1">
                {PRESETS.map((p) => (
                  <Button key={p.label} variant="ghost" size="sm" onClick={() => applyPreset(p)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Sort */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sort by">
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">First metric (default)</SelectItem>
                  <SelectItem value="group">{dimLabel} (label)</SelectItem>
                  {source.metrics
                    .filter((m) => metrics.has(m.key))
                    .map((m) => (
                      <SelectItem key={m.key} value={m.key}>
                        {m.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Direction">
              <Select value={sortDir} onValueChange={(v) => setSortDir(v as "asc" | "desc")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">High to low</SelectItem>
                  <SelectItem value="asc">Low to high</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* ── Preview + export ── */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{reportTitle}</CardTitle>
            <CardDescription>
              {dateRangeText()}
              {report ? ` · ${report.rowCount} ${report.rowCount === 1 ? "row" : "rows"}` : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={onCsv} disabled={!canExport}>
              <FileDown className="size-3.5" />
              CSV
            </Button>
            <Button variant="primary" size="sm" onClick={onPrint} disabled={!canExport}>
              <Printer className="size-3.5" />
              Print / PDF
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-56 w-full" />
          ) : empty ? (
            <EmptyState
              icon={FileBarChart}
              title="No data in this range"
              description="Widen the date range or pick a different source to see results."
              className="border-0 bg-transparent"
            />
          ) : report ? (
            <Table>
              <THead>
                <TR>
                  {report.columns.map((c, i) => (
                    <TH key={c.key} className={i === 0 ? "" : "text-right"}>
                      {c.label}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {report.rows.map((row) => (
                  <TR key={row.group}>
                    {report.columns.map((c, i) =>
                      i === 0 ? (
                        <TD key={c.key} className="font-medium">
                          {row.group}
                        </TD>
                      ) : (
                        <TD key={c.key} className="text-right tabular-nums text-steel">
                          {formatMetric(row.values[c.key] ?? 0, c.format)}
                        </TD>
                      ),
                    )}
                  </TR>
                ))}
                {/* Totals row */}
                <TR className="border-t-2 border-graphite/70">
                  {report.columns.map((c, i) =>
                    i === 0 ? (
                      <TD key={c.key} className="font-semibold text-bone">
                        Total
                      </TD>
                    ) : (
                      <TD key={c.key} className="text-right font-meta font-semibold tabular-nums text-gold">
                        {formatMetric(report.totals[c.key] ?? 0, c.format)}
                      </TD>
                    ),
                  )}
                </TR>
              </TBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
