"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { meta, RELIABILITY } from "@/lib/labels";
import { ReportCard, ReportStat } from "./report-shell";

export function NoShowRiskReport() {
  const data = useQuery(api.reports.noShowRisk);
  const empty = data !== undefined && data.rows.length === 0;

  return (
    <ReportCard
      title="No-show risk"
      description="Clients flagged for reliability or with no-shows on record, scored 0-100."
      loading={data === undefined}
      empty={empty}
      emptyTitle="No flagged clients"
      emptyDescription="Every client is in good standing - no watch flags or no-shows."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <ReportStat label="Flagged" value={String(data.flaggedCount)} tone="critical" />
            <ReportStat label="On watch" value={String(data.watchCount)} tone="caution" />
            <ReportStat label="Total no-shows" value={String(data.totalNoShows)} />
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Client</TH>
                <TH>Reliability</TH>
                <TH className="text-right">No-shows</TH>
                <TH className="text-right">Sessions</TH>
                <TH className="w-[26%]">Risk score</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => {
                const rel = meta(RELIABILITY, r.reliability);
                const tone =
                  r.band === "high" ? "critical" : r.band === "medium" ? "caution" : "info";
                return (
                  <TR key={r.artistId}>
                    <TD className="font-medium">{r.artistName}</TD>
                    <TD>
                      <Badge tone={rel.tone}>{rel.label}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-steel">{r.noShows}</TD>
                    <TD className="text-right tabular-nums text-steel/70">{r.sessionCount}</TD>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Progress value={r.riskScore} max={100} tone={tone} className="flex-1" />
                        <span className="w-8 text-right font-meta text-xs tabular-nums text-bone">
                          {r.riskScore}
                        </span>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      )}
    </ReportCard>
  );
}
