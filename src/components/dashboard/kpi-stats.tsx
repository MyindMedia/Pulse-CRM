"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { cn } from "@/lib/utils";
import { money, compactNumber } from "@/lib/format";

type StatCard = {
  label: string;
  value: string;
  /** Percent delta (already x100). Omit to show the footnote alone. */
  delta?: number;
  footnote: string;
  critical?: boolean;
};

/**
 * The studio KPI row - quiet label-top stat cards with delta chips
 * (dashboard-3 interface language on the Pulse palette). Same six numbers
 * the dashboard always carried; financial cards stay capability-gated.
 */
export function KpiStats() {
  const data = useQuery(api.dashboard.overview);

  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  const fin = data.canSeeFinancials;
  const k = data.kpis;
  const cards: StatCard[] = [
    ...(fin
      ? [{
          label: "Revenue · MTD",
          value: money(k.revenueThisMonth ?? 0, { compact: true }),
          delta: (k.revenueDelta ?? 0) * 100,
          footnote: "vs last month",
        }]
      : []),
    { label: "Sessions · MTD", value: String(k.sessionsThisMonth), footnote: "booked this month" },
    ...(fin
      ? [{
          label: "Pipeline value",
          value: money(k.pipelineValue ?? 0, { compact: true }),
          footnote: "open opportunities",
        },
        {
          label: "Outstanding",
          value: money(k.outstandingCents ?? 0, { compact: true }),
          footnote: k.overdueCount ? `${k.overdueCount} overdue` : "all current",
          critical: Boolean(k.overdueCount),
        }]
      : []),
    { label: "New leads · 7d", value: String(k.newLeadsThisWeek), footnote: "into the pipeline" },
    ...(fin
      ? [{
          label: "Avg session",
          value: money(k.avgSessionValue ?? 0, { compact: true }),
          footnote: `${compactNumber(k.sessionsThisMonth)} this month`,
        }]
      : []),
  ];

  return (
    <div
      className={cn(
        "rise-stagger grid grid-cols-2 gap-3",
        fin ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-2",
      )}
    >
      {cards.map((s) => (
        <Card key={s.label}>
          <CardHeader className="pb-0">
            <CardTitle className="font-meta text-[0.625rem] font-normal uppercase tracking-wide text-steel/80">
              {s.label}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5 pt-2">
            <p className="font-grotesk text-2xl font-bold tabular-nums text-bone">{s.value}</p>
            <div className="flex items-center gap-1.5 text-xs">
              {s.delta !== undefined && (
                <Delta value={s.delta}>
                  <DeltaIcon variant="trend" />
                  <DeltaValue />
                </Delta>
              )}
              <span className={s.critical ? "text-critical" : "text-steel/70"}>{s.footnote}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
