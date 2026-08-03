"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Disc3,
  DoorOpen,
  Headphones,
  Maximize2,
  Minimize2,
  Music2,
  Receipt,
  StickyNote,
  Sun,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { longDate, timeOfDay, duration, money } from "@/lib/format";
import { meta, SESSION_STATUS, titleCase } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ShellErrorBoundary } from "@/components/shell/shell-error-boundary";
import { brandStyle } from "@/lib/brand-theme";
import {
  MONTH_NAMES,
  WEEKDAY_LABELS,
  isSameDay,
  monthGridDays,
  monthGridRange,
  startOfDay,
  statusColor,
  type Session,
} from "@/components/calendar/constants";

/*
 * The front-desk kiosk - a chrome-less, full-screen calendar built to live on
 * an iPad at the studio's desk. Month is the home view (every event on the
 * books); week and day narrow it down. Tapping a session drills into a detail
 * card with a manual check-in action driven by the existing status machine
 * (confirmed -> in_progress -> completed).
 *
 * The route lives OUTSIDE the (app) group so the sidebar/tab chrome never
 * renders, but it is NOT public: middleware still requires a signed-in staff
 * account - session data stays behind auth.
 */

type KioskView = "month" | "week" | "day";

const DAY_MS = 86_400_000;
const CLERK_ENABLED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

// iPad Safari shipped the Fullscreen API behind webkit prefixes long before
// the unprefixed spec landed (16.4), so both spellings stay supported here.
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Sunday-anchored start of the week containing ts (matches the month grid). */
function startOfWeek(ts: number): number {
  const d = new Date(startOfDay(ts));
  return startOfDay(ts) - d.getDay() * DAY_MS;
}

function shortDayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function KioskPage() {
  // The (app) shell wraps every page in this boundary; the kiosk lives
  // outside the shell, so it brings its own - a stray query throw must show
  // the recoverable panel, not tear down to the root error page.
  // useConvexAuth only exists under ConvexProviderWithAuth; demo mode (no
  // Clerk key) mounts a plain ConvexProvider, so the hook lives in a wrapper
  // that is only rendered in auth mode - calling it in demo mode throws.
  return (
    <ShellErrorBoundary>
      {CLERK_ENABLED ? <KioskWithClerkAuth /> : <Kiosk authReady />}
    </ShellErrorBoundary>
  );
}

function KioskWithClerkAuth() {
  // Convex attaches the Clerk token to the socket ASYNCHRONOUSLY after mount.
  // A query fired before that lands executes unauthenticated and throws
  // server-side (the same race orgs.current degrades around). Hold session
  // reads until auth is actually on the wire.
  const { isAuthenticated } = useConvexAuth();
  return <Kiosk authReady={isAuthenticated} />;
}

