"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3, Lock } from "lucide-react";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";

/* State of the Recording Studio.

   Owners have no numbers, and rates have been flat four years running. This
   is the first time most of them will see where they actually sit.

   The suppression rule is stated on the page rather than buried: a cohort
   under the floor shows as withheld, not as a rounded guess. */

function Delta({ value, unit, goodWhenHigh }: { value: number | null; unit: string; goodWhenHigh: boolean }) {
  if (value === null) return <span className="text-steel/60">-</span>;
  const good = goodWhenHigh ? value >= 0 : value <= 0;
  const sign = value > 0 ? "+" : "";
  return (
    <span className={cn("font-mono tabular-nums", good ? "text-positive" : "text-caution")}>
      {sign}{value}{unit}
    </span>
  );
}

export function BenchmarkCard({ windowDays = 90 }: { windowDays?: number }) {
  const r = useQuery(api.benchmark.report, { windowDays });

  if (!r) {
    return (
      <Card><CardContent className="pt-5"><p className="text-sm text-steel">Loading the benchmark…</p></CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <BarChart3 className="size-4" />
          </span>
          <div>
            <p className="font-grotesk text-sm font-semibold text-bone">
              State of the Recording Studio
            </p>
            <p className="text-xs text-steel">
              Anonymized across {r.contributingStudios} studio
              {r.contributingStudios === 1 ? "" : "s"} on Pulse, last {r.windowDays} days.
            </p>
          </div>
        </div>

        {!r.publishable ? (
          <div className="flex items-start gap-2.5 rounded-md border border-graphite/50 bg-coal/40 px-3 py-3">
            <Lock className="mt-0.5 size-4 shrink-0 text-steel/60" />
            <p className="text-xs leading-relaxed text-steel">
              Not enough studios yet. A number is only published once at least {r.minCohort}
              {" "}studios contribute to it, so nobody's individual business can be read out of
              the average. Right now that is {r.contributingStudios}.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md bg-graphite/40">
              <Tile
                label="Median rate"
                value={r.overall.medianHourlyCents !== null ? `${money(r.overall.medianHourlyCents)}/hr` : "-"}
                sub={
                  r.overall.p25HourlyCents !== null && r.overall.p75HourlyCents !== null
                    ? `${money(r.overall.p25HourlyCents)} to ${money(r.overall.p75HourlyCents)}`
                    : undefined
                }
              />
              <Tile label="Median utilization" value={`${r.overall.medianUtilizationPct ?? "-"}%`} />
              <Tile label="Median no-shows" value={`${r.overall.medianNoShowPct ?? "-"}%`} />
            </div>

            {r.comparison && (
              <div className="rounded-md border border-gold/25 bg-gold/8 px-3.5 py-3">
                <p className="font-meta text-[0.625rem] uppercase tracking-[0.1em] text-steel/70">
                  Where you sit
                </p>
                <div className="mt-2 grid gap-x-5 gap-y-1.5 text-xs sm:grid-cols-3">
                  <p className="flex justify-between gap-2">
                    <span className="text-steel">Your rate</span>
                    <Delta value={r.comparison.rateDeltaPct} unit="%" goodWhenHigh />
                  </p>
                  <p className="flex justify-between gap-2">
                    <span className="text-steel">Utilization</span>
                    <Delta value={r.comparison.utilizationDeltaPts} unit=" pts" goodWhenHigh />
                  </p>
                  <p className="flex justify-between gap-2">
                    <span className="text-steel">No-shows</span>
                    <Delta value={r.comparison.noShowDeltaPts} unit=" pts" goodWhenHigh={false} />
                  </p>
                </div>
              </div>
            )}

            {r.byRegion.filter((x) => !x.suppressed).length > 0 && (
              <div>
                <p className="font-meta text-[0.625rem] uppercase tracking-[0.1em] text-steel/60">
                  By market
                </p>
                <ul className="mt-1.5 space-y-1">
                  {r.byRegion.map((x) => (
                    <li key={x.label} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate text-steel">
                        {x.label}
                        <span className="ml-1.5 text-steel/50">({x.studios})</span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-bone">
                        {x.suppressed
                          ? <span className="text-steel/50">withheld</span>
                          : `${money(x.medianHourlyCents!)}/hr`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        <p className="border-t border-graphite/50 pt-3 text-[0.7rem] leading-relaxed text-steel/60">
          Medians, never totals, and never fewer than {r.minCohort} studios behind a number.
          Your own figures are yours alone and are never shown to anybody else.
        </p>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-coal/50 px-3 py-2.5">
      <p className="font-meta text-[0.625rem] uppercase tracking-[0.08em] text-steel/60">{label}</p>
      <p className="mt-0.5 font-mono text-base tabular-nums text-bone">{value}</p>
      {sub && <p className="mt-0.5 text-[0.65rem] text-steel/60">{sub}</p>}
    </div>
  );
}
