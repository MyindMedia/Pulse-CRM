"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, LayoutGrid, List, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SyncBar, TOUCH, WriteButton, ZuErrorState, money } from "./crm-ui";
import { useIdemFor, useZuRead, useZuWrite } from "./use-zu";
import { useNow } from "./inbox-clock";
import { LEAD_NAME_PAGE, leadNameMap } from "./calendar-lead-names";
import { focusSoon } from "./inbox-focus";
import { writeFingerprint } from "./inbox-logic";
import { LeadSheet } from "./crm-lead-sheet";
import { CAL_OP } from "./calendar-ops";
import { BookingStatusBadge } from "./calendar-parts";
import { AppointmentSheet, memberName } from "./calendar-appointment-sheet";
import { BookSheet } from "./calendar-book-sheet";
import { BusinessHoursSection, BusyBlocksSection, CalendarsSection } from "./calendar-setup";
import {
  addDays, agendaDays, buildWeek, dayLabel, lengthWord, meetingWord, minutesBetween,
  outcomeMissing, timeIn, todayKey, viewWindow, weekStart,
} from "./calendar-logic";
import type { Booking, BookingsResponse, CalendarsResponse } from "./calendar-types";
import type { LeadsResponse, Member, MembersResponse } from "./zu-types";

/* Calendar: appointments as an agenda by day or a week grid (agenda on phones),
   an appointment sheet, booking, and the calendars, busy times and hours behind
   them. First open reads three things (R3-I3): appointments, one page of leads
   (only as an id to name map) and the team. A lead outside that page shows
   "Lead" and its id tail until its appointment is opened. */

/** "Lead" plus the id's tail, until the name is known. */
export function leadPlaceholder(id: string): string {
  return `Lead ${id.slice(-6)}`;
}

type Section = "appointments" | "setup";
const EMPTY_BOOKINGS: Booking[] = [];
type View = "agenda" | "week";

