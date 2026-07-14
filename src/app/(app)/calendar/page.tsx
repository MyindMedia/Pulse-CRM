"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  LayoutGrid,
  List,
  Plus,
  Tablet,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { cn } from "@/lib/utils";
import { MonthGrid } from "@/components/calendar/month-grid";
import { AgendaList } from "@/components/calendar/agenda-list";
import { SessionSheet } from "@/components/calendar/session-sheet";
import { BookSessionDialog } from "@/components/calendar/book-session-dialog";
import {
  MONTH_NAMES,
  monthGridDays,
  monthGridRange,
  startOfDay,
  type Session,
} from "@/components/calendar/constants";

type ViewMode = "month" | "agenda";

function CalendarView() {
  const router = useRouter();
  const params = useSearchParams();

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  // On a phone the month grid is unreadable, so default to the agenda/list view
  // there. Desktop keeps the month grid. Resolved once at mount (SSR renders the
  // desktop default; the client corrects immediately before paint on mobile) -
  // a legitimate one-time media-query default, so the set-state-in-effect nudge
  // does not apply.
  const [view, setView] = useState<ViewMode>("month");
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView("agenda");
    }
  }, []);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookDate, setBookDate] = useState<number | undefined>(undefined);

  // Auto-open the booking modal when the URL carries ?new=1. Split into a
  // render-time check (state) and an effect that strips the param.
  const newParam = params.get("new");
  const [prevNewParam, setPrevNewParam] = useState(newParam);
  if (prevNewParam !== newParam) {
    setPrevNewParam(newParam);
    if (newParam === "1") {
      setBookDate(undefined);
      setBookOpen(true);
    }
  }
  useEffect(() => {
    if (params.get("new") === "1") router.replace("/calendar");
  }, [params, router]);

  const { from, to } = useMemo(() => monthGridRange(year, month), [year, month]);
  const days = useMemo(() => monthGridDays(year, month), [year, month]);
  const monthSessions = useQuery(api.sessions.inRange, { from, to });
  const upcoming = useQuery(api.sessions.list, {});
  const rooms = useQuery(api.rooms.list);

  // Room filter: "all" = every room. Otherwise an Id<"rooms"> string.
  const [filterRoomId, setFilterRoomId] = useState<string>("all");

  const rawSessions: Session[] | undefined =
    view === "month"
      ? (monthSessions as Session[] | undefined)
      : (upcoming as Session[] | undefined);

  const sessions: Session[] | undefined = useMemo(() => {
    if (!rawSessions) return rawSessions;
    if (filterRoomId === "all") return rawSessions;
    return rawSessions.filter((s) => s.roomId === filterRoomId);
  }, [rawSessions, filterRoomId]);

  // Stable "today" snapshot at mount keeps the render pure.
  const [today] = useState(() => startOfDay(Date.now()));
  const agendaSessions = useMemo(() => {
    if (!upcoming) return [];
    let rows = (upcoming as Session[])
      .filter((s) => startOfDay(s.startTime) >= today)
      .sort((a, b) => a.startTime - b.startTime);
    if (filterRoomId !== "all") rows = rows.filter((s) => s.roomId === filterRoomId);
    return rows;
  }, [upcoming, today, filterRoomId]);

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function goToday() {
    const d = new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function openBookingForDay(ts: number) {
    setBookDate(ts);
    setBookOpen(true);
  }

  const loading = sessions === undefined;
  const monthEmpty = view === "month" && !loading && (sessions?.length ?? 0) === 0;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Bookings"
        title="Calendar"
        description="Studio sessions across the month - book, confirm and run every date on the books."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <a href="/kiosk" target="_blank" rel="noreferrer">
                <Tablet className="size-4" />
                Open kiosk
              </a>
            </Button>
            <Button
              onClick={() => {
                setBookDate(undefined);
                setBookOpen(true);
              }}
            >
              <Plus className="size-4" />
              Book session
            </Button>
          </div>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-44 text-center font-grotesk text-lg font-bold tracking-tight text-bone">
            {MONTH_NAMES[month]} {year}
          </h2>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={goToday}>
            Today
          </Button>
        </div>

        {/* Room filter */}
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Select value={filterRoomId} onValueChange={setFilterRoomId}>
            <SelectTrigger className="h-8 w-44 text-xs">
              <DoorOpen className="size-3.5 text-steel/70" />
              <SelectValue placeholder="All rooms" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rooms</SelectItem>
              {(rooms ?? []).map((r) => (
                <SelectItem key={r._id} value={r._id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* View toggle */}
        <div className="inline-flex items-center gap-1 rounded-md border border-graphite/50 bg-coal p-1">
          <button
            type="button"
            onClick={() => setView("month")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30",
              view === "month" ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone",
            )}
          >
            <LayoutGrid className="size-3.5" />
            Month
          </button>
          <button
            type="button"
            onClick={() => setView("agenda")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30",
              view === "agenda" ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone",
            )}
          >
            <List className="size-3.5" />
            Agenda
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <Skeleton className="h-[34rem] w-full" />
      ) : view === "month" ? (
        monthEmpty ? (
          <EmptyState
            icon={CalendarRange}
            title={`Nothing booked in ${MONTH_NAMES[month]}`}
            description="There are no sessions this month. Book one to fill the calendar."
            action={
              <Button
                onClick={() => {
                  setBookDate(undefined);
                  setBookOpen(true);
                }}
              >
                <Plus className="size-4" />
                Book session
              </Button>
            }
          />
        ) : (
          <MonthGrid
            days={days}
            month={month}
            sessions={sessions ?? []}
            onOpenSession={setOpenSessionId}
            onPickDay={openBookingForDay}
          />
        )
      ) : (
        <AgendaList sessions={agendaSessions} onOpenSession={setOpenSessionId} />
      )}

      <BookSessionDialog
        open={bookOpen}
        onOpenChange={setBookOpen}
        initialDate={bookDate}
      />
      <SessionSheet sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[40rem] w-full" />}>
      <CalendarView />
    </Suspense>
  );
}
