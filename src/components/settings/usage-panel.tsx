"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Gauge } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

type MetricView = {
  metric: string;
  label: string;
  period: string;
  used: number;
  limit: number;
  unit?: "bytes" | "gb" | "count";
};

type Summary = {
  tier: string;
  tierLabel: string;
  metrics: MetricView[];
};

const UNLIMITED = 999_999;

/** Format a usage value with its unit. */
function fmtValue(v: number, unit?: MetricView["unit"]): string {
  if (unit === "gb") return `${v} GB`;
  return v.toLocaleString();
}

/** Format the cap, collapsing huge / sentinel caps to "Unlimited". */
function fmtLimit(limit: number, unit?: MetricView["unit"]): string {
  if (limit < 0 || limit >= UNLIMITED) return "Unlimited";
  if (unit === "gb") return `${limit} GB`;
  return limit.toLocaleString();
}

/** Pick a progress tone from the consumed ratio. */
function tone(used: number, limit: number): "gold" | "caution" | "critical" {
  if (limit < 0 || limit >= UNLIMITED) return "gold";
  const ratio = limit === 0 ? 1 : used / limit;
  if (ratio >= 1) return "critical";
  if (ratio >= 0.8) return "caution";
  return "gold";
}

function MeterRow({ m }: { m: MetricView }) {
  const unlimited = m.limit < 0 || m.limit >= UNLIMITED;
  const max = unlimited ? Math.max(m.used, 1) : m.limit;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-bone">{m.label}</span>
        <span className="text-xs tabular-nums text-steel">
          {fmtValue(m.used, m.unit)}
          <span className="text-steel/70"> / {fmtLimit(m.limit, m.unit)}</span>
        </span>
      </div>
      <Progress
        value={unlimited ? (m.used > 0 ? 0.04 : 0) : m.used}
        max={max}
        tone={tone(m.used, m.limit)}
      />
    </div>
  );
}

/** Plan usage meters - reads usage.summary and renders one bar per metric. */
export function UsagePanel() {
  const summary = useQuery(api.usage.summary) as Summary | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4 text-gold" />
          Usage this period
        </CardTitle>
        <CardDescription>
          {summary
            ? `What this workspace has consumed against the ${summary.tierLabel} plan.`
            : "What this workspace has consumed against its plan."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary === undefined ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        ) : (
          summary.metrics.map((m) => <MeterRow key={m.metric} m={m} />)
        )}
      </CardContent>
    </Card>
  );
}
