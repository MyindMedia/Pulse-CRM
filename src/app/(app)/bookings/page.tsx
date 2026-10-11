"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { RefreshCw, Ticket } from "lucide-react";
import { BookSessionDialog } from "@/components/calendar/book-session-dialog";
import { PageHeader, Section } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { money as fmtMoney } from "@/lib/format";
import { useCapabilities } from "@/lib/use-capabilities";
import { bookingMoney, laneFor, type BookingRow } from "@/components/bookings/types";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { BookingLane } from "@/components/bookings/booking-lane";
import { BookingSheet } from "@/components/bookings/booking-sheet";
import { MessagesPanel, RecentPaymentsPanel } from "@/components/bookings/activity-panels";
import { WaitlistPanel } from "@/components/bookings/waitlist-panel";
import { Chassis, ChassisTitle, KeyBank, useNow } from "@/components/dashboard/hw/parts";
import { DayTimeline, WeekTimeline, type BoardRoom } from "@/components/bookings/hw/day-board";
import { AtAGlance, SelectedBooking, SessionPrep } from "@/components/bookings/hw/board-panels";
import { addDays, bookingsOn, defaultSelection, glanceFor, startOfDay, startOfWeek } from "@/components/bookings/hw/board-model";

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

type View = "day" | "week" | "month";
const VIEWS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

/* Bookings (kit pulse-bookings.png): the day board of rooms by hours with
 * the selected booking beside it, today at a glance and its session prep;
 * the deposits-and-holds pipeline, waitlist and activity stay underneath.
 * Month opens the calendar's month view, which already exists. */
