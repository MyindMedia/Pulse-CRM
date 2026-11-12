"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarPlus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Label } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { TOUCH, WriteButton, dateTime, money, phone } from "./crm-ui";
import { useIdemFor, useZuRead, useZuWrite } from "./use-zu";
import { CAL_OP } from "./calendar-ops";
import { SlotPicker } from "./calendar-parts";
import { bookBody, calendarOptions, lengthWord, type BookForm } from "./calendar-logic";
import type { BookingResponse, Calendar } from "./calendar-types";
import type { LeadResponse, LeadsResponse } from "./zu-types";

/* Book an appointment: lead, calendar (with its option and add-ons when priced),
   an open time from availability, and whether the lead gets the confirmation and
   reminders. Booking notifies the lead by design (D12): one deliberate click,
   and the button says plainly what will happen. */

const INVALIDATE = [CAL_OP.bookings, CAL_OP.availability, CAL_OP.leads] as const;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function BookSheet({
  open,
  onOpenChange,
  initialLeadId,
  calendars,
  calendarsError,
  leadName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialLeadId: string | null;
  calendars: Calendar[];
  calendarsError?: string | null;
  leadName: (id: string) => string | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="lg">
        {open && (
          <BookBody
            key={initialLeadId ?? "none"} initialLeadId={initialLeadId} calendars={calendars}
            calendarsError={calendarsError} leadName={leadName} onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function BookBody({
  initialLeadId, calendars, calendarsError, leadName, onDone,
}: {
  initialLeadId: string | null;
  calendars: Calendar[];
  calendarsError?: string | null;
  leadName: (id: string) => string | null;
  onDone: () => void;
}) {
  const active = calendars.filter((c) => c.is_active !== false);
  const [raw, setForm] = React.useState<BookForm>(() => ({
    leadId: initialLeadId, calendarId: null, optionId: null, addonIds: [], slot: null, notify: true,
  }));
  // With one active calendar it is picked for you, also when calendars load late.
  const form: BookForm = { ...raw, calendarId: raw.calendarId ?? (active.length === 1 ? active[0].id : null) };
  const [pickedName, setPickedName] = React.useState<string | null>(null);
  const [term, setTerm] = React.useState("");
  const search = useDebounced(term.trim(), 300);
  const [error, setError] = React.useState<string | null>(null);
  const [reload, setReload] = React.useState(0);
  const [round, setRound] = React.useState(0);
  const { run, pending } = useZuWrite();

  const set = (patch: Partial<BookForm>) => { setForm((f) => ({ ...f, ...patch })); setError(null); };
  const calendar = active.find((c) => c.id === form.calendarId) ?? null;
  const { options, addons, needsOption } = calendarOptions(calendar);

  const knownName = form.leadId ? pickedName ?? leadName(form.leadId) : null;
  const leadRead = useZuRead<LeadResponse>(CAL_OP.lead, { path: { lead_id: form.leadId ?? "" } }, { enabled: !!form.leadId && !knownName, pollMs: 0 });
  const shownName = knownName ?? leadRead.data?.lead?.full_name ?? leadRead.data?.lead?.email ?? (form.leadId ? "Loading the lead" : null);
  const results = useZuRead<LeadsResponse>(CAL_OP.leads, { query: { search, limit: 8 } }, { enabled: !form.leadId && search.length >= 2, pollMs: 0, keepPrevious: true });

  const built = bookBody(form, calendar);
  // One key per distinct booking; retrying the same booking reuses it, and a new
  // one starts after a booking succeeds (F-U9).
  const idem = useIdemFor(`book:${round}:${"body" in built ? JSON.stringify(built.body) : "incomplete"}`);
  const book = async () => {
    if ("error" in built) { setError(built.error); return; }
    const res = await run(CAL_OP.book, { body: built.body, idem }, { invalidate: INVALIDATE });
    if (res.ok) {
      const warning = (res.data as BookingResponse | undefined)?.warning;
      toast.success(`Booked ${shownName ?? "the lead"} for ${dateTime(form.slot, calendar?.timezone)}.${form.notify ? " Zuops is sending the confirmation." : " Booked quietly: nothing was sent."}`);
      if (warning) toast.warning(warning);
      setRound((r) => r + 1);
      onDone();
      return;
    }
    if (res.code === "slot_full") {
      set({ slot: null });
      setReload((n) => n + 1);
    }
    setError(res.reason ?? "Zuops did not book it.");
  };

  return (
    <>
      <SheetHeader>
        <p className="overline">Calendar</p>
        <SheetTitle>Book an appointment</SheetTitle>
        <SheetDescription>Pick the lead, the calendar and an open time. Zuops checks the time is still free when you book.</SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-6">
        <section aria-labelledby="bk-lead-h" className="space-y-2">
          <h3 id="bk-lead-h" className="overline">Lead</h3>
          {form.leadId ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-bone">{shownName}</p>
              <Button type="button" size="sm" variant="ghost" className={TOUCH} onClick={() => { set({ leadId: null }); setPickedName(null); }}>
                <X className="size-4" aria-hidden />Change
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="bk-lead-search">Find a lead</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" aria-hidden />
                <Input id="bk-lead-search" type="search" className={cn("pl-9", TOUCH)} value={term} placeholder="Name, email or phone" onChange={(e) => setTerm(e.target.value)} />
              </div>
              {search.length >= 2 && (
                results.error ? <p role="alert" className="text-sm text-critical">{results.error.reason}</p>
                  : results.loading ? <p className="text-sm text-steel">Searching Zuops</p>
                    : (results.data?.leads ?? []).length === 0 ? <p className="text-sm text-steel">No leads match.</p>
                      : (
                        <ul className="divide-y divide-graphite/40 rounded-md border border-graphite/50" aria-label="Matching leads">
                          {(results.data?.leads ?? []).map((l) => {
                            const n = l.full_name || l.email || phone(l.phone) || "Unnamed lead";
                            return (
                              <li key={l.id}>
                                <button type="button" onClick={() => { set({ leadId: l.id }); setPickedName(n); }}
                                  className="block w-full px-3 py-2 text-left text-sm outline-none hover:bg-coal-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/40 max-sm:min-h-11">
                                  <span className="block font-medium text-bone">{n}</span>
                                  <span className="block text-xs text-steel">{[l.email, phone(l.phone)].filter(Boolean).join(" · ")}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="bk-cal-h" className="space-y-3">
          <h3 id="bk-cal-h" className="overline">Calendar</h3>
          {calendarsError ? <p role="alert" className="text-sm text-critical">{calendarsError}</p> : active.length === 0 ? (
            <p className="text-sm text-steel">No active calendars in Zuops. Add one in Settings.</p>
          ) : (
            <Field label="Calendar" htmlFor="bk-cal">
              <Select value={form.calendarId ?? undefined} onValueChange={(v) => set({ calendarId: v, optionId: null, addonIds: [], slot: null })}>
                <SelectTrigger id="bk-cal" className={TOUCH}><SelectValue placeholder="Pick a calendar" /></SelectTrigger>
                <SelectContent>
                  {active.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name || c.title || "Calendar"}{c.summary?.length_label ? ` · ${c.summary.length_label}` : c.duration_minutes ? ` · ${lengthWord(c.duration_minutes)}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {needsOption && (
            <Field label={calendar?.pricing?.options_label || "Option"} htmlFor="bk-option" hint="This calendar is priced: the option sets the length and the price.">
              <Select value={form.optionId ?? undefined} onValueChange={(v) => set({ optionId: v, slot: null })}>
                <SelectTrigger id="bk-option" className={TOUCH}><SelectValue placeholder="Pick one" /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}{o.price_cents != null ? ` · ${money(o.price_cents, calendar?.currency ?? "USD")}` : ""}{o.duration_minutes ? ` · ${lengthWord(o.duration_minutes)}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {needsOption && addons.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-xs font-medium text-steel">{calendar?.pricing?.addons_label || "Add-ons"} (optional)</legend>
              {addons.map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <Checkbox id={`bk-addon-${a.id}`} checked={form.addonIds.includes(a.id)}
                    onCheckedChange={(v) => set({ addonIds: v === true ? [...form.addonIds, a.id] : form.addonIds.filter((x) => x !== a.id), slot: null })} />
                  <Label htmlFor={`bk-addon-${a.id}`} className="text-sm text-bone">
                    {a.name}{a.price_cents != null ? ` · ${money(a.price_cents, calendar?.currency ?? "USD")}` : ""}{a.extra_minutes ? ` · +${lengthWord(a.extra_minutes)}` : ""}
                  </Label>
                </div>
              ))}
            </fieldset>
          )}
        </section>

        {calendar && (!needsOption || form.optionId) && (
          <section aria-labelledby="bk-slots-h" className="space-y-2">
            <h3 id="bk-slots-h" className="overline">Open times</h3>
            <SlotPicker
              key={`${calendar.id}|${form.optionId ?? ""}|${form.addonIds.join(",")}`}
              idPrefix="bk" calendarId={calendar.id} optionId={form.optionId} addonIds={form.addonIds}
              value={form.slot} onChange={(slot) => set({ slot })} reload={reload}
            />
          </section>
        )}

        <div className="space-y-1.5 rounded-md border border-graphite/50 p-3">
          <div className="flex items-start gap-2.5">
            <Checkbox id="bk-notify" className="mt-0.5" checked={form.notify} onCheckedChange={(v) => set({ notify: v === true })} />
            <Label htmlFor="bk-notify" className="text-sm text-bone">Send the lead the confirmation and reminders</Label>
          </div>
          <p className="pl-6.5 text-xs text-steel">
            {form.notify
              ? "The lead gets the confirmation email with a calendar invite, plus the confirmation and reminder texts."
              : "Books quietly: the lead gets no confirmation, reminders or invite, and later changes stay quiet too. Your team still gets the booking alert."}
          </p>
        </div>
        {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      </SheetBody>
      <SheetFooter className="flex-wrap justify-end">
        {"error" in built && <p role="status" className="mr-auto text-xs text-steel">{built.error}</p>}
        {"body" in built && form.slot && calendar && (
          <p className="mr-auto text-xs text-steel">
            {shownName ?? "The lead"} on {dateTime(form.slot, calendar.timezone)}.{form.notify ? " The lead will be notified." : " The lead will not be notified."}
          </p>
        )}
        <Button type="button" variant="ghost" className={TOUCH} onClick={onDone}>Cancel</Button>
        <WriteButton type="button" onClick={book} disabled={pending || "error" in built}>
          <CalendarPlus className="size-4" aria-hidden />{pending ? "Booking" : form.notify ? "Book and notify the lead" : "Book quietly"}
        </WriteButton>
      </SheetFooter>
    </>
  );
}
