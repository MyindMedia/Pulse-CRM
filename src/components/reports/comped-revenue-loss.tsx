"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { money } from "@/lib/format";
import { ReportCard, ReportStat } from "./report-shell";

export function CompedRevenueLossReport() {
  const data = useQuery(api.reports.compedRevenueLoss);
  const empty = data !== undefined && data.totalCount === 0;

  return (
    <ReportCard
      title="Comped revenue loss"
      description="Sessions run for free - a label or the studio waived the charge. Each is tracked at the value it would have billed, so you can see what comping costs."
      loading={data === undefined}
      empty={empty}
      emptyTitle="No comped sessions"
      emptyDescription="When a session is booked as a comp (no charge), the revenue given away shows up here."
    >
      {data && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <ReportStat
              label="Waived (all time)"
              value={money(data.totalLossCents, { compact: true })}
              tone="gold"
            />
            <ReportStat label="Comped sessions" value={String(data.totalCount)} />
            <ReportStat
              label={`Last ${data.windowDays}d`}
              value={money(data.windowLossCents, { compact: true })}
              tone="caution"
            />
            <ReportStat label={`Comps last ${data.windowDays}d`} value={String(data.windowCount)} />
          </div>

          <div className="space-y-2">
            <p className="overline">By client</p>
            <Table>
              <THead>
                <TR>
                  <TH>Client</TH>
                  <TH className="text-right">Comps</TH>
                  <TH className="text-right">Revenue waived</TH>
                </TR>
              </THead>
              <TBody>
                {data.byClient.map((r) => (
                  <TR key={r.artistId}>
                    <TD className="font-medium">{r.artistName}</TD>
                    <TD className="text-right tabular-nums text-steel">{r.count}</TD>
                    <TD className="text-right font-meta font-semibold tabular-nums text-gold">
                      {money(r.lossCents)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {data.byRoom.length > 0 && (
            <div className="space-y-2">
              <p className="overline">By room</p>
              <Table>
                <THead>
                  <TR>
                    <TH>Room</TH>
                    <TH className="text-right">Comps</TH>
                    <TH className="text-right">Revenue waived</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.byRoom.map((r) => (
                    <TR key={r.roomId}>
                      <TD className="font-medium">{r.roomName}</TD>
                      <TD className="text-right tabular-nums text-steel">{r.count}</TD>
                      <TD className="text-right font-meta font-semibold tabular-nums text-gold">
                        {money(r.lossCents)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </ReportCard>
  );
}