function Kiosk({ authReady }: { authReady: boolean }) {
  const [view, setView] = useState<KioskView>("month");
  const [anchor, setAnchor] = useState(() => startOfDay(Date.now()));
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);

  // Phones open on the day agenda - a 7-column month grid is unreadable at
  // phone width. matchMedia is client-only, and seeding the useState from it
  // would render "day" against the server's "month" markup (hydration
  // mismatch), so the switch happens once after mount instead.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (window.matchMedia("(max-width: 767px)").matches) setView("day");
  }, []);

  // Minute-tick clock so the header time and "today" highlight stay honest on
  // a device that sits on a desk for weeks.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  // Keep the iPad awake while the kiosk is on screen. Best-effort - browsers
  // without the Wake Lock API (or a denied request) just fall back to the
  // device's own sleep settings.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    async function acquire() {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    }
    acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, []);

  // Browser fullscreen - takes the kiosk edge to edge with no address bar or
  // browser menus; the minimize button (or the system Esc gesture) drops back
  // out. Support is a client-only constant (iPhone Safari lacks the API), so
  // it reads through useSyncExternalStore: false on the server render, the
  // real answer from the first client render on - no hydration mismatch.
  const fullscreenSupported = useSyncExternalStore(
    () => () => {},
    () => {
      const root = document.documentElement as FullscreenRoot;
      return Boolean(root.requestFullscreen ?? root.webkitRequestFullscreen);
    },
    () => false,
  );
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(fullscreenElement() !== null);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Fullscreens the whole document (not the kiosk div) so portaled overlays -
  // the session drill-down dialog renders into document.body - stay visible.
  async function toggleFullscreen() {
    try {
      if (fullscreenElement()) {
        const doc = document as FullscreenDocument;
        if (document.exitFullscreen) await document.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
      } else {
        const root = document.documentElement as FullscreenRoot;
        if (root.requestFullscreen) await root.requestFullscreen();
        else await root.webkitRequestFullscreen?.();
      }
    } catch {
      // Denied requests (kiosk embedded in an iframe, permission policy) just
      // leave the page inline - nothing to recover.
    }
  }

  const org = useQuery(api.orgs.current);

  const anchorDate = new Date(anchor);
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();

  const { from, to } = useMemo(() => {
    if (view === "month") return monthGridRange(year, month);
    if (view === "week") {
      const start = startOfWeek(anchor);
      return { from: start, to: start + 7 * DAY_MS - 1 };
    }
    return { from: anchor, to: anchor + DAY_MS - 1 };
  }, [view, anchor, year, month]);

  const sessions = useQuery(api.sessions.inRange, authReady ? { from, to } : "skip") as
    | Session[]
    | undefined;

  function shift(delta: number) {
    if (view === "month") {
      setAnchor(new Date(year, month + delta, 1).getTime());
    } else if (view === "week") {
      setAnchor(anchor + delta * 7 * DAY_MS);
    } else {
      setAnchor(anchor + delta * DAY_MS);
    }
  }

  function goToday() {
    setAnchor(startOfDay(Date.now()));
  }

  function openDay(ts: number) {
    setAnchor(startOfDay(ts));
    setView("day");
  }

  const rangeLabel =
    view === "month"
      ? `${MONTH_NAMES[month]} ${year}`
      : view === "week"
        ? `${shortDayLabel(startOfWeek(anchor))} - ${shortDayLabel(startOfWeek(anchor) + 6 * DAY_MS)}, ${new Date(startOfWeek(anchor)).getFullYear()}`
        : longDate(anchor);

  const openSession = openSessionId
    ? (sessions ?? []).find((s) => s._id === openSessionId) ?? null
    : null;

  return (
    <div
      className="grain flex h-dvh flex-col overflow-hidden bg-ink text-bone"
      style={brandStyle(org?.accentColor)}
    >
      {/* ambient gold wash */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-[320px] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(253,185,19,0.08),transparent_70%)]"
      />

      {/* ── Header ── */}
      {/* Wraps into stacked rows on phones (wordmark+clock / nav / view
          switcher) and two rows on iPad portrait; one row on lg+. The pt env()
          keeps the chrome clear of the iOS status bar - standalone mode draws
          edge to edge under the notch/Dynamic Island without it. */}
      <header className="relative z-10 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-graphite/50 bg-obsidian/80 px-3 py-2.5 pt-[calc(0.625rem_+_env(safe-area-inset-top))] backdrop-blur sm:px-5 sm:py-3 sm:pt-[calc(0.75rem_+_env(safe-area-inset-top))] lg:flex-nowrap lg:gap-x-4">
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:flex-initial">
          {org?.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={org.logoUrl} alt="" className="size-9 rounded object-contain" />
          ) : (
            <span className="grid size-9 place-items-center rounded-md bg-gold text-gold-ink">
              <Disc3 className="size-5" />
            </span>
          )}
          <div className="min-w-0 leading-none">
            <p className="truncate font-grotesk text-base font-semibold tracking-tight">
              {org?.name ?? "Pulse"}
            </p>
            <p className="overline mt-1">Front desk</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 lg:order-4 lg:gap-4">
          <div className="text-right leading-none">
            <p className="font-meta text-xl font-semibold tabular-nums text-gold-bright">
              {new Date(now).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </p>
            <p className="mt-1 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
              {new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </p>
          </div>

          {fullscreenSupported && (
            <Button
              variant="outline"
              size="icon"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Minimize" : "Full screen"}
              title={fullscreen ? "Minimize" : "Full screen"}
            >
              {fullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
            </Button>
          )}
        </div>

        <div className="order-3 flex w-full items-center justify-center gap-2 md:w-auto md:flex-1 lg:order-2 lg:flex-initial">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous">
            <ChevronLeft className="size-5" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-center font-grotesk text-base font-bold tracking-tight sm:text-xl md:min-w-56 md:flex-none">
            {rangeLabel}
          </h1>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next">
            <ChevronRight className="size-5" />
          </Button>
          <Button variant="secondary" onClick={goToday}>
            Today
          </Button>
        </div>

        {/* View filter - month is home; week and day narrow it down. Full-width
            segmented control on phones so it never falls off the screen. */}
        <div className="order-4 flex w-full justify-center md:w-auto lg:order-3">
          <div className="inline-flex w-full items-center gap-1 rounded-md border border-graphite/50 bg-coal p-1 md:w-auto">
            {(
              [
                { key: "month", label: "Month", icon: CalendarRange },
                { key: "week", label: "Week", icon: CalendarDays },
                { key: "day", label: "Day", icon: Sun },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-sm px-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/30 md:flex-none md:px-4",
                  view === key ? "bg-coal-3 text-bone" : "text-steel/70 hover:text-bone",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <main className="relative z-10 min-h-0 flex-1 p-2 pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] sm:p-4 sm:pb-[calc(1rem_+_env(safe-area-inset-bottom))]">
        {sessions === undefined ? (
          <Skeleton className="h-full w-full" />
        ) : view === "month" ? (
          <KioskMonth
            year={year}
            month={month}
            now={now}
            sessions={sessions}
            onOpenSession={setOpenSessionId}
            onOpenDay={openDay}
          />
        ) : view === "week" ? (
          <KioskWeek
            weekStart={startOfWeek(anchor)}
            now={now}
            sessions={sessions}
            onOpenSession={setOpenSessionId}
            onOpenDay={openDay}
          />
        ) : (
          <KioskDay day={anchor} now={now} sessions={sessions} onOpenSession={setOpenSessionId} />
        )}
      </main>

      <KioskSessionDialog session={openSession} onClose={() => setOpenSessionId(null)} />
    </div>
  );
}

/** Group sessions by local day, sorted by start time within each day. */
function groupByDay(sessions: Session[]): Map<number, Session[]> {
  const byDay = new Map<number, Session[]>();
  for (const s of sessions) {
    const key = startOfDay(s.startTime);
    const list = byDay.get(key);
    if (list) list.push(s);
    else byDay.set(key, [s]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.startTime - b.startTime);
  return byDay;
}

/** One tappable session chip - sized for fingers, not cursors. */
function SessionChip({
  session,
  onOpen,
  showStatus,
  compact,
}: {
  session: Session;
  onOpen: (id: string) => void;
  showStatus?: boolean;
  /** Dense one-liner for month cells, where six weeks share the frame. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(session._id);
      }}
      className={cn(
        "flex w-full items-center overflow-hidden rounded-md border border-graphite/50 bg-coal-2 text-left outline-none transition-colors hover:border-graphite/70 hover:bg-coal-3 focus-visible:ring-2 focus-visible:ring-gold/30",
        compact ? "gap-1.5 px-1.5 py-[3px]" : "min-h-11 gap-2 px-2.5 py-1.5",
      )}
    >
      <span
        aria-hidden
        className={cn("shrink-0 rounded-full", compact ? "h-3.5 w-0.5" : "h-7 w-1")}
        style={{ backgroundColor: statusColor(session.status) }}
      />
      <span
        className={cn(
          "shrink-0 font-meta text-steel/70",
          compact ? "text-[0.5625rem]" : "text-xs",
        )}
      >
        {timeOfDay(session.startTime)}
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-medium text-bone",
          compact ? "text-[0.6875rem]" : "text-sm",
        )}
      >
        {session.title}
      </span>
      {showStatus && (
        <Badge tone={meta(SESSION_STATUS, session.status).tone}>
          {meta(SESSION_STATUS, session.status).label}
        </Badge>
      )}
    </button>
  );
}

/** Month view - the six-week grid, cells drill into the day view. */
function KioskMonth({
  year,
  month,
  now,
  sessions,
  onOpenSession,
  onOpenDay,
}: {
  year: number;
  month: number;
  now: number;
  sessions: Session[];
  onOpenSession: (id: string) => void;
  onOpenDay: (ts: number) => void;
}) {
  const days = useMemo(() => monthGridDays(year, month), [year, month]);
  const byDay = groupByDay(sessions);

  return (
    // A plain `1fr` grid track never shrinks below its content (it means
    // minmax(auto, 1fr)), which let busy months push the last weeks past the
    // fold. minmax(0, 1fr) + min-h-0 keeps all six weeks inside the frame.
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-graphite/50 bg-coal">
      <div className="grid grid-cols-7 border-b border-graphite/50 bg-obsidian">
        {WEEKDAY_LABELS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center font-meta text-xs uppercase tracking-wide text-steel/70"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 grid-cols-7 grid-rows-6">
        {days.map((dayTs) => {
          const inMonth = new Date(dayTs).getMonth() === month;
          const isToday = isSameDay(dayTs, now);
          const dayList = byDay.get(dayTs) ?? [];
          const visible = dayList.slice(0, 3);
          const overflow = dayList.length - visible.length;
          return (
            <div
              key={dayTs}
              role="button"
              tabIndex={0}
              onClick={() => onOpenDay(dayTs)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpenDay(dayTs);
                }
              }}
              className={cn(
                "flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-b border-r border-graphite/50 p-1 outline-none transition-colors last:border-r-0 hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30",
                !inMonth && "bg-obsidian/40",
                isToday && "bg-gold/[0.04]",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-sm font-meta text-xs",
                  isToday && "bg-gold font-bold text-gold-ink",
                  !isToday && inMonth && "text-bone",
                  !isToday && !inMonth && "text-steel/70",
                )}
              >
                {new Date(dayTs).getDate()}
              </span>
              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {visible.map((s) => (
                  <SessionChip key={s._id} session={s} onOpen={onOpenSession} compact />
                ))}
                {overflow > 0 && (
                  <span className="px-1 font-meta text-[0.625rem] text-steel/70">
                    +{overflow} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Week view - seven columns of session cards. */
function KioskWeek({
  weekStart,
  now,
  sessions,
  onOpenSession,
  onOpenDay,
}: {
  weekStart: number;
  now: number;
  sessions: Session[];
  onOpenSession: (id: string) => void;
  onOpenDay: (ts: number) => void;
}) {
  const byDay = groupByDay(sessions);
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i * DAY_MS);

  return (
    // Phones: a vertical scrolling list of day sections - seven columns can't
    // share 390px. iPad portrait and up gets the side-by-side week grid.
    <div className="flex h-full flex-col gap-2 overflow-y-auto md:grid md:grid-cols-7 md:overflow-visible">
      {days.map((dayTs) => {
        const isToday = isSameDay(dayTs, now);
        const list = byDay.get(startOfDay(dayTs)) ?? [];
        return (
          <section
            key={dayTs}
            className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-graphite/50 bg-coal md:min-h-0 md:shrink"
          >
            <button
              type="button"
              onClick={() => onOpenDay(dayTs)}
              className={cn(
                "flex shrink-0 items-baseline gap-2 border-b border-graphite/50 px-3 py-2.5 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30 md:block",
                isToday ? "bg-gold/10" : "bg-obsidian",
              )}
            >
              <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                {WEEKDAY_LABELS[new Date(dayTs).getDay()]}
              </p>
              <p
                className={cn(
                  "font-grotesk text-lg font-bold",
                  isToday ? "text-gold-bright" : "text-bone",
                )}
              >
                {new Date(dayTs).getDate()}
              </p>
            </button>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
              {list.length === 0 ? (
                <p className="px-1.5 py-2 text-xs text-steel/50">No sessions</p>
              ) : (
                list.map((s) => <SessionChip key={s._id} session={s} onOpen={onOpenSession} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Day view - the drill-down agenda with check-in right on the row. */
function KioskDay({
  day,
  now,
  sessions,
  onOpenSession,
}: {
  day: number;
  now: number;
  sessions: Session[];
  onOpenSession: (id: string) => void;
}) {
  const list = [...sessions].sort((a, b) => a.startTime - b.startTime);

  if (list.length === 0) {
    return (
      <div className="grid h-full place-items-center rounded-lg border border-graphite/50 bg-coal">
        <div className="text-center">
          <CalendarRange className="mx-auto size-10 text-steel/40" />
          <p className="mt-3 font-grotesk text-lg font-semibold text-bone">
            Nothing booked {isSameDay(day, now) ? "today" : `on ${longDate(day)}`}
          </p>
          <p className="mt-1 text-sm text-steel/70">Sessions for this day will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto rounded-lg border border-graphite/50 bg-coal">
      <ul className="divide-y divide-hairline">
        {list.map((s) => {
          const st = meta(SESSION_STATUS, s.status);
          const live = s.status === "in_progress";
          return (
            <li key={s._id}>
              <button
                type="button"
                onClick={() => onOpenSession(s._id)}
                className="flex w-full items-center gap-3 px-3 py-4 text-left outline-none transition-colors hover:bg-coal-2 focus-visible:ring-2 focus-visible:ring-gold/30 sm:gap-4 sm:px-5"
              >
                <span
                  aria-hidden
                  className="h-12 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: statusColor(s.status) }}
                />
                <div className="w-20 shrink-0 sm:w-28">
                  <p className="font-meta text-base font-semibold text-bone">
                    {timeOfDay(s.startTime)}
                  </p>
                  <p className="font-meta text-xs text-steel/70">{duration(s.startTime, s.endTime)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-grotesk text-base font-semibold text-bone sm:text-lg">{s.title}</p>
                  <p className="truncate text-sm text-steel/70">
                    {s.artistName}
                    {" · "}
                    {titleCase(s.serviceType)}
                    {s.roomName ? ` · ${s.roomName}` : ""}
                    {s.engineerName ? ` · ${s.engineerName}` : ""}
                  </p>
                </div>
                {live && (
                  <span className="inline-flex items-center gap-1.5 font-meta text-xs uppercase tracking-wide text-gold-bright">
                    <span className="size-2 animate-pulse rounded-full bg-gold" />
                    Live
                  </span>
                )}
                <Badge tone={st.tone}>{st.label}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Session drill-down + the manual check-in action. */
function KioskSessionDialog({
  session,
  onClose,
}: {
  session: Session | null;
  onClose: () => void;
}) {
  const setStatus = useMutation(api.sessions.setStatus);
  const [busy, setBusy] = useState(false);

  async function transition(status: Session["status"]) {
    if (!session) return;
    setBusy(true);
    try {
      await setStatus({ id: session._id as Id<"sessions">, status });
    } finally {
      setBusy(false);
    }
  }

  const st = session ? meta(SESSION_STATUS, session.status) : null;

  return (
    <Dialog open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        {session && st && (
          <>
            <DialogHeader>
              <div className="flex items-start justify-between gap-3 pr-8">
                <DialogTitle className="font-grotesk text-xl">{session.title}</DialogTitle>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <p className="text-sm text-steel/70">
                {longDate(session.startTime)} · {timeOfDay(session.startTime)} -{" "}
                {timeOfDay(session.endTime)} ({duration(session.startTime, session.endTime)})
              </p>
            </DialogHeader>
            <DialogBody className="space-y-3">
              <DetailRow icon={User} label="Client">
                {session.artistName}
              </DetailRow>
              <DetailRow icon={Disc3} label="Service">
                {titleCase(session.serviceType)}
              </DetailRow>
              {session.songTitle && (
                <DetailRow icon={Music2} label="Song">
                  {session.songTitle}
                </DetailRow>
              )}
              {session.roomName && (
                <DetailRow icon={DoorOpen} label="Room">
                  {session.roomName}
                </DetailRow>
              )}
              {session.engineerName && (
                <DetailRow icon={Headphones} label="Engineer">
                  {session.engineerName}
                </DetailRow>
              )}
              <DetailRow icon={Receipt} label="Rate">
                <span className="inline-flex items-center gap-2">
                  {money(session.rateCents)}
                  {session.depositCents > 0 &&
                    (session.depositPaid ? (
                      <Badge tone="positive">Deposit paid</Badge>
                    ) : (
                      <Badge tone="caution">{money(session.depositCents)} deposit due</Badge>
                    ))}
                </span>
              </DetailRow>
              <DetailRow icon={ClipboardCheck} label="Intake">
                {session.intakeCompleted ? (
                  <Badge tone="positive">Complete</Badge>
                ) : (
                  <Badge tone="neutral">Pending</Badge>
                )}
              </DetailRow>
              {session.notes && (
                <DetailRow icon={StickyNote} label="Notes">
                  {session.notes}
                </DetailRow>
              )}
            </DialogBody>
            <DialogFooter className="flex-col gap-2 sm:flex-col">
              {session.status === "tentative" && (
                <>
                  <Button className="min-h-12 w-full" disabled={busy} onClick={() => transition("confirmed")}>
                    Confirm booking
                  </Button>
                  <p className="text-center text-xs text-steel/70">
                    Confirm the booking first, then check the client in.
                  </p>
                </>
              )}
              {session.status === "confirmed" && (
                <Button className="min-h-12 w-full" disabled={busy} onClick={() => transition("in_progress")}>
                  <CheckCircle2 className="size-5" />
                  Check in
                </Button>
              )}
              {session.status === "in_progress" && (
                <>
                  <p className="inline-flex items-center justify-center gap-2 text-sm text-gold-bright">
                    <span className="size-2 animate-pulse rounded-full bg-gold" />
                    Checked in - session running
                  </p>
                  <Button
                    variant="secondary"
                    className="min-h-12 w-full"
                    disabled={busy}
                    onClick={() => transition("completed")}
                  >
                    Mark complete
                  </Button>
                </>
              )}
              {session.status === "completed" && (
                <p className="inline-flex items-center justify-center gap-2 text-sm text-positive">
                  <CheckCircle2 className="size-4" />
                  Session completed
                </p>
              )}
              {(session.status === "cancelled" || session.status === "no_show") && (
                <p className="text-center text-sm text-steel/70">
                  This session was {st.label.toLowerCase()}.
                </p>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-hairline pb-2.5 last:border-0 last:pb-0">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-steel/70">
        <Icon className="size-4" />
        {label}
      </span>
      <div className="min-w-0 text-right text-sm text-bone">{children}</div>
    </div>
  );
}
