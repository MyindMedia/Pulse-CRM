"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { percent } from "@/lib/format";
import { ReportCard, ReportStat } from "./report-shell";

export function RoomUtilizationReport() {
  const data = useQuery(api.reports.roomUtilization);
  const empty = data !== undefined && data.rows.length === 0;

  return (
    <ReportCard
      title="Room utilization"
      description={
        data
          ? `Booked hours vs ${data.bookableHoursPerDay}h/day available across the last ${data.windowDays} days.`
          : undefined
      }
      loading={data === undefined}
      empty={empty}
      emptyTitle="No bookable rooms"
      emptyDescription="Add rooms and book sessions to see utilization."
    >
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <ReportStat label="Avg utilization" value={percent(data.avgUtilization)} tone="gold" />
            <ReportStat label="Window" value={`${data.windowDays} days`} />
          </div>

          <Table>
            <THead>
              <TR>
                <TH>Room</TH>
                <TH className="text-right">Booked</TH>
                <TH className="text-right">Available</TH>
                <TH className="w-[28%]">Utilization</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => {
                const tone =
                  r.utilization >= 0.6 ? "positive" : r.utilization >= 0.3 ? "gold" : "caution";
                return (
                  <TR key={r.roomId}>
                    <TD className="font-medium">
                      {r.roomName}
                      {r.roomType && (
                        <span className="ml-2 font-mono text-[0.625rem] uppercase text-ash-dim">
                          {r.roomType}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums text-ash">{r.bookedHours}h</TD>
                    <TD className="text-right tabular-nums text-ash-dim">{r.availableHours}h</TD>
                    <TD>
                      <div className="flex items-center gap-2.5">
                        <Progress value={r.utilization} tone={tone} className="flex-1" />
                        <span className="w-10 text-right font-mono text-xs tabular-nums text-bone">
                          {percent(r.utilization)}
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
