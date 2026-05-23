"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { money, shortDate } from "@/lib/format";
import { meta, ARTIST_STATUS } from "@/lib/labels";
import { ReportCard, ReportStat } from "./report-shell";

export function DormantClientsReport() {
  const data = useQuery(api.reports.dormantClients);
  const empty = data !== undefined && data.rows.length === 0;

  return (
    <ReportCard
      title="Dormant clients"
      description="Clients with no session in 60+ days, ranked by lifetime value - prime for re-engagement."
      loading={data === undefined}
      empty={empty}
      emptyTitle="No dormant clients"
      emptyDescription="Everyone with a session history has been active in the last 60 days."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <ReportStat label="Quiet 60+ days" value={String(data.count60)} tone="caution" />
            <ReportStat label="Quiet 90+ days" value={String(data.count90)} tone="critical" />
            <ReportStat label="Value at risk" value={money(data.dormantValueCents, { compact: true })} tone="gold" />
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Client</TH>
                <TH>Status</TH>
                <TH className="text-right">Sessions</TH>
                <TH className="text-right">Lifetime value</TH>
                <TH className="text-right">Last active</TH>
                <TH className="text-right">Quiet for</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => {
                const st = meta(ARTIST_STATUS, r.status);
                return (
                  <TR key={r.artistId}>
                    <TD className="font-medium">{r.artistName}</TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-ash">{r.sessionCount}</TD>
                    <TD className="text-right font-mono tabular-nums text-bone">{money(r.lifetimeValueCents)}</TD>
                    <TD className="text-right tabular-nums text-ash-dim">{shortDate(r.lastActivityAt)}</TD>
                    <TD className="text-right">
                      <Badge tone={r.band === "90+" ? "critical" : "caution"}>{r.daysSince}d</Badge>
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
