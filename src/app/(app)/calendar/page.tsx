"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  CalendarDays,
  CalendarRange,
  Columns3,
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
  startOfWeek,
  type Session,
} from "@/components/calendar/constants";

const DAY_MS = 86_400_000;

type ViewMode = "day" | "week" | "month" | "agenda";

const VIEWS: { key: ViewMode; label: string; icon: typeof List }[] = [
  { key: "day", label: "Day", icon: CalendarDays },
  { key: "week", label: "Week", icon: Columns3 },
  { key: "month", label: "Month", icon: LayoutGrid },
  { key: "agenda", label: "Agenda", icon: List },
];

function headerLabel(view: ViewMode, anchor: number): string {
  const d = new Date(anchor);
  if (view === "day") {
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  if (view === "week") {
    const from = new Date(startOfWeek(anchor));
    const to = new Date(startOfWeek(anchor) + 6 * DAY_MS);
    const sameMonth = from.getMonth() === to.getMonth();
    const f = from.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const t = to.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
    return `${f} - ${t}, ${to.getFullYear()}`;
  }
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

function CalendarView() {
  const router = useRouter();
  const params = useSearchParams();

  // One anchor date drives every view; prev/next steps by the view's unit.
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  // Phones default to the DAY view (the month grid is unreadable there);
  // desktop keeps the month grid. One-time media-query default at mount.
  const [view, setView] = useState<ViewMode>("month");
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView("day");
    }
  }, []);
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookDate, setBookDate] = useState<number | undefined>(undefined);

  // Deep links: ?new=1 opens the booking modal; ?session=<id> opens the sheet.
  const newParam = params.get("new");
  const [prevNewParam, setPrevNewParam] = useState(newParam);
  if (prevNewParam !== newParam) {
    setPrevNewParam(newParam);
    if (newParam === "1") {
      setBookDate(undefined);
      setBookOpen(true);
    }
  }
  const sessionParam = params.get("session");
  const [prevSessionParam, setPrevSessionParam] = useState(sessionParam);
  if (prevSessionParam !== sessionParam) {
    setPrevSessionParam(sessionParam);
    if (sessionParam) setOpenSessionId(sessionParam);
  }
  useEffect(() => {
    if (params.get("new") === "1") router.replace("/calendar");
  }, [params, router]);

  const year = new Date(anchor).getFullYear();
  const month = new Date(anchor).getMonth();

  const range = useMemo(() => {
    if (view === "day") {
      const from = startOfDay(anchor);
      return { from, to: from + DAY_MS - 1 };
    }
    if (view === "week") {
      const from = startOfWeek(anchor);
      return { from, to: from + 7 * DAY_MS - 1 };
    }
    return monthGridRange(year, month);
  }, [view, anchor, year, month]);

  const days = useMemo(() => monthGridDays(year, month), [year, month]);
  const rangeSessions = useQuery(
    api.sessions.inRange,
    view === "agenda" ? "skip" : { from: range.from, to: range.to },
  );
  const upcoming = useQuery(api.sessions.list, view === "agenda" ? {} : "skip");
  const rooms = useQuery(api.rooms.list);

  // Room filter: "all" = every room. Otherwise an Id<"rooms"> string.
  const [filterRoomId, setFilterRoomId] = useState<string>("all");

  const byRoom = (rows: Session[] | undefined) =>
    rows && filterRoomId !== "all" ? rows.filter((s) => s.roomId === filterRoomId) : rows;

  const sessions = byRoom(rangeSessions as Session[] | undefined);

  // Stable "today" snapshot at mount keeps the render pure.
  const [today] = useState(() => startOfDay(Date.now()));
  const agendaSessions = useMemo(() => {
    if (!upcoming) return [];
    return (byRoom(
      (upcoming as Session[]).filter((s) => startOfDay(s.startTime) >= today),
    ) ?? []).sort((a, b) => a.startTime - b.startTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming, today, filterRoomId]);

  function shift(delta: number) {
    if (view === "day") setAnchor((a) => a + delta * DAY_MS);
    else if (view === "week") setAnchor((a) => a + delta * 7 * DAY_MS);
    else {
      const d = new Date(anchor);
      d.setDate(1);
      d.setMonth(d.getMonth() + delta);
      setAnchor(startOfDay(d.getTime()));
    }
  }

  function goToday() {
    setAnchor(startOfDay(Date.now()));
  }

  function openBookingForDay(ts: number) {
    setBookDate(ts);
    setBookOpen(true);
  }

  const listViews = view === "day" || view === "week";
  const loading = view === "agenda" ? upcoming === undefined : sessions === undefined;
  const monthEmpty = view === "month" && !loading && (sessions?.length ?? 0) === 0;

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Bookings"
        title="Calendar"
        description="Studio sessions - book, confirm and run every date on the books."
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => shift(-1)}
            aria-label={`Previous ${view === "agenda" ? "month" : view}`}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="min-w-0 flex-1 text-center font-grotesk text-lg font-bold tracking-tight text-bone sm:min-w-44 sm:flex-none">
            {headerLabel(view, anchor)}
          </h2>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => shift(1)}
            aria-label={`Next ${view === "agenda" ? "month" : view}`}
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={goToday}>
            Today
          </Button>
        </div>

        {/* View toggle */}
        <div className="inline-flex items-center gap-1 overflow-x-auto rounded-md border border-graphite/50 bg-coal p-1">
          {VIEWS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30",
                view === key ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Room filter */}
        <div className="ml-auto flex items-center gap-2">
          <Select value={filterRoomId} onValueChange={setFilterRoomId}>
            <SelectTrigger className="h-8 w-40 text-xs">
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
      ) : listViews ? (
        (sessions?.length ?? 0) === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title={view === "day" ? "Nothing booked this day" : "Nothing booked this week"}
            description="Step through with the arrows, or book a session for this date."
            action={
              <Button onClick={() => openBookingForDay(view === "day" ? anchor : startOfWeek(anchor))}>
                <Plus className="size-4" />
                Book session
              </Button>
            }
          />
        ) : (
          <AgendaList sessions={sessions ?? []} onOpenSession={setOpenSessionId} />
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
