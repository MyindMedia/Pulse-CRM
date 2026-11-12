"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarDays, CircleCheck, CircleSlash, Clock, Plus, Settings, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TOUCH, ConfirmDialog, WriteButton, ZuErrorState, confirmCopy, dateTime, type ConfirmGrant } from "./crm-ui";
import { newIdem, useIdemFor, useZuRead, useZuWrite, type ZuError } from "./use-zu";
import { CAL_OP } from "./calendar-ops";
import { bookingsWindow, busyByMember, busyRange, hoursSummary, keyStartMs, lengthWord, timeIn, todayKey } from "./calendar-logic";
import { useNow } from "./inbox-clock";
import type { BusyBlock, BusyBlocksResponse, Calendar, HoursResponse } from "./calendar-types";
import type { Member } from "./zu-types";
import { memberName } from "./calendar-appointment-sheet";

/* Calendars and hours: each booking calendar at a glance, team busy blocks (add
   and remove), and business hours read only. Editing calendars and hours lives in
   the Settings and Functions tabs. */

function EditInSettings() {
  return (
    <a href="#settings" className="inline-flex items-center gap-1 rounded-sm text-xs text-info underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-gold max-sm:min-h-11">
      <Settings className="size-3.5" aria-hidden />Edit in Settings
    </a>
  );
}

export function CalendarsSection({ calendars, error, loading, onRetry }: { calendars: Calendar[]; error: ZuError | null; loading: boolean; onRetry: () => void }) {
  return (
    <section aria-labelledby="cal-list-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cal-list-h" className="font-grotesk text-base font-semibold text-bone">Booking calendars</h2>
        <EditInSettings />
      </div>
      {error && !calendars.length ? <ZuErrorState error={error} onRetry={onRetry} />
        : loading ? <Skeleton className="h-24 w-full" />
          : calendars.length === 0 ? <EmptyState icon={CalendarDays} title="No calendars yet" description="Create a booking calendar in Settings." />
            : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {calendars.map((c) => (
                  <li key={c.id} className="space-y-1.5 rounded-lg border border-graphite/50 bg-coal/40 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 font-semibold text-bone">{c.name || c.title || "Calendar"}</p>
                      {c.is_active === false
                        ? <Badge><CircleSlash className="size-3" aria-hidden />Off</Badge>
                        : <Badge tone="positive"><CircleCheck className="size-3" aria-hidden />Active</Badge>}
                    </div>
                    <p className="text-steel">
                      {c.summary?.length_label || lengthWord(c.duration_minutes) || "Length not set"}
                      {` · ${c.buffer_minutes ? `${c.buffer_minutes} min buffer` : "No buffer"}`}
                      {c.timezone ? ` · ${c.timezone}` : ""}
                    </p>
                    <p className="text-steel">{hoursSummary(c.weekly_hours)}</p>
                    {c.booking_path && <p className="break-all font-mono text-xs text-steel">Booking link: {c.booking_path}</p>}
                  </li>
                ))}
              </ul>
            )}
    </section>
  );
}

export function BusinessHoursSection() {
  const hours = useZuRead<HoursResponse>(CAL_OP.hours, undefined, { pollMs: 300_000 });
  const a = hours.data?.availability;
  return (
    <section aria-labelledby="cal-hours-h" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cal-hours-h" className="font-grotesk text-base font-semibold text-bone">Business hours</h2>
        <EditInSettings />
      </div>
      {hours.error && !hours.data ? <ZuErrorState error={hours.error} onRetry={hours.refresh} />
        : hours.loading ? <Skeleton className="h-12 w-full" />
          : !a ? <p className="text-sm text-steel">Business hours are not set in Zuops.</p>
            : (
              <div className="space-y-1 rounded-lg border border-graphite/50 bg-coal/40 p-3 text-sm">
                <p className="flex items-center gap-1.5 text-bone"><Clock className="size-4 text-steel" aria-hidden />{hoursSummary(a.weekly_hours)}</p>
                <p className="text-steel">
                  {[a.timezone, a.slot_minutes ? `${a.slot_minutes} min slots` : null, a.buffer_minutes ? `${a.buffer_minutes} min buffer` : null, hours.data?.configured === false ? "Not configured yet" : null].filter(Boolean).join(" · ")}
                </p>
                {(a.date_overrides ?? []).length > 0 && <p className="text-steel">{(a.date_overrides ?? []).length} special days or days off</p>}
              </div>
            )}
    </section>
  );
}

