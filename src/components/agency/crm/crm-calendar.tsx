"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, LayoutGrid, List, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { SkeletonRows } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SyncBar, TOUCH, WriteButton, ZuErrorState, money } from "./crm-ui";
import { useZuRead, useZuWrite, type ZuPaged } from "./use-zu";
import { LeadSheet } from "./crm-lead-sheet";
import { CAL_OP } from "./calendar-ops";
import { BookingStatusBadge } from "./calendar-parts";
import { AppointmentSheet, memberName } from "./calendar-appointment-sheet";
import { BookSheet } from "./calendar-book-sheet";
import { BusinessHoursSection, BusyBlocksSection, CalendarsSection } from "./calendar-setup";
import {
  addDays, agendaDays, bookingsWindow, buildWeek, dateKeyIn, dayLabel, lengthWord, meetingWord, minutesBetween,
  outcomeMissing, timeIn, weekStart,
} from "./calendar-logic";
import type { Booking, BookingsResponse, CalendarsResponse } from "./calendar-types";
import type { Lead, Member, MembersResponse } from "./zu-types";

/* Calendar: appointments as an agenda by day or a week grid (agenda on phones),
   an appointment sheet, booking, and the calendars, busy times and hours behind
   them. Opening it reads three things: appointments, lead names and the team. */

type Section = "appointments" | "setup";
type View = "agenda" | "week";