export default function BookingsPage() {
  const router = useRouter();
  const sessions = useQuery(api.sessions.list, {}) as BookingRow[] | undefined;
  const rooms = useQuery(api.rooms.list) as BoardRoom[] | undefined;
  const waitlist = useQuery(api.waitlist.list);
  const runNow = useMutation(api.automation.runNow);
  const { canSeeFinancials } = useCapabilities();
  const now = useNow(30_000);

  const [view, setView] = React.useState<Exclude<View, "month">>("day");
  const [anchor, setAnchor] = React.useState<number | null>(null);
  React.useEffect(() => setAnchor(startOfDay(Date.now())), []);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<BookingRow | null>(null);
  const [bookOpen, setBookOpen] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  // Keep the open drawer in sync with the live query: a payment recorded in
  // the sheet updates the underlying row, so re-resolve it.
  const [prevSessions, setPrevSessions] = React.useState(sessions);
  if (prevSessions !== sessions) {
    setPrevSessions(sessions);
    if (sheet && sessions) {
      const fresh = sessions.find((s) => s._id === sheet._id);
      if (fresh && fresh !== sheet) setSheet(fresh);
    }
  }

  const rows = sessions ?? [];
  const ready = sessions !== undefined && rooms !== undefined && anchor !== null && now !== null;
  const span = view === "day" ? 1 : 7;
  const rangeStart = anchor === null ? 0 : view === "day" ? anchor : startOfWeek(anchor);
  const visible = ready ? rows.filter((s) => s.status !== "cancelled" && s.startTime < addDays(rangeStart, span) && s.endTime > rangeStart) : [];
  const day = ready ? bookingsOn(rows, anchor) : [];
  const selected =
    (selectedId ? rows.find((s) => s._id === selectedId) : null) ??
    (ready ? defaultSelection(view === "day" ? day : visible, now) : null);
  const liveCount = ready ? rows.filter((s) => s.status !== "cancelled" && s.status !== "no_show" && s.startTime <= now && s.endTime > now).length : 0;
  const liveRooms = (rooms ?? []).filter((r) => r.status !== "retired").length;
  const glance = ready ? glanceFor(rows, anchor, liveRooms, now) : null;
  const isToday = ready && anchor === startOfDay(now);

  // Header caption: this week, the open holds, the waitlist.
  const caption = React.useMemo(() => {
    if (!ready) return "Loading bookings";
    const ws = startOfWeek(anchor);
    const week = rows.filter((s) => s.status !== "cancelled" && s.startTime >= ws && s.startTime < addDays(ws, 7)).length;
    const holds = rows.filter((s) => s.status === "tentative" && s.endTime > now).length;
    const w = waitlist?.length ?? 0;
    return `${week} ${week === 1 ? "session" : "sessions"} this week · ${holds} ${holds === 1 ? "hold" : "holds"} · ${w} waitlist`;
  }, [ready, anchor, rows, now, waitlist]);

  function step(dir: -1 | 1) {
    if (anchor === null) return;
    setAnchor(addDays(anchor, dir * span));
    setSelectedId(null);
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

  // ── The pipeline underneath (unchanged behaviour) ──
  const RELEVANCE_MS = 14 * 86_400_000;
  const [nowTs] = React.useState(() => Date.now());
  const [sortBy, setSortBy] = React.useState<"date_asc" | "date_desc" | "value" | "client">("date_asc");
  const lanes = React.useMemo(() => {
    const empty = { holds: [] as BookingRow[], balanceDue: [] as BookingRow[], paidInFull: [] as BookingRow[], released: [] as BookingRow[] };
    if (!sessions) return empty;
    const comparators: Record<string, (a: BookingRow, b: BookingRow) => number> = {
      date_asc: (a, b) => a.startTime - b.startTime,
      date_desc: (a, b) => b.startTime - a.startTime,
      value: (a, b) => b.rateCents - a.rateCents,
      client: (a, b) => a.artistName.localeCompare(b.artistName),
    };
    const sorted = sessions.filter((s) => s.endTime >= nowTs - RELEVANCE_MS).sort(comparators[sortBy]);
    for (const s of sorted) empty[laneFor(s)].push(s);
    return empty;
  }, [sessions, sortBy, nowTs, RELEVANCE_MS]);
  const totals = React.useMemo(() => {
    if (!sessions) return null;
    let holds = 0;
    let balance = 0;
    let paid = 0;
    let collected = 0;
    for (const s of sessions) {
      const m = bookingMoney(s);
      collected += m.paid;
      if (s.status === "tentative") holds += 1;
      if (s.status === "confirmed" && !m.fullyPaid) balance += 1;
      if (m.fullyPaid && s.status !== "cancelled") paid += 1;
    }
    return { holds, balance, paid, collected };
  }, [sessions]);

  const title = anchor === null ? "Bookings" : view === "day"
    ? new Date(anchor).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : `Week of ${new Date(startOfWeek(anchor)).toLocaleDateString("en-US", { month: "long", day: "numeric" })}`;

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Operations"
        title="Bookings"
        description={caption}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={() => step(-1)}>
              Prev
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setAnchor(startOfDay(Date.now()));
                setSelectedId(null);
              }}
            >
              Today
            </Button>
            <Button size="sm" variant="ghost" onClick={() => step(1)}>
              Next
            </Button>
            <KeyBank
              label="Board view"
              options={VIEWS}
              value={view}
              onChange={(v) => {
                if (v === "month") router.push("/calendar");
                else {
                  setView(v);
                  setSelectedId(null);
                }
              }}
            />
            <Button onClick={() => setBookOpen(true)}>New booking</Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[2.2fr_1fr]">
        <Chassis grid brackets>
          <ChassisTitle
            title={title}
            right={
              <>
                {isToday && liveCount > 0 && (
                  <Badge tone="gold" className="gap-1.5">
                    <span className="pl-led" data-on="true" data-live="true" aria-hidden />
                    {liveCount} live
                  </Badge>
                )}
                <Badge tone="neutral">
                  {liveRooms} {liveRooms === 1 ? "room" : "rooms"}
                </Badge>
              </>
            }
          />
          <div className="pl-well mt-3 p-3">
            {!ready ? (
              <div className="pl-screen h-72" aria-busy />
            ) : view === "day" ? (
              <DayTimeline rows={rows} rooms={rooms} dayStart={anchor} now={now} selectedId={selected?._id ?? null} onSelect={(s) => setSelectedId(s._id)} />
            ) : (
              <WeekTimeline rows={rows} rooms={rooms} weekStart={startOfWeek(anchor)} now={now} selectedId={selected?._id ?? null} onSelect={(s) => setSelectedId(s._id)} />
            )}
          </div>
        </Chassis>
        <SelectedBooking s={selected} money={canSeeFinancials} now={now ?? 0} onOpenSheet={setSheet} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[2.2fr_1fr]">
        <AtAGlance
          g={glance}
          money={canSeeFinancials}
          title={isToday || !ready ? "Today at a glance" : `${new Date(anchor).toLocaleDateString("en-US", { weekday: "long" })} at a glance`}
        />
        <SessionPrep s={selected} />
      </div>

      <BookSessionDialog open={bookOpen} onOpenChange={setBookOpen} />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Section
          title="Pipeline"
          trailing={
            <Button size="sm" variant="secondary" onClick={handleRun} disabled={running}>
              {running ? <Spinner className="text-bone" /> : <RefreshCw className="size-3.5" />}
              Run automation
            </Button>
          }
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Sort bookings">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date_asc">Soonest first</SelectItem>
                <SelectItem value="date_desc">Latest first</SelectItem>
                <SelectItem value="value">Highest value</SelectItem>
                <SelectItem value="client">Client A-Z</SelectItem>
              </SelectContent>
            </Select>
            {totals && (
              <p className="font-mono text-xs text-steel">
                {totals.holds} holds · {totals.balance} awaiting balance · {totals.paid} paid in full
                {canSeeFinancials ? ` · ${fmtMoney(totals.collected, { compact: true })} collected` : ""}
              </p>
            )}
            <Link href="/reports" className="pl-label transition-colors hover:text-gold">
              Older bookings live in Reports / Archive
            </Link>
          </div>
          {sessions === undefined ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title="No bookings yet"
              description="Online bookings made through the public booking flow show up here as soon as a client reserves studio time."
            />
          ) : (
            <div className="space-y-6">
              <BookingLane title="Holds" description="No holds waiting on a deposit right now." bookings={lanes.holds} accent="gold" onSelect={setSheet} />
              <BookingLane title="Confirmed - balance due" description="No confirmed bookings are waiting on a balance." bookings={lanes.balanceDue} accent="info" onSelect={setSheet} />
              <BookingLane title="Paid in full" description="No bookings are fully paid yet." bookings={lanes.paidInFull} accent="positive" onSelect={setSheet} />
              <BookingLane title="Released / cancelled" description="No released or cancelled bookings." bookings={lanes.released} accent="neutral" collapsible defaultOpen={false} onSelect={setSheet} />
            </div>
          )}
        </Section>
        <div className="space-y-4">
          <WaitlistPanel />
          <RecentPaymentsPanel />
          <MessagesPanel />
        </div>
      </div>

      <BookingSheet booking={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}
