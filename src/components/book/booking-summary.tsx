"use client";

import { CalendarDays, Clock3, DoorOpen, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { money, longDate, timeOfDay, duration } from "@/lib/format";

/** Booking fields used by the summary card. */
export type BookingSummaryData = {
  roomName: string;
  clientName: string;
  title: string;
  startTime: number;
  endTime: number;
  rateCents: number;
  depositCents: number;
  paidCents: number;
  balanceCents: number;
  fullyPaid: boolean;
  status: string;
};

const STATUS_TONE: Record<string, "positive" | "caution" | "neutral" | "critical"> = {
  confirmed: "positive",
  tentative: "caution",
  completed: "positive",
  cancelled: "critical",
  no_show: "critical",
};

export function BookingSummary({ booking }: { booking: BookingSummaryData }) {
  const rows = [
    { icon: DoorOpen, label: "Room", value: booking.roomName },
    { icon: User, label: "Booked by", value: booking.clientName },
    { icon: CalendarDays, label: "Date", value: longDate(booking.startTime) },
    {
      icon: Clock3,
      label: "Time",
      value: `${timeOfDay(booking.startTime)} – ${timeOfDay(booking.endTime)} (${duration(
        booking.startTime,
        booking.endTime,
      )})`,
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-graphite/50 bg-coal">
      <div className="flex items-center justify-between border-b border-graphite/50 px-5 py-3">
        <span className="font-grotesk text-sm font-semibold text-bone">
          Booking summary
        </span>
        <Badge tone={STATUS_TONE[booking.status] ?? "neutral"} className="capitalize">
          {booking.status.replace(/_/g, " ")}
        </Badge>
      </div>

      <dl className="divide-y divide-hairline">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 px-5 py-3">
            <row.icon className="size-4 shrink-0 text-steel/70" />
            <dt className="w-24 shrink-0 text-xs text-steel/70">{row.label}</dt>
            <dd className="min-w-0 flex-1 truncate text-sm text-bone">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2 border-t border-graphite/50 bg-coal-2/60 px-5 py-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-steel">Session total</span>
          <span className="font-meta text-bone">{money(booking.rateCents)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-steel">Paid</span>
          <span className="font-meta text-positive">{money(booking.paidCents)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-graphite/50 pt-2 text-sm">
          <span className="font-medium text-bone">
            {booking.fullyPaid ? "Balance" : "Balance remaining"}
          </span>
          <span className="font-meta font-semibold text-bone">
            {money(booking.balanceCents)}
          </span>
        </div>
      </div>
    </div>
  );
}
