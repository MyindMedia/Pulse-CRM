"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bookingMoney, type BookingRow } from "@/components/bookings/types";
import { errorMessage } from "@/lib/errors";
import { Chassis, ChassisTitle, Delta, EmptyWell, Groove, StatTile, hhmm, usd } from "@/components/dashboard/hw/parts";
import type { Glance } from "./board-model";

type Tone = "positive" | "gold" | "critical" | "neutral" | "info";

/** The word for a booking: where its money stands for money roles, where
 *  the booking stands for everyone else. */
export function bookingChip(s: BookingRow, money: boolean, now: number): { label: string; tone: Tone } {
  if (s.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (s.status === "no_show") return { label: "No-show", tone: "critical" };
  if (s.status === "tentative") return { label: "Hold", tone: "gold" };
  if (money) {
    const m = bookingMoney(s);
    if (m.fullyPaid) return { label: "Paid", tone: "positive" };
    if (s.depositPaid) return { label: "Deposit", tone: "gold" };
    return { label: "Unpaid", tone: "critical" };
  }
  if (s.startTime <= now && s.endTime > now) return { label: "Live", tone: "gold" };
  if (s.status === "completed" || s.endTime <= now) return { label: "Done", tone: "neutral" };
  return { label: "Confirmed", tone: "positive" };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[7px] font-sans text-[13px] leading-[18px]">
      <span className="shrink-0 text-steel">{label}</span>
      <span className="min-w-0 truncate text-right text-bone">{children}</span>
    </div>
  );
}

/* The selected booking (kit: SELECTED chassis): its details in a well, how
 * much is paid on a groove, and the keys. Collect balance and Cancel open
 * the booking sheet, which records payments and confirms a cancel;
 * Reschedule opens the booking in the calendar. */