export function CrmCalendar({ bookLeadId }: { bookLeadId?: string | null }) {
  const [section, setSection] = React.useState<Section>("appointments");
  const [view, setView] = React.useState<View>("agenda");
  const [now] = React.useState(() => Date.now());
  const win = React.useMemo(() => bookingsWindow(now), [now]);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [sheetLead, setSheetLead] = React.useState<string | null>(null);
  const [bookOpen, setBookOpen] = React.useState(!!bookLeadId);
  const [bookLead, setBookLead] = React.useState<string | null>(bookLeadId ?? null);
  const [seenBook, setSeenBook] = React.useState(bookLeadId ?? null);
  if ((bookLeadId ?? null) !== seenBook) {
    setSeenBook(bookLeadId ?? null);
    if (bookLeadId) { setBookLead(bookLeadId); setBookOpen(true); setSection("appointments"); }
  }

  const bookings = useZuRead<BookingsResponse>(CAL_OP.bookings, { query: { from: win.from, to: win.to } }, { kinds: ["booking"] });
  const leads = useZuRead<ZuPaged<Lead>>(CAL_OP.leads, undefined, { kinds: ["lead"], pollMs: 300_000, pages: { listKey: "leads", limit: 200, max: 400 } });
  const members = useZuRead<MembersResponse>(CAL_OP.members, undefined, { pollMs: 600_000 });
  const needCalendars = bookOpen || section === "setup" || openId !== null;
  const calendars = useZuRead<CalendarsResponse>(CAL_OP.calendars, undefined, { pollMs: 300_000, enabled: needCalendars });

  const leadNames = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads.data?.items ?? []) m.set(l.id, l.full_name || l.email || l.phone || "Unnamed lead");
    return m;
  }, [leads.data]);
  const leadName = React.useCallback((id: string) => leadNames.get(id) ?? null, [leadNames]);
  const memberList: Member[] = members.data?.members ?? [];
  const hostName = (id: string | null | undefined) => (id ? memberName(memberList.find((m) => m.user_id === id)) : null);

  const list = bookings.data?.bookings ?? [];
  const open = openId ? list.find((b) => b.id === openId) ?? null : null;
  const calendarList = calendars.data?.calendars ?? [];
  const tz = list.find((b) => b.timezone)?.timezone ?? calendarList[0]?.timezone ?? null;
  const [weekKey, setWeekKey] = React.useState(() => weekStart(dateKeyIn(now, null)));

  const refreshAll = () => { bookings.refresh(); leads.refresh(); members.refresh(); if (needCalendars) calendars.refresh(); };
  const openBook = () => { setBookLead(null); setBookOpen(true); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SyncBar fetchedAt={bookings.fetchedAt} onRefresh={refreshAll} refreshing={bookings.refreshing} />
        <WriteButton type="button" onClick={openBook}><CalendarPlus className="size-4" aria-hidden />Book</WriteButton>
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
            <h2 id="cal-appts-h" className="mr-auto font-grotesk text-base font-semibold text-bone">Appointments</h2>
            <div role="group" aria-label="View" className="hidden gap-1 md:flex">
              <Button type="button" size="sm" variant={view === "agenda" ? "primary" : "secondary"} aria-pressed={view === "agenda"} onClick={() => setView("agenda")}>
                <List className="size-4" aria-hidden />Agenda
              </Button>
              <Button type="button" size="sm" variant={view === "week" ? "primary" : "secondary"} aria-pressed={view === "week"} onClick={() => setView("week")}>
                <LayoutGrid className="size-4" aria-hidden />Week
              </Button>
            </div>
          </div>
          <p className="text-xs text-steel">From {dayLabel(dateKeyIn(Date.parse(win.from)))} to {dayLabel(dateKeyIn(Date.parse(win.to) - 1))}. Times are in each appointment&apos;s own time zone.</p>

          {bookings.error && !bookings.data ? (
            <ZuErrorState error={bookings.error} onRetry={bookings.refresh} />
          ) : bookings.loading ? (
            <div aria-busy="true" aria-label="Loading appointments"><SkeletonRows rows={5} /></div>
          ) : list.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No appointments in this window" description="Bookings from your calendars, smart forms and the AI show up here." action={<WriteButton type="button" size="sm" onClick={openBook}><CalendarPlus className="size-4" aria-hidden />Book one</WriteButton>} />
          ) : (
            <>
              {bookings.error && <p role="alert" className="text-xs text-caution">Showing the last copy. {bookings.error.reason}</p>}
              {view === "week" && (
                <WeekGrid
                  bookings={list} startKey={weekKey} tz={tz} onOpen={setOpenId} leadName={leadName}
                  onPrev={() => setWeekKey((k) => addDays(k, -7))} onNext={() => setWeekKey((k) => addDays(k, 7))}
                  onToday={() => setWeekKey(weekStart(dateKeyIn(Date.now(), null)))}
                />
              )}
              <div className={cn(view === "week" && "md:hidden")}>
                <Agenda bookings={list} now={now} tz={tz} onOpen={setOpenId} leadName={leadName} hostName={hostName} />
              </div>
            </>
          )}
        </section>
      )}

      <AppointmentSheet
        booking={open} onClose={() => setOpenId(null)} leadName={leadName} members={memberList} calendars={calendarList}
        onOpenLead={(id) => { setOpenId(null); setSheetLead(id); }}
      />
      <BookSheet
        open={bookOpen} onOpenChange={setBookOpen} initialLeadId={bookLead} calendars={calendarList}
        calendarsError={calendars.error && !calendars.data ? calendars.error.reason : null}
        leadName={leadName}
      />
      <LeadSheet leadId={sheetLead} onClose={() => setSheetLead(null)} onBook={(id) => { setBookLead(id); setBookOpen(true); }} />
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
  const { run, pending } = useZuWrite();
  const days = agendaDays(bookings, now, tz);
  const outcome = async (b: Booking, status: "completed" | "no_show") => {
    const res = await run(CAL_OP.update, { path: { booking_id: b.id }, body: { status } }, { invalidate: [CAL_OP.bookings] });
    if (res.ok) toast.success(status === "completed" ? "Marked completed. No message went to the lead." : "Marked no show. No message went to the lead.");
    else toast.error(res.reason ?? "Zuops refused.");
  };
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
                b.lead_id ? leadName(b.lead_id) : null,
                hostName(b.host_user_id) ? `Host ${hostName(b.host_user_id)}` : null,
                meetingWord(b.meeting_type) || null,
                sd?.total_cents != null ? money(sd.total_cents, sd.currency ?? "USD") : null,
              ].filter(Boolean).join(" · ");
              return (
                <li key={b.id} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:items-center">
                  <div className="tabular-nums">
                    <p className="text-sm font-semibold text-bone">{Number.isFinite(start) ? timeIn(start, b.timezone) : "No time"}</p>
                    <p className="text-xs text-steel">{lengthWord(mins)}</p>
                  </div>
                  <div className="min-w-0">
                    <button
                      type="button" onClick={() => onOpen(b.id)}
                      className="block max-w-full truncate rounded-sm text-left text-sm font-semibold text-bone outline-none hover:underline focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:min-h-11"
                    >
                      {b.title || "Appointment"}
                    </button>
                    <p className="truncate text-xs text-steel">{meta || "No details"}</p>
                    {missing && <p className="text-xs text-caution">Outcome not recorded</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {missing ? (
                      <>
                        <WriteButton type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void outcome(b, "completed")}>
                          <CheckCircle2 className="size-4" aria-hidden />Completed
                        </WriteButton>
                        <WriteButton type="button" size="sm" variant="secondary" disabled={pending} onClick={() => void outcome(b, "no_show")}>
                          <UserX className="size-4" aria-hidden />No show
                        </WriteButton>
                      </>
                    ) : <BookingStatusBadge status={b.status} />}
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
        <Button type="button" size="sm" variant="secondary" onClick={onPrev} aria-label="Previous week"><ChevronLeft className="size-4" aria-hidden /></Button>
        <Button type="button" size="sm" variant="secondary" onClick={onToday}>This week</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onNext} aria-label="Next week"><ChevronRight className="size-4" aria-hidden /></Button>
        <p className="text-sm text-bone">Week of {dayLabel(startKey)}</p>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cols.map((c) => (
          <section key={c.key} aria-label={c.label} className="min-h-40 min-w-0 space-y-1.5 rounded-lg border border-graphite/50 bg-coal/40 p-2">
            <h3 className="text-xs font-semibold text-steel">{c.label}</h3>
            {c.items.length === 0 ? <p className="text-[0.6875rem] text-steel/60">Nothing</p> : c.items.map((b) => (
              <button
                key={b.id} type="button" onClick={() => onOpen(b.id)}
                className="block w-full space-y-0.5 rounded-md border border-graphite/60 bg-coal-2 p-1.5 text-left text-xs outline-none hover:border-gold-dim focus-visible:ring-2 focus-visible:ring-gold/40"
              >
                <span className="block font-semibold tabular-nums text-bone">{timeIn(Date.parse(b.starts_at ?? ""), b.timezone)}</span>
                <span className="block truncate text-bone">{b.title || "Appointment"}</span>
                {b.lead_id && leadName(b.lead_id) && <span className="block truncate text-steel">{leadName(b.lead_id)}</span>}
                <BookingStatusBadge status={b.status} />
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
