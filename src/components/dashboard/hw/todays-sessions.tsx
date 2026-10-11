"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chassis, ChassisTitle, EmptyWell, hhmm, usd, useNow } from "./parts";
import { pickLive } from "./live-hero";

type Row = FunctionReturnType<typeof api.today.today>["sessions"][number];

/** The status word for a row. Money roles see where the money stands;
 *  everyone else sees where the booking stands. */
export function statusChip(s: Row, now: number, money: boolean): { label: string; tone: "positive" | "gold" | "critical" | "neutral" | "info" } {
  if (s.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (s.status === "no_show") return { label: "No-show", tone: "critical" };
  if (money && s.outstandingCents !== null) {
    if (s.outstandingCents === 0) return { label: "Paid", tone: "positive" };
    if (s.endTime <= now) return { label: "Balance due", tone: "critical" };
    if (s.depositPaid) return { label: "Deposit", tone: "gold" };
    return { label: "Unpaid", tone: "critical" };
  }
  if (s.status === "in_progress" || (s.startTime <= now && s.endTime > now && s.status === "confirmed")) return { label: "Live", tone: "gold" };
  if (s.status === "completed" || s.endTime <= now) return { label: "Done", tone: "neutral" };
  if (s.status === "tentative") return { label: "Hold", tone: "info" };
  return { label: "Confirmed", tone: "positive" };
}

/* Today's sessions (kit 6.2): a data table on a glass screen. The session
 * running now (or the next one) is the selected row: yellow tint and a 2px
 * yellow left edge. Rows open the booking in the calendar. */
export function TodaysSessions() {
  const data = useQuery(api.today.today, {});
  const now = useNow(30_000);
  const router = useRouter();

  const head = (
    <ChassisTitle
      title="Today's sessions"
      bar={false}
      right={
        <Button size="sm" variant="secondary" asChild>
          <Link href="/calendar">Open calendar</Link>
        </Button>
      }
    />
  );

  if (!data || now === null) {
    return (
      <Chassis aria-busy>
        {head}
        <div className="pl-well mt-3 flex-1 p-3">
          <div className="pl-screen min-h-40" />
        </div>
      </Chassis>
    );
  }

  const money = data.canSeeFinancials;
  const rows = data.sessions;
  const { live, next } = pickLive(rows, now);
  const selected = (live ?? next)?._id;

  return (
    <Chassis>
      {head}
      {rows.length === 0 ? (
        <div className="mt-3 flex flex-1">
          <EmptyWell>No sessions today.</EmptyWell>
        </div>
      ) : (
        <div className="pl-well mt-3 flex-1 p-3">
        <div className="pl-screen overflow-x-auto px-3 py-1">
          <table className="pl-table w-full min-w-[34rem] border-collapse font-sans text-[13px] leading-[18px]">
            <thead>
              <tr className="h-11">
                <th className="px-3">Client</th>
                <th className="px-3">Room</th>
                <th className="px-3">Time</th>
                <th className="px-3">Engineer</th>
                <th className="px-3">Status</th>
                {money && <th className="px-3 text-right!">Amount</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const chip = statusChip(s, now, money);
                return (
                  <tr
                    key={s._id}
                    data-selected={s._id === selected ? "true" : undefined}
                    onClick={() => router.push(`/calendar?session=${s._id}`)}
                    className="h-[61px] cursor-pointer hover:bg-white/[0.03]"
                  >
                    <td className="px-3 text-bone">
                      <Link href={`/calendar?session=${s._id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                        {s.clientName}
                      </Link>
                    </td>
                    <td className="px-3 text-mist">{s.roomName ?? "-"}</td>
                    <td className="px-3 font-mono text-[13px] leading-[18px] text-mist tabular-nums">
                      {hhmm(s.startTime)} to {hhmm(s.endTime)}
                    </td>
                    <td className="px-3 text-mist">{s.engineerName ?? "Unassigned"}</td>
                    <td className="px-3">
                      <Badge tone={chip.tone}>{chip.label}</Badge>
                    </td>
                    {money && (
                      <td className="px-3 text-right font-mono text-[13px] text-bone tabular-nums">
                        {s.rateCents !== null ? usd(s.rateCents, { cents: true }) : "-"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </Chassis>
  );
}