export function CrmCalendar({ bookLeadId, bookNonce }: { bookLeadId?: string | null; bookNonce?: number }) {
  const [section, setSection] = React.useState<Section>("appointments");
  const [view, setView] = React.useState<View>("agenda");
  // "Now" moves (F-U14): Today, missing outcomes and the window follow the clock.
  const now = useNow(60_000);
  const today = todayKey(now);
  const [weekKey, setWeekKey] = React.useState(() => weekStart(todayKey(Date.now())));
  // The agenda reads today -7..+60 days; the week view reads the week on show.
  const win = React.useMemo(() => viewWindow(view, today, weekKey), [view, today, weekKey]);
  const [openId, setOpenIdRaw] = React.useState<string | null>(null);
  // What opened a sheet, so focus goes back there when it closes (R3-I4), or to
  // the row by id, or the heading when the row is gone (after a cancel).
  const opener = React.useRef<HTMLElement | null>(null);
  const remember = () => { opener.current = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null; };
  const setOpenId = (id: string | null) => { if (id) remember(); setOpenIdRaw(id); };
  const returnFocus = (rowId?: string | null) => focusSoon(opener.current, rowId ? `appt-${rowId}` : null, rowId ? `appt-w-${rowId}` : null, "cal-appts-h");
  const [sheetLead, setSheetLead] = React.useState<string | null>(null);
  const [bookOpen, setBookOpen] = React.useState(!!bookLeadId);
  const [bookLead, setBookLead] = React.useState<string | null>(bookLeadId ?? null);
  // Every jump from elsewhere bumps the nonce, so booking the same lead twice
  // opens the sheet again (F-U15).
  const jump = `${bookLeadId ?? ""}|${bookNonce ?? 0}`;
  const [seenJump, setSeenJump] = React.useState(jump);
  if (jump !== seenJump) {
    setSeenJump(jump);
    if (bookLeadId) { setBookLead(bookLeadId); setBookOpen(true); setSection("appointments"); }
  }

  const bookings = useZuRead<BookingsResponse>(CAL_OP.bookings, { query: { from: win.from, to: win.to } }, { kinds: ["booking"], pollMs: 300_000 });
  const members = useZuRead<MembersResponse>(CAL_OP.members, undefined, { pollMs: 600_000 });
  const needCalendars = bookOpen || section === "setup" || openId !== null;
  const calendars = useZuRead<CalendarsResponse>(CAL_OP.calendars, undefined, { pollMs: 300_000, enabled: needCalendars });

  const leads = useZuRead<LeadsResponse>(CAL_OP.leads, { query: { limit: LEAD_NAME_PAGE } }, { kinds: ["lead"], pollMs: 600_000 });
  const list = bookings.data?.bookings ?? EMPTY_BOOKINGS;
  const names = React.useMemo(() => leadNameMap(leads.data?.leads, list), [leads.data, list]);
  const leadName = React.useCallback((id: string) => names.get(id) ?? null, [names]);
  const memberList: Member[] = members.data?.members ?? [];
  const hostName = (id: string | null | undefined) => (id ? memberName(memberList.find((m) => m.user_id === id)) : null);

  const open = openId ? list.find((b) => b.id === openId) ?? null : null;
  const calendarList = calendars.data?.calendars ?? [];
  const tz = list.find((b) => b.timezone)?.timezone ?? calendarList[0]?.timezone ?? null;

  const refreshAll = () => { bookings.refresh(); leads.refresh(); members.refresh(); if (needCalendars) calendars.refresh(); };
  const openBook = () => { remember(); setBookLead(null); setBookOpen(true); };
  const empty = (
    <EmptyState
      icon={CalendarDays} title="No appointments in this window" description="Bookings from your calendars, smart forms and the AI show up here."
      action={<WriteButton type="button" size="sm" onClick={openBook}><CalendarPlus className="size-4" aria-hidden />Book one</WriteButton>}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SyncBar fetchedAt={bookings.fetchedAt} onRefresh={refreshAll} refreshing={bookings.refreshing} />
        <WriteButton id="cal-book-btn" type="button" onClick={openBook}><CalendarPlus className="size-4" aria-hidden />Book</WriteButton>
      </div>

      <div role="group" aria-label="Calendar sections" className="flex flex-wrap gap-1">
        {([["appointments", "Appointments"], ["setup", "Calendars and hours"]] as const).map(([id, label]) => (
          <Button key={id} type="button" size="sm" variant={section === id ? "primary" : "secondary"} className={TOUCH} aria-pressed={section === id} onClick={() => setSection(id)}>
            {label}
          </Button>
        ))}
      </div>

      {section === "setup" ? (
        <div className="space-y-8">
          <CalendarsSection calendars={calendarList} error={calendars.error} loading={calendars.loading} onRetry={calendars.refresh} />
          <BusyBlocksSection members={memberList} />
          <BusinessHoursSection />
        </div>
      ) : (
        <section aria-labelledby="cal-appts-h" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="cal-appts-h" tabIndex={-1} className="mr-auto font-grotesk outline-none text-base font-semibold text-bone">Appointments</h2>
            <div role="group" aria-label="View" className="hidden gap-1 md:flex">
              <Button type="button" size="sm" variant={view === "agenda" ? "primary" : "secondary"} aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>
                <List className="size-4" aria-hidden />Agenda
              </Button>
              <Button type="button" size="sm" variant={view === "week" ? "primary" : "secondary"} aria-pressed={view === "week"} onClick={() => setView("week")}>
                <LayoutGrid className="size-4" aria-hidden />Week
              </Button>
            </div>
          </div>
          <p className="text-xs text-steel">
            {view === "week" ? `Week of ${dayLabel(weekKey)}` : `From ${dayLabel(addDays(today, -7))} to ${dayLabel(addDays(today, 60))}`}. Times are in each appointment&apos;s own time zone.
          </p>

          {bookings.error && !bookings.data ? (
            <ZuErrorState error={bookings.error} onRetry={bookings.refresh} />
          ) : bookings.loading ? (
            <div aria-busy="true" aria-label="Loading appointments"><SkeletonRows rows={5} /></div>
          ) : list.length === 0 && view === "agenda" ? (
            empty
          ) : (
            <>
              {bookings.error && <p role="alert" className="text-xs text-caution">Showing the last copy. {bookings.error.reason}</p>}
              {view === "week" && (
                <WeekGrid
                  bookings={list} startKey={weekKey} tz={tz} onOpen={setOpenId} leadName={leadName}
                  onPrev={() => setWeekKey((k) => addDays(k, -7))} onNext={() => setWeekKey((k) => addDays(k, 7))}
                  onToday={() => setWeekKey(weekStart(today))}
                />
              )}
              <div className={cn(view === "week" && "md:hidden")}>
                {list.length ? <Agenda bookings={list} now={now} tz={tz} onOpen={setOpenId} leadName={leadName} hostName={hostName} /> : empty}
              </div>
            </>
          )}
        </section>
      )}

      <AppointmentSheet
        booking={open} onClose={() => { const id = openId; setOpenIdRaw(null); returnFocus(id); }} leadName={leadName} members={memberList} calendars={calendarList}
        onOpenLead={(id) => { setOpenIdRaw(null); setSheetLead(id); }}
      />
      <BookSheet
        open={bookOpen} onOpenChange={(v) => { setBookOpen(v); if (!v) focusSoon(opener.current, "cal-book-btn", "cal-appts-h"); }} initialLeadId={bookLead} calendars={calendarList}
        calendarsError={calendars.error && !calendars.data ? calendars.error.reason : null}
        leadName={leadName}
      />
      <LeadSheet leadId={sheetLead} onClose={() => { setSheetLead(null); returnFocus(null); }} onBook={(id) => { setBookLead(id); setBookOpen(true); }} />
    </div>
  );
}

