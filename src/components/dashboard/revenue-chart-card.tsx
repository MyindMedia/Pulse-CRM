"use client";

import { useId, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Delta, DeltaIcon, DeltaValue } from "@/components/delta";
import { Skeleton } from "@/components/ui/skeleton";
import { money } from "@/lib/format";

const chartConfig = {
  revenue: {
    label: "Collected",
    color: "var(--color-gold)",
  },
} satisfies ChartConfig;

/**
 * The money line - collected revenue per month as a gold gradient area
 * (dashboard-3's volume-chart interface on the Pulse palette). Range select
 * trims the window; the delta chip is month-over-month. Renders nothing for
 * viewers without financial visibility.
 */
export function RevenueChartCard({ className }: { className?: string }) {
  const data = useQuery(api.dashboard.overview);
  const uid = useId().replace(/:/g, "");
  const gradId = `revenue-area-grad-${uid}`;
  const [months, setMonths] = useState<6 | 12>(12);

  const rows = useMemo(
    () => (data?.charts.revenueTrend ?? []).slice(-months),
    [data, months],
  );

  if (data && !data.canSeeFinancials) return null;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {data && (
            <Delta value={(data.kpis.revenueDelta ?? 0) * 100} variant="badge">
              <DeltaIcon variant="trend" />
              <DeltaValue />
            </Delta>
          )}
          <CardDescription>Collected per month across the studio.</CardDescription>
        </div>
        <Select value={String(months)} onValueChange={(v) => setMonths(Number(v) as 6 | 12)}>
          <SelectTrigger aria-label="Revenue time range" className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="6">Last 6 months</SelectItem>
            <SelectItem value="12">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <ChartContainer className="h-[220px] w-full" config={chartConfig}>
            <AreaChart accessibilityLayer data={rows} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.4} />
                  <stop offset="55%" stopColor="var(--color-revenue)" stopOpacity={0.1} />
                  <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={8} />
              <YAxis
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => money(v * 100, { compact: true })}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value) => money(Number(value) * 100)}
                    hideIndicator
                  />
                }
              />
              <Area
                dataKey="revenue"
                type="monotone"
                fill={`url(#${gradId})`}
                stroke="var(--color-revenue)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
