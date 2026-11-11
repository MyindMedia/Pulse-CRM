"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, ExternalLink, RotateCcw, UserRound, UserX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/toggle";
import { TOUCH, WriteButton, dateTime, money } from "./crm-ui";
import { useZuWrite } from "./use-zu";
import { safeUrl } from "./inbox-logic";
import { useNow } from "./inbox-clock";
import { CAL_OP } from "./calendar-ops";
import { BookingStatusBadge, SlotPicker } from "./calendar-parts";
import { lengthWord, meetingWord, minutesBetween, outcomeMissing, timeIn } from "./calendar-logic";
import type { Booking, Calendar } from "./calendar-types";
import type { Member } from "./zu-types";

/* One appointment: details, outcome, reschedule, cancel, host, location, notes and
   whether the lead gets reminders. Every control says whether the lead hears
   about it. */

const INVALIDATE = [CAL_OP.bookings, CAL_OP.availability] as const;
const NONE = "__none";

export function memberName(m: Member | undefined): string {
  return m?.full_name || m?.email || "Team member";
}

export function AppointmentSheet({
  booking,
  onClose,
  leadName,
  members,
  calendars,
  onOpenLead,
}: {
  booking: Booking | null;
  onClose: () => void;
  leadName: (id: string) => string | null;
  members: Member[];
  calendars: Calendar[];
  onOpenLead: (leadId: string) => void;
}) {
  return (
    <Sheet open={!!booking} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent width="lg">
        {booking && (
          <AppointmentBody key={booking.id} b={booking} leadName={leadName} members={members} calendars={calendars} onOpenLead={onOpenLead} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function AppointmentBody({
  b, leadName, members, calendars, onOpenLead,
}: {
  b: Booking;
  leadName: (id: string) => string | null;
  members: Member[];
  calendars: Calendar[];
  onOpenLead: (leadId: string) => void;
}) {
  const now = useNow();
  const { run, pending } = useZuWrite();
  const [rescheduling, setRescheduling] = React.useState(false);
  const [slot, setSlot] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);
  const [cancelReason, setCancelReason] = React.useState("");
  const [notes, setNotes] = React.useState<string | null>(null);
  const [location, setLocation] = React.useState<string | null>(null);
  const [host, setHost] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const path = { booking_id: b.id };
  const name = (b.lead_id && leadName(b.lead_id)) || "the lead";
  const notifies = b.notify_lead !== false;
  const cancelled = b.status === "cancelled";
  const calendar = calendars.find((c) => c.id === b.calendar_id);
  const hostMember = members.find((m) => m.user_id === b.host_user_id);
  const mins = minutesBetween(b.starts_at, b.ends_at);
  const start = b.starts_at ? Date.parse(b.starts_at) : NaN;
  const end = b.ends_at ? Date.parse(b.ends_at) : NaN;
  const when = Number.isFinite(start)
    ? `${dateTime(b.starts_at, b.timezone)}${Number.isFinite(end) ? ` to ${timeIn(end, b.timezone)}` : ""}`
    : "No time";
  const meetingUrl = safeUrl(b.meeting_url);
  const manageUrl = safeUrl(b.manage_url);
  const sd = b.service_details;

  const patch = async (body: Record<string, unknown>, done: string) => {
    setError(null);
    const res = await run(CAL_OP.update, { path, body }, { invalidate: INVALIDATE });
    if (res.ok) toast.success(done);
    else { setError(res.reason ?? "Zuops refused."); toast.error(res.reason ?? "Zuops refused."); }
    return res.ok;
  };

  const reschedule = async () => {
    if (!slot) return;
    setError(null);
    const res = await run(CAL_OP.reschedule, { path, body: { starts_at: slot } }, { invalidate: INVALIDATE });
    if (res.ok) {
      toast.success(notifies ? `Moved. ${name} gets the updated invite and their reminders move with it.` : "Moved quietly. The lead was not told.");
      setRescheduling(false);
      setSlot(null);
      return;
    }
    if (res.code === "slot_full") { setSlot(null); setReload((n) => n + 1); }
    setError(res.reason ?? "Zuops did not move it.");
  };

  const cancel = async () => {
    setError(null);
    const body = cancelReason.trim() ? { reason: cancelReason.trim() } : {};
    const res = await run(CAL_OP.cancel, { path, body }, { invalidate: INVALIDATE });
    if (res.ok) toast.success(notifies ? `Cancelled. ${name} gets the cancellation.` : "Cancelled quietly. The lead was not told.");
    else setError(res.reason ?? "Zuops did not cancel it.");
  };

  return (
    <>
      <SheetHeader className="space-y-2">
        <p className="overline">Appointment{b.appointment_number ? ` #${b.appointment_number}` : ""}</p>
        <SheetTitle>{b.title || "Appointment"}</SheetTitle>
        <SheetDescription>{when}</SheetDescription>
        <div className="flex flex-wrap items-center gap-2">
          <BookingStatusBadge status={b.status} />
          {outcomeMissing(b, now) && <span className="text-xs text-caution">Outcome not recorded</span>}
        </div>
      </SheetHeader>
      <SheetBody className="space-y-6">
        {error && <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-2 text-sm text-critical">{error}</p>}

        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-steel">Lead</dt>
          <dd className="text-bone">
            {b.lead_id ? (
              <button type="button" className="inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-gold max-sm:min-h-11" onClick={() => onOpenLead(b.lead_id!)}>
                <UserRound className="size-3.5" aria-hidden />{leadName(b.lead_id) || "Open the lead"}
              </button>
            ) : "No lead linked"}
          </dd>
          <dt className="text-steel">Length</dt><dd className="text-bone">{lengthWord(mins) || "Unknown"}{b.is_arrival_window ? " (arrival window)" : ""}</dd>
          <dt className="text-steel">Calendar</dt><dd className="text-bone">{calendar?.name || "Not on a calendar"}</dd>
          <dt className="text-steel">Host</dt><dd className="text-bone">{b.host_user_id ? memberName(hostMember) : "Nobody"}</dd>
          <dt className="text-steel">Meeting</dt>
          <dd className="text-bone">
            {[meetingWord(b.meeting_type), b.location || b.meeting_location].filter(Boolean).join(" · ") || "Not set"}
            {meetingUrl && <> · <a href={meetingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">Join link<ExternalLink className="size-3" aria-hidden /></a></>}
          </dd>
          {sd && sd.total_cents != null && (
            <><dt className="text-steel">Service</dt><dd className="text-bone">{[typeof sd.option === "string" ? sd.option : sd.option?.name, money(sd.total_cents, sd.currency ?? "USD")].filter(Boolean).join(" · ")}</dd></>
          )}
          <dt className="text-steel">Lead time zone</dt><dd className="text-bone">{b.lead_timezone || b.timezone || "Unknown"}</dd>
          {manageUrl && (
            <><dt className="text-steel">Lead&apos;s page</dt><dd><a href={manageUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-bone underline-offset-2 hover:underline">Where they move or cancel it<ExternalLink className="size-3" aria-hidden /></a></dd></>
          )}
        </dl>

        <section aria-labelledby="ap-rem" className="flex items-start gap-3 rounded-md border border-graphite/50 p-3">
          <Switch
            id="ap-reminders" checked={notifies} disabled={pending || cancelled} aria-describedby="ap-rem-note"
            onCheckedChange={(v) => void patch({ notify_lead: v }, v ? "Reminders back on. Upcoming reminders are queued again." : "Reminders off for this appointment.")}
          />
          <div>
            <Label id="ap-rem" htmlFor="ap-reminders" className="text-sm text-bone">Lead gets reminders</Label>
            <p id="ap-rem-note" className="text-xs text-steel">
              {notifies
                ? "On: the lead gets reminder texts and invite updates, including for a reschedule or cancel."
                : "Off: no more reminder texts or invite updates go to the lead for this appointment."}
            </p>
          </div>
        </section>

        <section aria-labelledby="ap-outcome" className="space-y-2">
          <h3 id="ap-outcome" className="overline">Outcome</h3>
          <div className="flex flex-wrap gap-2">
            <WriteButton type="button" size="sm" variant="secondary" disabled={pending || b.status === "completed"} onClick={() => void patch({ status: "completed" }, "Marked completed")}>
              <CheckCircle2 className="size-4" aria-hidden />Completed
            </WriteButton>
            <WriteButton type="button" size="sm" variant="secondary" disabled={pending || b.status === "no_show"} onClick={() => void patch({ status: "no_show" }, "Marked no show")}>
              <UserX className="size-4" aria-hidden />No show
            </WriteButton>
            <WriteButton type="button" size="sm" variant="secondary" disabled={pending || b.status === "confirmed" || b.status === "scheduled"} onClick={() => void patch({ status: "confirmed" }, "Back to confirmed")}>
              <RotateCcw className="size-4" aria-hidden />Back to confirmed
            </WriteButton>
          </div>
          <p className="text-xs text-steel">No message goes to the lead. Completed and No show stop the remaining reminder texts; Back to confirmed turns them on again.</p>
        </section>

        {!cancelled && b.calendar_id && (
          <section aria-labelledby="ap-move" className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 id="ap-move" className="overline">Reschedule</h3>
              {!rescheduling && (
                <WriteButton type="button" size="sm" variant="secondary" onClick={() => setRescheduling(true)}>
                  <CalendarClock className="size-4" aria-hidden />Pick a new time
                </WriteButton>
              )}
            </div>
            {rescheduling && (
              <div className="space-y-3">
                <SlotPicker idPrefix="ap" calendarId={b.calendar_id} value={slot} onChange={setSlot} reload={reload} />
                <p className="text-xs text-steel">{notifies ? `${name} gets an updated invite and their reminder texts move to the new time.` : "This appointment is quiet: the lead is not told."}</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => { setRescheduling(false); setSlot(null); }}>Keep the time</Button>
                  <WriteButton type="button" size="sm" disabled={!slot || pending} onClick={reschedule}>
                    {slot ? `Move to ${dateTime(slot, b.timezone)}` : "Pick a time"}
                  </WriteButton>
                </div>
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="ap-edit" className="space-y-4">
          <h3 id="ap-edit" className="overline">Details</h3>
          <Field label="Host" htmlFor="ap-host" hint="No message goes to the lead for a host change.">
            <div className="flex gap-2">
              <Select value={host ?? b.host_user_id ?? NONE} onValueChange={setHost}>
                <SelectTrigger id="ap-host" className={TOUCH}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nobody</SelectItem>
                  {members.filter((m) => m.user_id).map((m) => <SelectItem key={m.user_id} value={m.user_id!}>{memberName(m)}</SelectItem>)}
                </SelectContent>
              </Select>
              <WriteButton type="button" variant="secondary" disabled={pending || host === null || host === (b.host_user_id ?? NONE)}
                onClick={async () => { if (await patch({ host_user_id: host === NONE ? null : host }, "Host changed")) setHost(null); }}>
                Save
              </WriteButton>
            </div>
          </Field>
          <Field label="Location" htmlFor="ap-location" hint="No message goes to the lead when you save it.">
            <div className="flex gap-2">
              <Input id="ap-location" className={TOUCH} maxLength={300} value={location ?? b.location ?? ""} onChange={(e) => setLocation(e.target.value)} />
              <WriteButton type="button" variant="secondary" disabled={pending || location === null || location === (b.location ?? "")}
                onClick={async () => { if (await patch({ location: location?.trim() ? location.trim() : null }, "Location saved")) setLocation(null); }}>
                Save
              </WriteButton>
            </div>
          </Field>
          <div className="space-y-1.5">
            <Label htmlFor="ap-notes">Notes (internal)</Label>
            <Textarea id="ap-notes" maxLength={2000} value={notes ?? b.notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex items-center justify-between gap-2">
              <p className="text-[0.6875rem] text-steel/70">Only your team sees notes.</p>
              <WriteButton type="button" size="sm" variant="secondary" disabled={pending || notes === null || notes === (b.notes ?? "")}
                onClick={async () => { if (await patch({ notes: notes?.trim() ? notes.trim() : null }, "Notes saved")) setNotes(null); }}>
                Save notes
              </WriteButton>
            </div>
          </div>
        </section>

        {!cancelled && (
          <section aria-labelledby="ap-cancel" className="space-y-2 rounded-lg border border-critical/30 p-4">
            <h3 id="ap-cancel" className="text-sm font-semibold text-bone">Cancel the appointment</h3>
            <Label htmlFor="ap-cancel-reason">Reason (optional)</Label>
            <Input id="ap-cancel-reason" className={TOUCH} value={cancelReason} maxLength={300} onChange={(e) => setCancelReason(e.target.value)} />
            <p className="text-xs text-steel">{notifies ? `${name} is told it was cancelled, and their reminders stop.` : "This appointment is quiet: the lead is not told."}</p>
            <div className="flex justify-end">
              <WriteButton type="button" variant="danger" size="sm" disabled={pending} onClick={cancel}>
                <XCircle className="size-4" aria-hidden />Cancel appointment
              </WriteButton>
            </div>
          </section>
        )}
      </SheetBody>
    </>
  );
}
