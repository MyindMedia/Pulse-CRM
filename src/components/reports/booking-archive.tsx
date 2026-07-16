"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Archive } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { money, shortDate } from "@/lib/format";
import { CheckCircle2, UserX, Ban, TimerOff } from "lucide-react";

/* The booking archive: everything resolved off the operational board -
   completed work, no-shows, cancellations, and unpaid holds whose date
   passed (auto-expired by the automation). Managers see the live board;
   history lives here. */

const BUCKET: Record<string, { label: string; tone: "positive" | "critical" | "neutral" | "caution" }> = {
  completed: { label: "Completed", tone: "positive" },
  no_show: { label: "No-show", tone: "critical" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  expired_hold: { label: "Expired hold", tone: "caution" },
};

export function BookingArchiveReport() {
  const data = useQuery(api.reports.bookingArchive, { days: 90 });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Completed" value={data?.counts.completed ?? "-"} icon={CheckCircle2} />
        <StatTile label="No-shows" value={data?.counts.no_show ?? "-"} icon={UserX} />
        <StatTile label="Expired holds" value={data?.counts.expired_hold ?? "-"} icon={TimerOff} hint="date passed, no deposit" />
        <StatTile label="Cancelled" value={data?.counts.cancelled ?? "-"} icon={Ban} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Archived bookings - last 90 days</CardTitle>
          <CardDescription>
            Resolved off the live Bookings board: finished sessions, no-shows and unpaid
            holds whose date passed. {data ? `${data.total} total.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data === undefined ? (
            <SkeletonRows rows={5} />
          ) : data.recent.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="Nothing archived yet"
              description="As sessions finish (or unpaid holds lapse) they land here automatically."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Session</TH>
                    <TH>Client</TH>
                    <TH>Resolution</TH>
                    <TH className="text-right">Collected</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.recent.map((s) => {
                    const b = BUCKET[s.bucket] ?? BUCKET.cancelled;
                    return (
                      <TR key={s._id}>
                        <TD className="whitespace-nowrap font-meta text-xs text-steel">
                          {shortDate(s.startTime)}
                        </TD>
                        <TD className="max-w-64">
                          <span className="block truncate text-bone">{s.title}</span>
                        </TD>
                        <TD className="text-steel">{s.artistName}</TD>
                        <TD>
                          <span className="inline-flex items-center gap-1.5">
                            <Badge tone={b.tone}>{b.label}</Badge>
                            {s.autoResolved && (
                              <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/50">
                                auto
                              </span>
                            )}
                          </span>
                        </TD>
                        <TD className="text-right font-meta text-bone">{money(s.paidCents)}</TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
