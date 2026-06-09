"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { FileBarChart, type LucideIcon } from "lucide-react";

/** A report card with a heading + description and a loading / empty / loaded body. */
export function ReportCard({
  title,
  description,
  trailing,
  loading,
  empty,
  emptyIcon = FileBarChart,
  emptyTitle = "Nothing to report",
  emptyDescription = "Data will appear here once the studio has activity.",
  children,
}: {
  title: string;
  description?: string;
  trailing?: React.ReactNode;
  loading?: boolean;
  empty?: boolean;
  emptyIcon?: LucideIcon;
  emptyTitle?: string;
  emptyDescription?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {trailing}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-48 w-full" />
        ) : empty ? (
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            className="border-0 bg-transparent"
          />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** Compact stat shown above a report table - "Total outstanding", etc. */
export function ReportStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "gold" | "critical" | "positive" | "caution";
}) {
  const color =
    tone === "gold"
      ? "text-gold"
      : tone === "critical"
        ? "text-critical"
        : tone === "positive"
          ? "text-positive"
          : tone === "caution"
            ? "text-caution"
            : "text-bone";
  return (
    <div className="rounded-lg border border-graphite/50 bg-coal-2 px-3.5 py-2.5">
      <p className="overline">{label}</p>
      <p className={`mt-1 font-grotesk text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
