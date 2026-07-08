"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { HBars, CategoryDonut } from "@/components/charts";
import { RecoveredByPulse } from "@/components/dashboard/recovered-by-pulse";

/* Self-contained dashboard tiles (each subscribes to its own data - Convex
   dedupes identical queries) so the customizable grid can mount them in any
   order or drop them entirely. */

export function PipelineChartCard() {
  const data = useQuery(api.dashboard.overview);
  return (
    <Card>
      <CardContent className="pt-5">
        {!data ? (
          <Skeleton className="h-[160px] w-full" />
        ) : data.charts.pipelineByStage.length === 0 ? (
          <p className="py-10 text-center text-sm text-steel/70">No open opportunities.</p>
        ) : (
          <HBars data={data.charts.pipelineByStage} labelKey="stage" valueKey="count" />
        )}
      </CardContent>
    </Card>
  );
}

export function ServiceChartCard() {
  const data = useQuery(api.dashboard.overview);
  return (
    <Card>
      <CardContent className="pt-5">
        {!data ? (
          <Skeleton className="h-[200px] w-full" />
        ) : data.charts.bookingsByService.length === 0 ? (
          <p className="py-10 text-center text-sm text-steel/70">No sessions yet.</p>
        ) : (
          <CategoryDonut data={data.charts.bookingsByService} labelKey="service" valueKey="count" />
        )}
      </CardContent>
    </Card>
  );
}

export function CatalogChartCard() {
  const data = useQuery(api.dashboard.overview);
  return (
    <Card>
      <CardContent className="pt-5">
        {!data ? (
          <Skeleton className="h-[160px] w-full" />
        ) : data.charts.songsByStage.length === 0 ? (
          <p className="py-10 text-center text-sm text-steel/70">No songs yet.</p>
        ) : (
          <HBars data={data.charts.songsByStage} labelKey="stage" valueKey="count" />
        )}
      </CardContent>
    </Card>
  );
}

export function InsightsCard() {
  const insights = useQuery(api.insights.open, { limit: 4 });
  return (
    <Card className="gap-0">
      <CardContent className="p-0">
        {insights === undefined ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : insights.length === 0 ? (
          <p className="py-10 text-center text-sm text-steel/70">No open nudges.</p>
        ) : (
          <ul className="divide-y divide-hairline-2/40">
            {insights.map((it) => (
              <li key={it._id} className="px-4 py-3">
                <p className="text-sm font-medium text-bone">{it.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-steel">{it.body}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Recovered-by-Pulse, self-gated to financial viewers so the widget can
 *  live anywhere in the grid. */
export function RecoveredCard() {
  const data = useQuery(api.dashboard.overview);
  if (data && !data.canSeeFinancials) return null;
  return <RecoveredByPulse />;
}