export function SelectedBooking({
  s,
  money,
  now,
  onOpenSheet,
}: {
  s: BookingRow | null;
  money: boolean;
  now: number;
  onOpenSheet: (s: BookingRow) => void;
}) {
  if (!s) {
    return (
      <Chassis brackets>
        <ChassisTitle kicker={<Badge tone="solid">Selected</Badge>} title="No booking selected" />
        <div className="mt-3 flex flex-1">
          <EmptyWell>Pick a booking on the timeline.</EmptyWell>
        </div>
      </Chassis>
    );
  }
  const m = bookingMoney(s);
  const chip = bookingChip(s, money, now);
  const hours = Math.max(0.25, (s.endTime - s.startTime) / 3_600_000);
  const closed = s.status === "cancelled" || s.status === "no_show";

  return (
    <Chassis brackets>
      <ChassisTitle
        kicker={<Badge tone="solid">Selected</Badge>}
        title={s.artistName}
        right={<Badge tone={chip.tone}>{chip.label}</Badge>}
      />
      <div className="pl-well mt-3 px-3 py-1.5">
        <Row label="Room">{s.roomName ?? "No room"}</Row>
        <Row label="Time">
          <span className="font-mono">
            {hhmm(s.startTime)} to {hhmm(s.endTime)}
          </span>
        </Row>
        <Row label="Engineer">{s.engineerName ?? "Unassigned"}</Row>
        {money && (
          <>
            <Row label="Rate">
              <span className="font-mono">{usd(m.total / hours, { cents: true })}/h</span>
            </Row>
            <Row label="Total">
              <span className="font-mono">{usd(m.total, { cents: true })}</span>
            </Row>
            {m.deposit > 0 && (
              <Row label="Deposit">
                <span className={`font-mono ${s.depositPaid ? "text-positive" : "text-gold"}`}>
                  {usd(m.deposit, { cents: true })} {s.depositPaid ? "paid" : "due"}
                </span>
              </Row>
            )}
            <Row label="Balance">
              <span className={`font-mono ${m.balance === 0 ? "text-positive" : "text-gold"}`}>
                {m.balance === 0 ? "Paid in full" : `${usd(m.balance, { cents: true })} due`}
              </span>
            </Row>
          </>
        )}
      </div>
      {money && (
        <div className="mt-4">
          <div className="mb-2 flex justify-between font-sans text-[13px] leading-[18px]">
            <span className="text-mist">Paid</span>
            <span className="font-mono text-xs text-bone">{Math.round(m.ratio * 100)}%</span>
          </div>
          <Groove value={m.ratio} tone="yellow" />
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
        {money && m.balance > 0 && !closed && (
          <Button size="sm" onClick={() => onOpenSheet(s)}>
            Collect balance
          </Button>
        )}
        <Button size="sm" variant="secondary" asChild>
          <Link href={`/calendar?session=${s._id}`}>Reschedule</Link>
        </Button>
        {!closed && s.status !== "completed" && (
          <Button size="sm" variant="ghost" onClick={() => onOpenSheet(s)}>
            Cancel
          </Button>
        )}
      </div>
    </Chassis>
  );
}

/* Today at a glance (kit): four tiles for the board's day. */
export function AtAGlance({ g, money, title }: { g: Glance | null; money: boolean; title: string }) {
  return (
    <Chassis>
      <ChassisTitle title={title} bar={false} />
      <div className="mt-3 grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
        {g === null ? (
          [0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" value="--" />)
        ) : (
          <>
            <StatTile label="Booked" value={`${g.bookedHours}h`} highlight foot={<Delta value={g.bookedDelta} against="last week" />} />
            <StatTile
              label="Open slots"
              value={`${g.openHours}h`}
              foot={g.rooms > 1 ? `of ${g.rooms * 12}h across ${g.rooms} rooms` : "of a 12-hour day"}
            />
            {money ? (
              <StatTile
                label="Deposits due"
                value={usd(g.depositsDueCents)}
                foot={`${g.depositsDueCount} in the next 7 days`}
              />
            ) : (
              <StatTile label="Sessions" value={String(g.sessions)} foot="on this day" />
            )}
            <StatTile label="No-shows (30d)" value={String(g.noShows30)} foot={<Delta value={g.noShowsDelta} against="prior 30d" />} />
          </>
        )}
      </div>
    </Chassis>
  );
}

/* Session prep (kit): the selected booking's pre-session checklist; a tap
 * toggles an item. */
export function SessionPrep({ s }: { s: BookingRow | null }) {
  const lists = useQuery(api.checklists.forSession, s ? { sessionId: s._id as Id<"sessions"> } : "skip");
  const toggle = useMutation(api.checklists.toggleItem);
  const pre = lists?.pre ?? null;

  async function flip(index: number) {
    if (!pre) return;
    try {
      await toggle({ id: pre._id, index });
    } catch (err) {
      toast.error(errorMessage(err, "Could not update the checklist."));
    }
  }

  return (
    <Chassis>
      <ChassisTitle title="Session prep" bar={false} />
      {!s ? (
        <div className="mt-3 flex flex-1">
          <EmptyWell>Pick a booking to see its prep.</EmptyWell>
        </div>
      ) : lists === undefined ? (
        <div className="mt-3 flex-1" aria-busy />
      ) : !pre || pre.items.length === 0 ? (
        <div className="mt-3 flex flex-1">
          <EmptyWell>No prep checklist on this booking.</EmptyWell>
        </div>
      ) : (
        <ul className="mt-3 flex-1 divide-y divide-white/[0.06]">
          {pre.items.map((item, i) => (
            <li key={`${item.label}-${i}`} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate font-sans text-[13px] leading-[18px] text-mist">{item.label}</span>
              <button
                type="button"
                onClick={() => void flip(i)}
                aria-pressed={item.done}
                aria-label={`${item.label}: ${item.done ? "ready" : "to do"}`}
                className="shrink-0"
              >
                <Badge tone={item.done ? "positive" : "neutral"}>{item.done ? "Ready" : "To do"}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Chassis>
  );
}
