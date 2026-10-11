"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { AreaChart } from "@/components/charts/area-chart";
import { Area } from "@/components/charts/area";
import { Grid } from "@/components/charts/grid";
import { XAxis } from "@/components/charts/x-axis";
import { ChartTooltip } from "@/components/charts/tooltip";
import { Chassis, ChassisTitle, KeyBank, usd } from "./parts";

type Range = "30d" | "90d" | "ytd";
const RANGES = [
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "ytd", label: "YTD" },
] as const;

/* Collected revenue over time (kit 6.2 "booking revenue chart"), on Bklit's
 * AreaChart per spec 5.5: inside a well's screen, one yellow series with a
 * fade fill, the 8% yellow grid, a dashed crosshair with the date pill, and
 * a sweep while it loads. Colours come from the --chart-* tokens in
 * hardware.css. Same data as the revenue tile (dashboard.revenueSeries). */
export function BookingRevenue() {
  const [range, setRange] = React.useState<Range>("30d");
  const series = useQuery(api.dashboard.revenueSeries, { range });
  const data = React.useMemo(
    () => (series?.points ?? []).map((p) => ({ date: new Date(p.start), revenue: p.cents / 100 })),
    [series],
  );
  const empty = series !== undefined && data.every((d) => d.revenue === 0);

  return (
    <Chassis>
      <ChassisTitle
        title="Booking revenue"
        bar={false}
        right={<KeyBank label="Revenue range" options={RANGES} value={range} onChange={setRange} />}
      />
      <div className="pl-well mt-3 flex flex-1 flex-col p-3">
        <div className="pl-screen relative min-h-[150px] flex-1 overflow-hidden">
          <AreaChart
            data={data}
            xDataKey="date"
            status={series === undefined ? "loading" : "ready"}
            loadingLabel="Loading revenue…"
            animationDuration={1100}
            yDomainTween
            aspectRatio="auto"
            style={{ height: "100%" }}
            margin={{ top: 14, right: 26, bottom: 26, left: 26 }}
          >
            <Grid horizontal vertical stroke="var(--chart-grid)" strokeOpacity={1} />
            <Area dataKey="revenue" fill="var(--chart-line-primary)" fillOpacity={0.32} fadeEdges strokeWidth={2} />
            <XAxis numTicks={3} />
            <ChartTooltip
              matchCrosshair
              indicatorColor="var(--pl-yellow)"
              indicatorDasharray="3 3"
              rows={(point) => [{ color: "var(--pl-yellow)", label: "Collected", value: usd(Number(point.revenue ?? 0) * 100) }]}
            />
          </AreaChart>
          {empty && (
            <p className="pointer-events-none absolute inset-x-0 top-3 text-center font-sans text-xs text-steel">
              No revenue collected in this range yet.
            </p>
          )}
        </div>
      </div>
    </Chassis>
  );
}
