"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, ExternalLink, RotateCcw, UserRound, UserX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label, Textarea } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/toggle";
import { ConfirmDialog, TOUCH, WriteButton, confirmCopy, dateTime, money, type ConfirmGrant } from "./crm-ui";
import { useIdemFor, useZuRead, useZuWrite } from "./use-zu";
import { writeFingerprint } from "./inbox-logic";
import { nameFromLead } from "./calendar-lead-names";
import { safeUrl } from "./inbox-logic";
import { useNow } from "./inbox-clock";
import { CAL_OP } from "./calendar-ops";
import { BookingStatusBadge, SlotPicker } from "./calendar-parts";
import { lengthWord, meetingWord, minutesBetween, outcomeMissing, timeIn } from "./calendar-logic";
import type { Booking, Calendar } from "./calendar-types";
import type { LeadResponse, Member } from "./zu-types";

/* One appointment: details, outcome, reschedule, cancel, host, location, notes and
   whether the lead gets reminders. Every control says whether the lead hears
   about it. */

const INVALIDATE = [CAL_OP.bookings, CAL_OP.availability] as const;
const NONE = "__none";

/** What the lead receives when the appointment moves (R3-I1). */
export function rescheduleNotice(name: string, notifies: boolean): string {
  return notifies
    ? `${name} gets the new time: an updated invite, and their reminder texts move with it.`
    : `Reminders are off for this appointment, so ${name} is not told.`;
}