function Agenda({
  bookings, now, tz, onOpen, leadName, hostName,
}: {
  bookings: Booking[];
  now: number;
  tz: string | null;
  onOpen: (id: string) => void;
  leadName: (id: string) => string | null;
  hostName: (id: string | null | undefined) => string | null;
}) {
  const days = agendaDays(bookings, now, tz);
  return (
    <div className="space-y-5">
      {days.map((d) => (
        <section key={d.key} aria-label={d.label} className="space-y-2">
          <h3 className="overline">{d.label}</h3>
          <ul className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40">
            {d.items.map((b) => {
              const start = Date.parse(b.starts_at ?? "");
              const mins = minutesBetween(b.starts_at, b.ends_at);
              const missing = outcomeMissing(b, now);
              const sd = b.service_details;
              const meta = [
                b.appointment_number ? `#${b.appointment_number}` : null,
                b.lead_id ? leadName(b.lead_id) ?? leadPlaceholder(b.lead_id) : null,
                hostName(b.host_user_id) ? `Host ${hostName(b.host_user_id)}` : null,
                meetingWord(b.meeting_type) || null,
                sd?.total_cents != null ? money(sd.total_cents, sd.currency ?? "USD") : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={b.id} className="grid grid-cols-1 gap-2 px-3 py-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:items-center">
                  <div className="tabular-nums">
                    <p className="text-sm font-semibold text-bone">{Number.isFinite(start) ? timeIn(start, b.timezone) : "No time"}</p>
                    <p className="text-xs text-steel">{lengthWord(mins)}</p>
                  </div>
                  <div className="min-w-0">
                    <button
                      id={`appt-${b.id}`} type="button" onClick={() => onOpen(b.id)}
                      className="block max-w-full truncate rounded-sm text-left text-sm font-semibold text-bone outline-none hover:underline focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:min-h-11"
                    >
                      {b.title || "Appointment"}
                    </button>
                    <p className="truncate text-xs text-steel">{meta || "No details"}</p>
                    {missing && <p className="text-xs text-caution">Outcome not recorded</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {missing ? <OutcomeButtons booking={b} /> : <BookingStatusBadge status={b.status} />}
                    <Button type="button" size="sm" variant="ghost" className={TOUCH} onClick={() => onOpen(b.id)} aria-label={`Open ${b.title || "appointment"}`}>Open</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function OutcomeButtons({ booking: b }: { booking: Booking }) {
  const { run, pending } = useZuWrite();
  // Keys from the exact body and path, plus a counter advanced on success (R3-I6).
  const [round, setRound] = React.useState(0);
  const path = { booking_id: b.id };
  const keys = {
    completed: useIdemFor(writeFingerprint(CAL_OP.update, path, { status: "completed" }, round)),
    no_show: useIdemFor(writeFingerprint(CAL_OP.update, path, { status: "no_show" }, round)),
  };
  const outcome = async (status: "completed" | "no_show") => {
    const res = await run(CAL_OP.update, { path, body: { status }, idem: keys[status] }, { invalidate: [CAL_OP.bookings] });
    if (res.ok) { setRound((r) => r + 1); focusSoon(`appt-${b.id}`, "cal-appts-h"); }
    if (res.ok) toast.success(status === "completed" ? "Marked completed. No message went to the lead." : "Marked no show. No message went to the lead.");
    else toast.error(res.reason ?? "Zuops refused.");
  };
  return (
    <>
      <WriteButton type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void outcome("completed")}>
        <CheckCircle2 className="size-4" aria-hidden />Completed
      </WriteButton>
      <WriteButton type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void outcome("no_show")}>
        <UserX className="size-4" aria-hidden />No show
      </WriteButton>
    </>
  );
}

function WeekGrid({
  bookings, startKey, tz, onOpen, onPrev, onNext, onToday, leadName,
}: {
  bookings: Booking[];
  startKey: string;
  tz: string | null;
  onOpen: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  leadName: (id: string) => string | null;
}) {
  const cols = buildWeek(bookings, startKey, tz);
  return (
    <div className="hidden space-y-2 md:block">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onPrev} aria-label="Previous week" className="max-sm:min-h-11 max-sm:min-w-11"><ChevronLeft className="size-4" aria-hidden /></Button>
        <Button type="button" size="sm" variant="secondary" onClick={onToday}>This week</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onNext} aria-label="Next week" className="max-sm:min-h-11 max-sm:min-w-11"><ChevronRight className="size-4" aria-hidden /></Button>
        <p className="text-sm text-bone">Week of {dayLabel(startKey)}</p>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cols.map((c) => (
          <section key={c.key} aria-label={c.label} className="min-h-40 min-w-0 space-y-1.5 rounded-lg border border-graphite/50 bg-coal/40 p-2">
            <h3 className="text-xs font-semibold text-steel">{c.label}</h3>
            {c.items.length === 0 ? <p className="text-[0.6875rem] text-steel/60">Nothing</p> : c.items.map((b) => (
              <button
                id={`appt-w-${b.id}`} key={b.id} type="button" onClick={() => onOpen(b.id)}
                className="block w-full space-y-0.5 rounded-md border border-graphite/60 bg-coal-2 p-1.5 text-left text-xs outline-none hover:border-gold-dim focus-visible:ring-2 focus-visible:ring-gold/40"
              >
                <span className="block font-semibold tabular-nums text-bone">{timeIn(Date.parse(b.starts_at ?? ""), b.timezone)}</span>
                <span className="block truncate text-bone">{b.title || "Appointment"}</span>
                {b.lead_id && <span className="block truncate text-steel">{leadName(b.lead_id) ?? leadPlaceholder(b.lead_id)}</span>}
                <BookingStatusBadge status={b.status} />
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
