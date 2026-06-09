"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { money, shortDate, timeOfDay } from "@/lib/format";
import { ReportCard } from "./report-shell";

/** Upcoming sessions ranked by learned no-show risk, with a deposit nudge. */
export function AtRiskSessionsReport() {
  const rows = useQuery(api.predictions.upcomingRisks, { limit: 25 });
  const atRisk = (rows ?? []).filter((r) => r.band !== "low");

  return (
    <ReportCard
      title="At-risk upcoming sessions"
      description="No-show risk learned from this studio's own history. High-risk slots are worth a larger deposit before they fall through."
      loading={rows === undefined}
      empty={rows !== undefined && atRisk.length === 0}
      emptyTitle="No elevated risk"
      emptyDescription="Every upcoming session looks solid based on history and deposits."
    >
      <Table>
        <THead>
          <TR>
            <TH>Session</TH>
            <TH>When</TH>
            <TH>Why</TH>
            <TH className="w-[22%]">Risk</TH>
            <TH className="text-right">Suggested deposit</TH>
          </TR>
        </THead>
        <TBody>
          {atRisk.map((r) => {
            const tone = r.band === "high" ? "critical" : "caution";
            return (
              <TR key={r.sessionId}>
                <TD className="font-medium">
                  {r.title}
                  <span className="block text-xs text-steel/70">{r.artistName}</span>
                </TD>
                <TD className="text-steel">
                  {shortDate(r.startTime)}
                  <span className="block text-xs text-steel/70">{timeOfDay(r.startTime)}</span>
                </TD>
                <TD className="max-w-[18rem] text-xs text-steel">{r.reasons[0]}</TD>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Progress value={r.score} max={100} tone={tone} className="flex-1" />
                    <span className="w-8 text-right font-meta text-xs tabular-nums text-bone">{r.score}</span>
                  </div>
                </TD>
                <TD className="text-right">
                  <Badge tone={r.band === "high" ? "critical" : "gold"}>{r.suggestedDepositPct}%</Badge>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </ReportCard>
  );
}

const PRICING_ICON = {
  raise: ArrowUpRight,
  discount: ArrowDownRight,
  hold: Minus,
} as const;

/** Dynamic-pricing recommendations from real room utilisation. */
export function PricingRecommendationsReport() {
  const rows = useQuery(api.predictions.roomPricing, {});

  return (
    <ReportCard
      title="Pricing recommendations"
      description="Room utilisation over the last 30 days, with a rate move to capture demand or fill idle time."
      loading={rows === undefined}
      empty={rows !== undefined && rows.length === 0}
      emptyTitle="No rooms yet"
      emptyDescription="Add rooms and book sessions to see pricing recommendations."
    >
      <Table>
        <THead>
          <TR>
            <TH>Room</TH>
            <TH className="w-[26%]">Utilization</TH>
            <TH className="text-right">Current rate</TH>
            <TH>Recommendation</TH>
            <TH className="text-right">Suggested</TH>
          </TR>
        </THead>
        <TBody>
          {(rows ?? []).map((r) => {
            const Icon = PRICING_ICON[r.action];
            const tone = r.action === "raise" ? "positive" : r.action === "discount" ? "caution" : "info";
            const utilTone = r.utilizationPct >= 85 ? "positive" : r.utilizationPct <= 30 ? "caution" : "info";
            return (
              <TR key={r.roomId}>
                <TD className="font-medium">{r.name}</TD>
                <TD>
                  <div className="flex items-center gap-2.5">
                    <Progress value={r.utilizationPct} max={100} tone={utilTone} className="flex-1" />
                    <span className="w-9 text-right font-meta text-xs tabular-nums text-bone">{r.utilizationPct}%</span>
                  </div>
                </TD>
                <TD className="text-right font-meta tabular-nums text-steel">
                  {r.hourlyRateCents > 0 ? `${money(r.hourlyRateCents)}/hr` : "-"}
                </TD>
                <TD>
                  <span className="inline-flex items-center gap-1.5 text-xs text-steel">
                    <Icon className={`size-3.5 ${tone === "positive" ? "text-positive" : tone === "caution" ? "text-caution" : "text-steel/70"}`} />
                    <span className="max-w-[16rem]">{r.reason}</span>
                  </span>
                </TD>
                <TD className="text-right font-meta tabular-nums font-semibold text-bone">
                  {r.action === "hold" ? "-" : `${money(r.suggestedRateCents)}/hr`}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </ReportCard>
  );
}