/** What the lead receives when the appointment is cancelled (R3-I1). */
export function cancelNotice(name: string, notifies: boolean): string {
  return notifies
    ? `${name} gets a cancellation, and their reminder texts stop.`
    : `Reminders are off for this appointment, so ${name} is not told. Their reminders stop.`;
}

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
  const [remindersConfirm, setRemindersConfirm] = React.useState(false);
  // Bumped after each accepted write: the next action gets a fresh key, a retry
  // of the same action with the same values reuses its key (F-U9).
  const [round, setRound] = React.useState(0);
  const path = { booking_id: b.id };
  // The exact bodies each control sends; keys come from them (R3-I6).
  const bodies = {
    remindersOn: { notify_lead: true },
    remindersOff: { notify_lead: false },
    completed: { status: "completed" },
    noShow: { status: "no_show" },
    confirmed: { status: "confirmed" },
    host: { host_user_id: host === NONE ? null : host },
    location: { location: location?.trim() ? location.trim() : null },
    notes: { notes: notes?.trim() ? notes.trim() : null },
    reschedule: { starts_at: slot },
    cancel: cancelReason.trim() ? { reason: cancelReason.trim() } : {},
  };
  const fp = (op: string, body: unknown) => writeFingerprint(op, path, body, round);
  const keys = {
    remindersOn: useIdemFor(fp(CAL_OP.update, bodies.remindersOn)),
    remindersOff: useIdemFor(fp(CAL_OP.update, bodies.remindersOff)),
    completed: useIdemFor(fp(CAL_OP.update, bodies.completed)),
    noShow: useIdemFor(fp(CAL_OP.update, bodies.noShow)),
    confirmed: useIdemFor(fp(CAL_OP.update, bodies.confirmed)),
    host: useIdemFor(fp(CAL_OP.update, bodies.host)),
    location: useIdemFor(fp(CAL_OP.update, bodies.location)),
    notes: useIdemFor(fp(CAL_OP.update, bodies.notes)),
    reschedule: useIdemFor(fp(CAL_OP.reschedule, bodies.reschedule)),
    cancel: useIdemFor(fp(CAL_OP.cancel, bodies.cancel)),
  };
  // A lead outside the first page of names is read when its appointment opens.
  const known = b.lead_id ? leadName(b.lead_id) : null;
  const leadRead = useZuRead<LeadResponse>(CAL_OP.lead, { path: { lead_id: b.lead_id ?? "" } }, { enabled: !!b.lead_id && !known, pollMs: 0 });
  const resolved = known ?? nameFromLead(leadRead.data?.lead);
  const name = resolved || "the lead";
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

  const patch = async (body: Record<string, unknown>, idem: string, done: string, grant?: ConfirmGrant) => {
    setError(null);
    const res = await run(CAL_OP.update, { path, body, idem, ...grant }, { invalidate: INVALIDATE });
    if (res.ok) { toast.success(done); setRound((r) => r + 1); }
    else { setError(res.reason ?? "Zuops refused."); toast.error(res.reason ?? "Zuops refused."); }
    return res.ok;
  };

  const reschedule = async (grant: ConfirmGrant) => {
    if (!slot) return;
    setError(null);
    const res = await run(CAL_OP.reschedule, { path, body: bodies.reschedule, idem: keys.reschedule, ...grant }, { invalidate: INVALIDATE });
    if (res.ok) {
      setRound((r) => r + 1);
      toast.success(notifies ? `Moved. ${name} gets the updated invite and their reminders move with it.` : "Moved quietly. The lead was not told.");
      setRescheduling(false);
      setSlot(null);
      return;
    }
    if (res.code === "slot_full") { setSlot(null); setReload((n) => n + 1); }
    setError(res.reason ?? "Zuops did not move it.");
  };

  const cancel = async (grant: ConfirmGrant) => {
    setError(null);
    const res = await run(CAL_OP.cancel, { path, body: bodies.cancel, idem: keys.cancel, ...grant }, { invalidate: INVALIDATE });
    if (res.ok) setRound((r) => r + 1);
    if (res.ok) toast.success(notifies ? `Cancelled. ${name} gets the cancellation.` : "Cancelled quietly. The lead was not told.");
    else setError(res.reason ?? "Zuops did not cancel it.");
  };

  return (
    <>
      <SheetHeader className="space-y-2">
        <p className="overline">Appointment{b.appointment_number ? ` #${b.appointment_number}` : ""}</p>
        <SheetTitle className="break-words">{b.title || "Appointment"}</SheetTitle>
        <SheetDescription>{when}</SheetDescription>
        <div className="flex flex-wrap items-center gap-2">
          <BookingStatusBadge status={b.status} />
          {outcomeMissing(b, now) && <span className="text-xs text-caution">Outcome not recorded</span>}
        </div>
      </SheetHeader>
      <SheetBody className="space-y-6">
        {error && <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-2 text-sm text-critical">{error}</p>}

        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm [&_dd]:min-w-0 [&_dd]:break-words">
          <dt className="text-steel">Lead</dt>
          <dd className="text-bone">
            {b.lead_id ? (
              <button type="button" className="inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-gold max-sm:min-h-11" onClick={() => onOpenLead(b.lead_id!)}>
                <UserRound className="size-3.5" aria-hidden />{resolved || (leadRead.loading ? "Loading the lead" : "Open the lead")}
              </button>
            ) : "No lead linked"}
          </dd>
          <dt className="text-steel">Length</dt><dd className="text-bone">{lengthWord(mins) || "Unknown"}{b.is_arrival_window ? " (arrival window)" : ""}</dd>
          <dt className="text-steel">Calendar</dt><dd className="text-bone">{calendar?.name || "Not on a calendar"}</dd>
          <dt className="text-steel">Host</dt><dd className="text-bone">{b.host_user_id ? memberName(hostMember) : "Nobody"}</dd>
          <dt className="text-steel">Meeting</dt>
          <dd className="text-bone [overflow-wrap:anywhere]">
            {[meetingWord(b.meeting_type), b.location || b.meeting_location].filter(Boolean).join(" · ") || "Not set"}
            {meetingUrl && <> · <a href={meetingUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline-offset-2 hover:underline max-sm:min-h-11">Join link<ExternalLink className="size-3" aria-hidden /></a></>}
          </dd>
          {sd && sd.total_cents != null && (
            <><dt className="text-steel">Service</dt><dd className="text-bone">{[typeof sd.option === "string" ? sd.option : sd.option?.name, money(sd.total_cents, sd.currency ?? "USD")].filter(Boolean).join(" · ")}</dd></>
          )}
          <dt className="text-steel">Lead time zone</dt><dd className="text-bone">{b.lead_timezone || b.timezone || "Unknown"}</dd>
          {manageUrl && (
            <><dt className="text-steel">Lead&apos;s page</dt><dd><a href={manageUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-bone underline-offset-2 hover:underline max-sm:min-h-11">Where they move or cancel it<ExternalLink className="size-3" aria-hidden /></a></dd></>
          )}
        </dl>

        <section aria-labelledby="ap-rem" className="flex items-start gap-3 rounded-md border border-graphite/50 p-3">
          <Switch
            id="ap-reminders" checked={notifies} disabled={pending || cancelled} aria-describedby="ap-rem-note"
            onCheckedChange={(v) => {
              // Turning reminders on restarts automatic texts, so it confirms first;
              // turning them off is one click (F-U6).
              if (v) setRemindersConfirm(true);
              else void patch(bodies.remindersOff, keys.remindersOff, "Reminders off for this appointment.");
            }}
          />
          <ConfirmDialog
            open={remindersConfirm}
            onOpenChange={setRemindersConfirm}
            title={`Turn reminders back on for ${name}?`}
            body={<>{name} gets the upcoming reminder texts for {when}, and invite updates for any change. {confirmCopy("changes_sending")}</>}
            confirmLabel="Turn reminders on"
            onConfirm={(grant) => patch(bodies.remindersOn, keys.remindersOn, "Reminders back on. Upcoming reminders are queued again.", grant)}
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
            <WriteButton type="button" size="sm" variant="secondary" disabled={pending || b.status === "completed"} onClick={() => void patch(bodies.completed, keys.completed, "Marked completed")}>
              <CheckCircle2 className="size-4" aria-hidden />Completed
            </WriteButton>
            <WriteButton type="button" size="sm" variant="secondary" disabled={pending || b.status === "no_show"} onClick={() => void patch(bodies.noShow, keys.noShow, "Marked no show")}>
              <UserX className="size-4" aria-hidden />No show
            </WriteButton>
            <ConfirmDialog
              title={`Put ${name}'s appointment back to confirmed?`}
              body={<>The remaining reminder texts to {name} for {when} start again. {confirmCopy("changes_sending")}</>}
              confirmLabel="Back to confirmed"
              onConfirm={(grant) => patch(bodies.confirmed, keys.confirmed, "Back to confirmed", grant)}
              trigger={
                <WriteButton type="button" size="sm" variant="secondary" disabled={pending || b.status === "confirmed" || b.status === "scheduled"}>
                  <RotateCcw className="size-4" aria-hidden />Back to confirmed
                </WriteButton>
              }
            />
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
                  <ConfirmDialog
                    title={`Move ${name}'s appointment to ${slot ? dateTime(slot, b.timezone) : "the new time"}?`}
                    body={<>{rescheduleNotice(name, notifies)} {confirmCopy("reaches")}</>}
                    confirmLabel="Move it"
                    onConfirm={reschedule}
                    trigger={
                      <WriteButton type="button" size="sm" disabled={!slot || pending}>
                        {slot ? `Move to ${dateTime(slot, b.timezone)}` : "Pick a time"}
                      </WriteButton>
                    }
                  />
                </div>
              </div>
            )}
          </section>
        )}

        <section aria-labelledby="ap-edit" className="space-y-4">
          <h3 id="ap-edit" className="overline">Details</h3>
          <Field label="Host" htmlFor="ap-host" hint="No message goes to the lead for a host change.">
            <div className="flex min-w-0 gap-2">
              <Select value={host ?? b.host_user_id ?? NONE} onValueChange={setHost}>
                <SelectTrigger id="ap-host" className={TOUCH}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Nobody</SelectItem>
                  {members.filter((m) => m.user_id).map((m) => <SelectItem key={m.user_id} value={m.user_id!}>{memberName(m)}</SelectItem>)}
                </SelectContent>
              </Select>
              <WriteButton type="button" variant="secondary" disabled={pending || host === null || host === (b.host_user_id ?? NONE)}
                onClick={async () => { if (await patch(bodies.host, keys.host, "Host changed")) setHost(null); }}>
                Save
              </WriteButton>
            </div>
          </Field>
          <Field label="Location" htmlFor="ap-location" hint="No message goes to the lead when you save it.">
            <div className="flex min-w-0 gap-2">
              <Input id="ap-location" className={`min-w-0 ${TOUCH}`} maxLength={300} value={location ?? b.location ?? ""} onChange={(e) => setLocation(e.target.value)} />
              <WriteButton type="button" variant="secondary" disabled={pending || location === null || location === (b.location ?? "")}
                onClick={async () => { if (await patch(bodies.location, keys.location, "Location saved")) setLocation(null); }}>
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
                onClick={async () => { if (await patch(bodies.notes, keys.notes, "Notes saved")) setNotes(null); }}>
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
              <ConfirmDialog
                title={`Cancel ${name}'s appointment on ${when}?`}
                body={<>{cancelNotice(name, notifies)} {confirmCopy("reaches")}</>}
                confirmLabel="Cancel appointment"
                cancelLabel="Keep it"
                destructive
                onConfirm={cancel}
                trigger={
                  <WriteButton type="button" variant="danger" size="sm" disabled={pending}>
                    <XCircle className="size-4" aria-hidden />Cancel appointment
                  </WriteButton>
                }
              />
            </div>
          </section>
        )}
      </SheetBody>
    </>
  );
}
