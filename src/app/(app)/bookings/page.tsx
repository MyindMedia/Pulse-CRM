"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Plus,
  RefreshCw,
  Ticket,
  Timer,
} from "lucide-react";
import { BookSessionDialog } from "@/components/calendar/book-session-dialog";
import { PageHeader, Section } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import {
  bookingMoney,
  isOnline,
  laneFor,
  type BookingRow,
} from "@/components/bookings/types";
import { BookingLane } from "@/components/bookings/booking-lane";
import { BookingSheet } from "@/components/bookings/booking-sheet";
import {
  MessagesPanel,
  RecentPaymentsPanel,
} from "@/components/bookings/activity-panels";

/** Build a human summary line from an automation run outcome. */
function summarizeRun(out: {
  holdsReleased: number;
  remindersSent: number;
  forfeited: number;
  started: number;
  completed: number;
}): string {
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(out.holdsReleased, "hold released", "holds released");
  add(out.remindersSent, "reminder sent", "reminders sent");
  add(out.forfeited, "booking forfeited", "bookings forfeited");
  add(out.started, "session started", "sessions started");
  add(out.completed, "session completed", "sessions completed");
  return parts.length > 0
    ? `Automation ran - ${parts.join(", ")}.`
    : "Automation ran - nothing needed attention.";
}

export default function BookingsPage() {
  const sessions = useQuery(api.sessions.list, {}) as
    | BookingRow[]
    | undefined;
  const runNow = useMutation(api.automation.runNow);

  const [selected, setSelected] = React.useState<BookingRow | null>(null);
  const [bookOpen, setBookOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  // Keep the open drawer in sync with the live query - payment recorded
  // in the sheet updates the underlying row, so re-resolve it.
  const [prevSessions, setPrevSessions] = React.useState(sessions);
  if (prevSessions !== sessions) {
    setPrevSessions(sessions);
    if (selected && sessions) {
      const fresh = sessions.find((s) => s._id === selected._id);
      if (fresh && fresh !== selected) setSelected(fresh);
    }
  }

  async function handleRun() {
    if (running) return;
    setRunning(true);
    try {
      const out = await runNow();
      toast.success(summarizeRun(out));
    } catch {
      toast.error("Could not run the booking automation");
    } finally {
      setRunning(false);
    }
  }

  // Booking-specific tiles focus on online (public-booking) sessions;
  // the pipeline below still surfaces every session for completeness.
  const stats = React.useMemo(() => {
    if (!sessions) return null;
    const online = sessions.filter(isOnline);
    let activeHolds = 0;
    let awaitingBalance = 0;
    let paidInFull = 0;
    let collected = 0;
    for (const s of online) {
      const m = bookingMoney(s);
      collected += m.paid;
      if (s.status === "tentative") activeHolds += 1;
      if (s.status === "confirmed" && !m.fullyPaid) awaitingBalance += 1;
      if (m.fullyPaid && s.status !== "cancelled") paidInFull += 1;
    }
    return { activeHolds, awaitingBalance, paidInFull, collected };
  }, [sessions]);

  const lanes = React.useMemo(() => {
    const empty = {
      holds: [] as BookingRow[],
      balanceDue: [] as BookingRow[],
      paidInFull: [] as BookingRow[],
      released: [] as BookingRow[],
    };
    if (!sessions) return empty;
    // Online bookings first within each lane so they read prominently.
    const sorted = [...sessions].sort((a, b) => {
      const onlineDelta = Number(isOnline(b)) - Number(isOnline(a));
      if (onlineDelta !== 0) return onlineDelta;
      return a.startTime - b.startTime;
    });
    for (const s of sorted) empty[laneFor(s)].push(s);
    return empty;
  }, [sessions]);

  const loading = sessions === undefined;
  const totalBookings = sessions?.length ?? 0;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Operations"
        title="Bookings"
        description="The command center for online bookings - holds, deposits, balances and the automation that keeps the calendar honest."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleRun} disabled={running}>
              {running ? <Spinner className="text-bone" /> : <RefreshCw className="size-4" />}
              Run automation
            </Button>
            <Button onClick={() => setBookOpen(true)}>
              <Plus className="size-4" />
              New booking
            </Button>
          </div>
        }
      />

      <BookSessionDialog open={bookOpen} onOpenChange={setBookOpen} />

      {/* Stat tiles */}
      {stats === null ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Active holds"
            value={String(stats.activeHolds)}
            icon={Timer}
            hint="awaiting a deposit"
          />
          <StatTile
            label="Awaiting balance"
            value={String(stats.awaitingBalance)}
            icon={CalendarClock}
            hint="confirmed, not paid in full"
          />
          <StatTile
            label="Paid in full"
            value={String(stats.paidInFull)}
            icon={CheckCircle2}
            hint="locked-in bookings"
          />
          <StatTile
            label="Collected"
            value={money(stats.collected, { compact: true })}
            icon={CircleDollarSign}
            accent
            hint="from online bookings"
          />
        </div>
      )}

      <div className="grid gap-7 lg:grid-cols-[1.6fr_1fr]">
        {/* Pipeline */}
        <Section title="Pipeline">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : totalBookings === 0 ? (
            <EmptyState
              icon={Ticket}
              title="No bookings yet"
              description="Online bookings made through the public booking flow show up here as soon as a client reserves studio time."
            />
          ) : (
            <div className="space-y-6">
              <BookingLane
                title="Holds"
                description="No holds waiting on a deposit right now."
                bookings={lanes.holds}
                accent="gold"
                onSelect={setSelected}
              />
              <BookingLane
                title="Confirmed - balance due"
                description="No confirmed bookings are waiting on a balance."
                bookings={lanes.balanceDue}
                accent="info"
                onSelect={setSelected}
              />
              <BookingLane
                title="Paid in full"
                description="No bookings are fully paid yet."
                bookings={lanes.paidInFull}
                accent="positive"
                onSelect={setSelected}
              />
              <BookingLane
                title="Released / cancelled"
                description="No released or cancelled bookings."
                bookings={lanes.released}
                accent="neutral"
                collapsible
                defaultOpen={false}
                onSelect={setSelected}
              />
            </div>
          )}
        </Section>

        {/* Side panels */}
        <div className="space-y-4">
          <RecentPaymentsPanel />
          <MessagesPanel />
        </div>
      </div>

      <BookingSheet booking={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
