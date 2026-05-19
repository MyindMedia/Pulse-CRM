"use client";

import { Clock, DoorOpen, Globe } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { money, longDate, timeOfDay, duration } from "@/lib/format";
import { meta, SESSION_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { bookingMoney, isOnline, type BookingRow } from "./types";
import { HoldCountdown } from "./hold-countdown";

/**
 * A single booking in the pipeline. Compact, scannable: client, room,
 * schedule, paid-vs-total progress and status. Online bookings carry
 * an explicit badge; holds show a live expiry countdown.
 */
export function BookingCard({
  booking,
  onClick,
}: {
  booking: BookingRow;
  onClick: () => void;
}) {
  const m = bookingMoney(booking);
  const online = isOnline(booking);
  const status = meta(SESSION_STATUS, booking.status);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-lg border border-hairline bg-coal p-3.5 text-left",
        "transition-all duration-150 outline-none",
        "hover:border-hairline-2 hover:bg-coal-2",
        "focus-visible:ring-2 focus-visible:ring-gold/30",
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar name={booking.artistName} size="sm" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-bone">
                {booking.title}
              </p>
              <p className="truncate text-xs text-ash-dim">
                {booking.artistName}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge tone={status.tone}>{status.label}</Badge>
              {online && (
                <Badge tone="gold">
                  <Globe className="size-2.5" />
                  Online
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-ash-dim">
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3" />
              {longDate(booking.startTime)} · {timeOfDay(booking.startTime)}
            </span>
            <span>{duration(booking.startTime, booking.endTime)}</span>
            {booking.roomName && (
              <span className="inline-flex items-center gap-1">
                <DoorOpen className="size-3" />
                {booking.roomName}
              </span>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[0.6875rem] tabular-nums text-ash">
                {money(m.paid)}
                <span className="text-ash-dim"> / {money(m.total)}</span>
              </span>
              {booking.status === "tentative" && booking.holdExpiresAt ? (
                <HoldCountdown expiresAt={booking.holdExpiresAt} />
              ) : (
                <span
                  className={cn(
                    "font-mono text-[0.6875rem] tabular-nums",
                    m.fullyPaid ? "text-positive" : "text-caution",
                  )}
                >
                  {m.fullyPaid
                    ? "Paid in full"
                    : `${money(m.balance)} due`}
                </span>
              )}
            </div>
            <Progress
              value={m.paid}
              max={Math.max(m.total, 1)}
              tone={m.fullyPaid ? "positive" : "gold"}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