export function BusyBlocksSection({ members }: { members: Member[] }) {
  // The window moves with the day (F-U14), but only once a day, so the query
  // does not change on every tick.
  const today = todayKey(useNow(60_000));
  const win = React.useMemo(() => {
    const start = keyStartMs(today);
    return { from: new Date(start - 86_400_000).toISOString(), to: bookingsWindow(start).to };
  }, [today]);
  const blocks = useZuRead<BusyBlocksResponse>(CAL_OP.busyBlocks, { query: { from: win.from, to: win.to, limit: 500 } }, { kinds: ["booking"], pollMs: 300_000 });
  const { run, pending } = useZuWrite();
  // The block's external id is made when the form opens and kept until Zuops
  // accepts it, so a retry after a network error updates the same block instead
  // of adding a second one (F-U11). Null while the form is closed.
  const [externalId, setExternalId] = React.useState<string | null>(null);
  const adding = externalId !== null;
  const [form, setForm] = React.useState({ member: "", start: "", end: "", title: "" });
  const putKey = useIdemFor(`busy-put:${externalId ?? ""}:${form.member}|${form.start}|${form.end}|${form.title.trim()}`);
  const [error, setError] = React.useState<string | null>(null);
  const list = blocks.data?.busy_blocks ?? [];
  const groups = busyByMember(list);
  const people = members.filter((m) => m.user_id || m.email);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.member) { setError("Pick the team member."); return; }
    const r = busyRange(form.start, form.end);
    if (!r.ok) { setError(r.reason); return; }
    const body: Record<string, unknown> = { team_member: form.member, starts_at: r.starts_at, ends_at: r.ends_at };
    if (form.title.trim()) body.title = form.title.trim();
    if (!externalId) return;
    const res = await run(CAL_OP.busyPut, { path: { external_id: externalId }, body, idem: putKey }, { invalidate: [CAL_OP.busyBlocks, CAL_OP.availability] });
    if (res.ok) {
      toast.success("Busy time added. Booking pages, the AI and round robin skip it.");
      setForm({ member: "", start: "", end: "", title: "" });
      setExternalId(null);
      setError(null);
    } else setError(res.reason ?? "Zuops refused.");
  };


  return (
    <section aria-labelledby="cal-busy-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cal-busy-h" className="font-grotesk text-base font-semibold text-bone">Team busy times</h2>
        {!adding && <WriteButton type="button" size="sm" variant="secondary" onClick={() => setExternalId(newIdem())}><Plus className="size-4" aria-hidden />Add busy time</WriteButton>}
      </div>
      <p className="text-xs text-steel">Times a team member is away or on another job. Leads never see the note.</p>

      {adding && (
        <form onSubmit={add} className="space-y-3 rounded-lg border border-graphite/50 bg-coal/40 p-3" noValidate>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Team member" htmlFor="busy-member">
              <Select value={form.member || undefined} onValueChange={(v) => setForm((f) => ({ ...f, member: v }))}>
                <SelectTrigger id="busy-member" className={TOUCH}><SelectValue placeholder="Pick a person" /></SelectTrigger>
                <SelectContent>
                  {people.map((m) => <SelectItem key={m.id} value={(m.user_id || m.email)!}>{memberName(m)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Note for the team (optional)" htmlFor="busy-title">
              <Input id="busy-title" className={TOUCH} maxLength={200} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </Field>
            <Field label="Starts (your time)" htmlFor="busy-start">
              <Input id="busy-start" type="datetime-local" className={TOUCH} value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} />
            </Field>
            <Field label="Ends (your time)" htmlFor="busy-end">
              <Input id="busy-end" type="datetime-local" className={TOUCH} value={form.end} onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} />
            </Field>
          </div>
          {error && <p role="alert" className="text-sm text-critical">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => { setExternalId(null); setError(null); }}>Cancel</Button>
            <WriteButton type="submit" size="sm" disabled={pending}>Add busy time</WriteButton>
          </div>
        </form>
      )}

      {blocks.error && !blocks.data ? <ZuErrorState error={blocks.error} onRetry={blocks.refresh} />
        : blocks.loading ? <Skeleton className="h-16 w-full" />
          : groups.length === 0 ? <p className="rounded-md border border-dashed border-graphite/60 p-3 text-sm text-steel">No busy times in the next 60 days.</p>
            : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g.key} className="space-y-1.5">
                    <h3 className="text-sm font-semibold text-bone">{g.name}</h3>
                    <ul className="divide-y divide-graphite/40 rounded-lg border border-graphite/50">
                      {g.blocks.map((b) => (
                        <BusyRow key={`${g.key}-${b.external_id}`} block={b} />
                      ))}
                    </ul>
                  </div>
                ))}
                {blocks.data?.has_more && <p className="text-xs text-steel">More busy times exist than shown here.</p>}
              </div>
            )}
    </section>
  );
}

function BusyRow({ block: b }: { block: BusyBlock }) {
  const { run } = useZuWrite();
  const idem = useIdemFor(`busy-delete:${b.external_id}`);
  const remove = async (grant: ConfirmGrant) => {
    const res = await run(CAL_OP.busyDelete, { path: { external_id: b.external_id }, idem, ...grant }, { invalidate: [CAL_OP.busyBlocks, CAL_OP.availability] });
    if (res.ok) toast.success("Busy time removed. That time can be booked again.");
    else toast.error(res.reason ?? "Zuops refused.");
  };
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block break-words text-bone">{dateTime(b.starts_at)} to {b.ends_at && b.starts_at && b.ends_at.slice(0, 10) === b.starts_at.slice(0, 10) ? timeIn(Date.parse(b.ends_at)) : dateTime(b.ends_at)}</span>
        {b.title && <span className="block break-words text-xs text-steel">{b.title}</span>}
      </span>
      <ConfirmDialog
        title="Remove this busy time?"
        body={<>The time opens up again at once for booking pages, the AI and round robin. {confirmCopy("delete")}</>}
        confirmLabel="Remove"
        destructive
        onConfirm={remove}
        trigger={<WriteButton type="button" size="sm" variant="ghost" aria-label={`Remove busy time ${dateTime(b.starts_at)}`}><Trash2 className="size-4" aria-hidden />Remove</WriteButton>}
      />
    </li>
  );
}
