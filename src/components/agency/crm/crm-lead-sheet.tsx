"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Ban, CalendarPlus, CheckCircle2, CircleHelp, History, MailX, MessageSquare, PauseCircle, PhoneOff, Plus, Trophy, X, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Label, Textarea } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/toggle";
import { OP } from "./ops";
import { stableStringify, useIdemFor, useZuRead, useZuWrite } from "./use-zu";
import { useCrmNav } from "./crm-context";
import {
  ConfirmDialog, StageBadge, TOUCH, WriteButton, ZuErrorState, dateTime, money, phone, relTime, useReturnFocus,
} from "./crm-ui";
import type {
  CustomField, CustomFieldsResponse, Lead, LeadResponse, Stage, StagesResponse, TimelineEvent, TimelineResponse,
} from "./zu-types";

/* One lead: contact block with the full phone and email (owner and admin only,
   design D7), stage, tags, deal, custom fields, notes, do-not-contact and the
   timeline. Edits collect into a draft and Save sends only what changed. */

const READ_KINDS: Array<"lead" | "message" | "booking" | "call"> = ["lead", "message", "booking", "call"];
const INVALIDATE = [OP.leadGet, OP.leadsList, OP.leadTimeline] as const;

export type LeadDraft = {
  full_name?: string;
  email?: string;
  phone?: string;
  inquiry?: string;
  stage_key?: string;
  /** Deal value as typed, in dollars. */
  deal?: string;
  custom?: Record<string, unknown>;
  addTags?: string[];
  removeTags?: string[];
};

export function currentStageKey(lead: Lead): string | null {
  return lead.stage_key ?? lead.stage ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO time -> the value a `datetime-local` input shows, in this browser's
 *  time zone (F-U16). "" for nothing or an unreadable value. */
export function isoToLocalInput(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value (local wall time) -> an ISO time, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The exact bodies the sheet sends; each Idempotency-Key is derived from the
 *  body about to go out (R3-U3), so a retry only reuses a key for the same body. */
export function lostBody(stages: Stage[]): Record<string, unknown> {
  const lost = stages.find((s) => (s.behavior ?? s.key) === "lost");
  return lost ? { stage_key: lost.key } : { status: "lost" };
}

export function wonBody(stages: Stage[], cents: number | null): Record<string, unknown> {
  const won = stages.find((s) => (s.behavior ?? s.key) === "won");
  return { ...(won ? { stage_key: won.key } : { status: "won" }), deal_value_cents: cents };
}

export function noteBody(text: string): { body: string } {
  return { body: text.trim() };
}

/** Notes added in this sheet, shown at the top of the timeline at once (R3-U2)
 *  until the refetched timeline carries them. */
export function withLocalNotes(events: TimelineEvent[], local: TimelineEvent[]): TimelineEvent[] {
  const ids = new Set(events.map((e) => e.id));
  const bodies = new Set(events.filter((e) => /note/i.test(e.event_type ?? "")).map((e) => (e.body ?? "").trim()));
  const pending = local.filter((n) => !ids.has(n.id) && !bodies.has((n.body ?? "").trim()));
  return newestFirst([...pending, ...events]);
}

/** The timeline reads newest first (R4-U1), whatever order an answer arrives in,
 *  so a note added here sits at the top before and after the re-read. The sort
 *  is stable: events with the same time, or none, keep the order Zuops sent. */
export function newestFirst(events: TimelineEvent[]): TimelineEvent[] {
  const at = (e: TimelineEvent) => {
    const t = e.created_at ? Date.parse(e.created_at) : NaN;
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...events].sort((a, b) => at(b) - at(a));
}

/** The timeline entry for a note Zuops just accepted: its answer when it has an
 *  id, otherwise what was sent. */
export function noteEvent(answer: unknown, text: string, idem: string, now: number = Date.now()): TimelineEvent {
  const a = (answer && typeof answer === "object" ? answer : {}) as Record<string, unknown>;
  const inner = [a.note, a.event, a.data, a].find((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string") as
    | (TimelineEvent & Record<string, unknown>)
    | undefined;
  return {
    id: inner?.id ?? `local-note-${idem}`,
    event_type: (typeof inner?.event_type === "string" && inner.event_type) || "note",
    actor_label: (typeof inner?.actor_label === "string" && inner.actor_label) || "You",
    body: (typeof inner?.body === "string" && inner.body) || text.trim(),
    created_at: (typeof inner?.created_at === "string" && inner.created_at) || new Date(now).toISOString(),
  };
}

export type Reachability = { label: string; state: "bad" | "ok" | "unknown"; word: string; detail?: string };

/** What Zuops reports about reaching this lead: four flags and their reasons.
 *  Zuops has no text opt-out or do-not-contact field on a lead, so neither is
 *  shown here (F-U2). A flag missing from the answer reads "Not reported". */
export function reachability(l: Lead): Reachability[] {
  const row = (label: string, flag: boolean | null | undefined, bad: string, ok: string, reason?: string | null, at?: string | null): Reachability => {
    if (flag === undefined || flag === null) return { label, state: "unknown", word: "Not reported" };
    if (!flag) return { label, state: "ok", word: ok };
    const parts = [reason?.trim(), at ? `since ${dateTime(at)}` : null].filter(Boolean);
    return { label, state: "bad", word: bad, detail: parts.length ? parts.join(", ") : undefined };
  };
  return [
    row("Email opt-out", l.email_opt_out, "Opted out of email", "Not opted out", l.email_opt_out_reason, l.email_opt_out_at),
    row("Email address", l.email_invalid, "Invalid", "No problem reported", l.email_invalid_reason, l.email_invalid_at),
    row("Email sending", l.email_paused, "Paused", "Not paused"),
    row("Phone number", l.phone_invalid, "Invalid", "No problem reported", l.phone_invalid_reason, l.phone_invalid_at),
  ];
}

/** Dollars as typed -> cents. "" -> null; anything unreadable -> undefined. */
export function dollarsToCents(text: string): number | null | undefined {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return undefined;
  return Math.round(parseFloat(t) * 100);
}

function sameValue(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v);
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** The PATCH body for /v1/leads/{id}: only fields that differ from the lead. */
export function leadPatch(lead: Lead, draft: LeadDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["full_name", "email", "phone", "inquiry"] as const) {
    const v = draft[k];
    if (v === undefined) continue;
    const next = v.trim() === "" ? null : v.trim();
    if (!sameValue(next, lead[k] ?? null)) out[k] = next;
  }
  if (draft.stage_key !== undefined && draft.stage_key !== currentStageKey(lead)) out.stage_key = draft.stage_key;
  if (draft.deal !== undefined) {
    const cents = dollarsToCents(draft.deal);
    if (cents !== undefined && cents !== (lead.deal_value_cents ?? null)) out.deal_value_cents = cents;
  }
  if (draft.custom) {
    const changed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(draft.custom)) {
      if (!sameValue(v, lead.custom_fields?.[k] ?? null)) changed[k] = v === "" ? null : v;
    }
    if (Object.keys(changed).length) out.custom_fields = changed;
  }
  const has = new Set((lead.tags ?? []).map((t) => t.toLowerCase()));
  const add = [...new Set(draft.addTags ?? [])].filter((t) => !has.has(t.toLowerCase()));
  const remove = [...new Set(draft.removeTags ?? [])].filter((t) => has.has(t.toLowerCase()));
  if (add.length) out.add_tags = add;
  if (remove.length) out.remove_tags = remove;
  return out;
}

export function LeadSheet({
  leadId,
  onClose,
  onOpenInbox,
  onBook,
  returnFocus,
}: {
  leadId: string | null;
  onClose: () => void;
  onOpenInbox?: (leadId: string) => void;
  onBook?: (leadId: string) => void;
  /** The row or card control that opened the sheet; focus goes back to it on
   *  close (Escape, Close, overlay), F-V3. */
  returnFocus?: HTMLElement | null;
}) {
  // Escape, Close, overlay: focus goes back to the opener, or to its re-rendered
  // twin (same data-focus-key), or the tab panel (U-10).
  const onCloseAutoFocus = useReturnFocus(!!leadId, { returnTo: returnFocus });
  return (
    <Sheet open={!!leadId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        width="lg"
        // The shared Close button is 24 px; on a phone it gets a 44 px target (F-V5).
        className="max-sm:[&>[aria-label=Close]]:grid max-sm:[&>[aria-label=Close]]:size-11 max-sm:[&>[aria-label=Close]]:place-items-center"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {leadId && <LeadSheetBody key={leadId} leadId={leadId} onClose={onClose} onOpenInbox={onOpenInbox} onBook={onBook} />}
      </SheetContent>
    </Sheet>
  );
}

function eventLabel(t: string | null | undefined): string {
  if (!t) return "Event";
  const s = t.replace(/_/g, " ");
  return s[0].toUpperCase() + s.slice(1);
}

function LeadSheetBody({
  leadId, onClose, onOpenInbox, onBook,
}: {
  leadId: string;
  onClose: () => void;
  onOpenInbox?: (leadId: string) => void;
  onBook?: (leadId: string) => void;
}) {
  const nav = useCrmNav();
  const path = { lead_id: leadId };
  const lead = useZuRead<LeadResponse>(OP.leadGet, { path }, { kinds: READ_KINDS });
  const stages = useZuRead<StagesResponse>(OP.stagesList, undefined, { pollMs: 300_000 });
  const fields = useZuRead<CustomFieldsResponse>(OP.customFieldsList, undefined, { pollMs: 300_000 });
  const [fullTimeline, setFullTimeline] = React.useState(false);
  const timeline = useZuRead<TimelineResponse>(OP.leadTimeline, { path, query: { limit: 200 } }, { kinds: READ_KINDS, enabled: fullTimeline });

  const { run, pending } = useZuWrite();
  const [draft, setDraft] = React.useState<LeadDraft>({});
  const [tagInput, setTagInput] = React.useState("");
  const [note, setNote] = React.useState("");
  const [wonOpen, setWonOpen] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [dncDone, setDncDone] = React.useState(false);
  const [localNotes, setLocalNotes] = React.useState<TimelineEvent[]>([]);

  const l = lead.data?.lead;
  const stageList = React.useMemo(
    () => [...(stages.data?.stages ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [stages.data],
  );
  // Idempotency-Keys (F-U9, R3-U3): derived from the exact body about to be
  // sent, so an identical retry reuses its key and any other body gets another;
  // the round goes up after a success.
  const [rounds, setRounds] = React.useState({ note: 0, save: 0, lost: 0 });
  const bump = (k: keyof typeof rounds) => setRounds((r) => ({ ...r, [k]: r[k] + 1 }));
  const noteIdem = useIdemFor(`${rounds.note}|${stableStringify(noteBody(note))}`);
  const patchNow = l ? leadPatch(l, draft) : {};
  const saveIdem = useIdemFor(`${rounds.save}|${stableStringify(patchNow)}`);
  const lostNow = lostBody(stageList);
  const lostIdem = useIdemFor(`${rounds.lost}|${stableStringify(lostNow)}`);

  if (lead.error && !l) {
    return (
      <>
        <SheetHeader className="max-sm:pr-16"><SheetTitle>Lead</SheetTitle></SheetHeader>
        <SheetBody><ZuErrorState error={lead.error} onRetry={lead.refresh} /></SheetBody>
      </>
    );
  }
  if (!l) {
    return (
      <>
        <SheetHeader className="max-sm:pr-16"><SheetTitle>Loading lead</SheetTitle><SheetDescription>Reading it from Zuops.</SheetDescription></SheetHeader>
        <SheetBody aria-busy="true" className="space-y-3"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></SheetBody>
      </>
    );
  }

  const patch = leadPatch(l, draft);
  const changes = Object.keys(patch).length;
  const dealText = draft.deal ?? (l.deal_value_cents != null ? (l.deal_value_cents / 100).toFixed(l.deal_value_cents % 100 ? 2 : 0) : "");
  const dealInvalid = draft.deal !== undefined && dollarsToCents(draft.deal) === undefined;
  const shownTags = [
    ...(l.tags ?? []).filter((t) => !(draft.removeTags ?? []).includes(t)),
    ...(draft.addTags ?? []).filter((t) => !(l.tags ?? []).some((x) => x.toLowerCase() === t.toLowerCase())),
  ];
  const stageKey = draft.stage_key ?? currentStageKey(l) ?? "";
  const events: TimelineEvent[] = withLocalNotes((fullTimeline && timeline.data?.events) || lead.data?.events || [], localNotes);
  const activeFields = (fields.data?.custom_fields ?? []).filter((f) => !f.archived_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const save = async (body: Record<string, unknown>, done: string, idem: string, round?: keyof typeof rounds) => {
    setSaveError(null);
    const res = await run(OP.leadUpdate, { path, body, idem }, { invalidate: INVALIDATE });
    if (res.ok) {
      toast.success(done);
      setDraft({});
      if (round) bump(round);
      return true;
    }
    setSaveError(res.reason ?? "Zuops refused.");
    toast.error(res.reason ?? "Zuops refused.");
    return false;
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    setDraft((d) => ({ ...d, addTags: [...(d.addTags ?? []), t], removeTags: (d.removeTags ?? []).filter((x) => x !== t) }));
    setTagInput("");
  };
  const removeTag = (t: string) => {
    setDraft((d) => ({ ...d, addTags: (d.addTags ?? []).filter((x) => x !== t), removeTags: [...(d.removeTags ?? []), t] }));
  };

  const markLost = () => {
    void save(lostNow, "Marked lost in Zuops", lostIdem, "lost");
  };

  const addNote = async () => {
    const body = noteBody(note);
    if (!body.body) return;
    const idem = noteIdem;
    const res = await run(OP.leadNote, { path, body, idem }, { invalidate: [OP.leadGet, OP.leadTimeline] });
    if (res.ok) {
      // On screen at once; the re-read of the lead and timeline replaces it.
      setLocalNotes((n) => [noteEvent(res.data, body.body, idem), ...n]);
      toast.success("Note added in Zuops");
      setNote("");
      bump("note");
    } else {
      toast.error(res.reason ?? "Zuops refused the note.");
    }
  };

  const name = l.full_name || l.email || phone(l.phone) || "Unnamed lead";
  const openInbox = onOpenInbox ?? nav.openInbox;
  const book = onBook ?? nav.openCalendar;

  return (
    <>
      <SheetHeader className="space-y-3 max-sm:pr-16">
        <div>
          <p className="overline">Lead</p>
          <SheetTitle>{name}</SheetTitle>
          <SheetDescription>{l.inquiry || "No inquiry recorded"}</SheetDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className={TOUCH} onClick={() => { openInbox(leadId); onClose(); }}>
            <MessageSquare className="size-4" aria-hidden />Message
          </Button>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => { book(leadId); onClose(); }}>
            <CalendarPlus className="size-4" aria-hidden />Book
          </Button>
          <WriteButton type="button" variant="secondary" size="sm" onClick={() => setWonOpen(true)} disabled={pending}>
            <Trophy className="size-4" aria-hidden />Won
          </WriteButton>
          <WriteButton type="button" variant="secondary" size="sm" onClick={markLost} disabled={pending}>
            <XCircle className="size-4" aria-hidden />Lost
          </WriteButton>
        </div>
      </SheetHeader>

      <SheetBody className="space-y-6">
        {lead.error && <p role="alert" className="text-sm text-caution">Showing the last copy. {lead.error.reason}</p>}

        <section aria-labelledby="ls-contact" className="space-y-3">
          <h3 id="ls-contact" className="overline">Contact</h3>
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-steel">Email</dt>
            <dd className="break-all text-bone">{l.email ? <a className="underline-offset-2 hover:underline" href={`mailto:${l.email}`}>{l.email}</a> : "None"}</dd>
            <dt className="text-steel">Phone</dt>
            <dd className="tabular-nums text-bone">{l.phone ? <a className="underline-offset-2 hover:underline" href={`tel:${l.phone}`}>{phone(l.phone)}</a> : "None"}</dd>
            <dt className="text-steel">Address</dt>
            <dd className="text-bone">{[l.address, l.city, l.state, l.zip].filter(Boolean).join(", ") || "None"}</dd>
            <dt className="text-steel">Source</dt>
            <dd className="text-bone">{(l.source ?? "other").replace(/_/g, " ")}{l.campaign_name ? ` · ${l.campaign_name}` : ""}</dd>
            <dt className="text-steel">Stage</dt>
            <dd><StageBadge stage={currentStageKey(l)} stages={stageList} /></dd>
            <dt className="text-steel">Deal</dt>
            <dd className="tabular-nums text-bone">{money(l.deal_value_cents, l.deal_currency)}{l.deal_won_at ? ` · won ${relTime(l.deal_won_at)}` : ""}</dd>
            <dt className="text-steel">Added</dt>
            <dd className="text-bone">{dateTime(l.created_at)}</dd>
            <dt className="text-steel">Last activity</dt>
            <dd className="text-bone">{relTime(l.last_activity_at) || "None"}</dd>
          </dl>
          {l.existing_customer && <Badge tone="info"><CheckCircle2 className="size-3" aria-hidden />Existing customer</Badge>}
        </section>

        <section aria-labelledby="ls-reach" className="space-y-2">
          <h3 id="ls-reach" className="overline">Reaching this lead</h3>
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            {reachability(l).map((r) => {
              const Icon = r.state === "unknown" ? CircleHelp : r.state === "ok" ? CheckCircle2 : r.label === "Phone number" ? PhoneOff : r.label === "Email sending" ? PauseCircle : MailX;
              return (
                <React.Fragment key={r.label}>
                  <dt className="text-steel">{r.label}</dt>
                  <dd className={r.state === "bad" ? "text-caution" : r.state === "ok" ? "text-bone" : "text-steel"}>
                    <span className="inline-flex items-center gap-1.5"><Icon className="size-3.5 shrink-0" aria-hidden />{r.word}</span>
                    {r.detail && <span className="block text-xs text-steel">{r.detail}</span>}
                  </dd>
                </React.Fragment>
              );
            })}
          </dl>
        </section>

        <section aria-labelledby="ls-edit" className="space-y-4">
          <h3 id="ls-edit" className="overline">Details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="ls-name"><Input id="ls-name" className={TOUCH} value={draft.full_name ?? l.full_name ?? ""} onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))} /></Field>
            <Field label="Asked about" htmlFor="ls-inquiry"><Input id="ls-inquiry" className={TOUCH} value={draft.inquiry ?? l.inquiry ?? ""} onChange={(e) => setDraft((d) => ({ ...d, inquiry: e.target.value }))} /></Field>
            <Field label="Email" htmlFor="ls-email"><Input id="ls-email" type="email" className={TOUCH} value={draft.email ?? l.email ?? ""} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} /></Field>
            <Field label="Phone" htmlFor="ls-phone"><Input id="ls-phone" type="tel" className={TOUCH} value={draft.phone ?? l.phone ?? ""} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} /></Field>
            <Field label="Stage" htmlFor="ls-stage">
              <Select value={stageKey || undefined} onValueChange={(v) => setDraft((d) => ({ ...d, stage_key: v }))}>
                <SelectTrigger id="ls-stage" className={TOUCH}><SelectValue placeholder="No stage" /></SelectTrigger>
                <SelectContent>
                  {stageList.filter((s) => !s.hidden || s.key === stageKey).map((s) => <SelectItem key={s.id} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={`Deal value (${(l.deal_currency || "USD").toUpperCase()})`} htmlFor="ls-deal" hint={dealInvalid ? "Use a number like 1188 or 1188.50." : undefined}>
              <Input id="ls-deal" inputMode="decimal" className={TOUCH} value={dealText} aria-invalid={dealInvalid || undefined} onChange={(e) => setDraft((d) => ({ ...d, deal: e.target.value }))} />
            </Field>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ls-tag-input">Tags</Label>
            <ul className="flex flex-wrap gap-1.5" aria-label="Tags on this lead">
              {shownTags.length === 0 && <li className="text-sm text-steel/70">No tags</li>}
              {shownTags.map((t) => (
                <li key={t}>
                  <Badge className="pr-1">
                    {t}
                    <button type="button" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`}
                      className="grid size-5 place-items-center rounded-sm outline-none hover:bg-coal-3 focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:size-11">
                      <X className="size-3" aria-hidden />
                    </button>
                  </Badge>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Input id="ls-tag-input" className={TOUCH} value={tagInput} placeholder="Add a tag"
                onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }} />
              <Button type="button" variant="secondary" className={TOUCH} onClick={addTag} disabled={!tagInput.trim()}>
                <Plus className="size-4" aria-hidden />Add
              </Button>
            </div>
          </div>

          {fields.error ? (
            <p role="alert" className="text-sm text-caution">Custom fields did not load. {fields.error.reason}</p>
          ) : activeFields.length > 0 && (
            <div className="space-y-3">
              <h4 className="overline">Custom fields</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                {activeFields.map((f) => (
                  <CustomFieldInput
                    key={f.id} field={f}
                    value={draft.custom && f.field_key in draft.custom ? draft.custom[f.field_key] : l.custom_fields?.[f.field_key] ?? l.custom_fields?.[f.label] ?? null}
                    onChange={(v) => setDraft((d) => ({ ...d, custom: { ...(d.custom ?? {}), [f.field_key]: v } }))}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="ls-note" className="space-y-2">
          <h3 id="ls-note" className="overline">Add a note</h3>
          <Label htmlFor="ls-note-text" className="sr-only">Note</Label>
          <Textarea id="ls-note-text" value={note} maxLength={5000} placeholder="Only your team sees notes." onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end">
            <WriteButton type="button" variant="secondary" size="sm" onClick={addNote} disabled={!note.trim() || pending}>Add note</WriteButton>
          </div>
        </section>

        <section aria-labelledby="ls-timeline" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 id="ls-timeline" className="overline flex items-center gap-1.5"><History className="size-3.5" aria-hidden />Timeline</h3>
            {!fullTimeline && (lead.data?.events?.length ?? 0) >= 50 && (
              <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => setFullTimeline(true)}>Show older</Button>
            )}
          </div>
          {fullTimeline && timeline.error && <ZuErrorState error={timeline.error} onRetry={timeline.refresh} />}
          {fullTimeline && timeline.loading && <Skeleton className="h-20 w-full" />}
          {events.length === 0 ? <p className="text-sm text-steel">Nothing on the timeline yet.</p> : (
            <ol className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id} className="border-l-2 border-graphite/60 pl-3 text-sm">
                  <p className="text-ash">
                    <span className="font-medium text-bone">{eventLabel(ev.event_type)}</span>
                    {ev.actor_label ? ` · ${ev.actor_label}` : ""} · <time dateTime={ev.created_at ?? undefined}>{relTime(ev.created_at)}</time>
                  </p>
                  {ev.body && <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap break-words text-steel">{ev.body}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="ls-dnc" className="space-y-2 rounded-lg border border-critical/30 p-4">
          <h3 id="ls-dnc" className="text-sm font-semibold text-bone">Do not contact</h3>
          <p className="text-xs text-steel">No more emails, and texts to this number are blocked. Zuops has no undo for this.</p>
          <ConfirmDialog
            title="Stop all contact with this lead?"
            body={<>Zuops stops every email to {name} and blocks texts to their number. There is no undo.</>}
            confirmLabel="Do not contact"
            destructive
            onConfirm={async (grant) => {
              const res = await run(OP.leadDoNotContact, { path, ...grant }, { invalidate: INVALIDATE });
              if (res.ok) {
                setDncDone(true);
                toast.success("Marked do not contact in Zuops");
              } else toast.error(res.reason ?? "Zuops refused.");
            }}
            trigger={<WriteButton type="button" variant="danger" size="sm"><Ban className="size-4" aria-hidden />Do not contact</WriteButton>}
          />
          {dncDone && (
            <p role="status" className="flex items-center gap-1.5 text-sm text-bone"><CheckCircle2 className="size-4 text-positive" aria-hidden />Marked do not contact in Zuops</p>
          )}
          <p className="text-xs text-steel">Zuops does not report this back on the lead, so this screen cannot show whether it is already set.</p>
        </section>
      </SheetBody>

      <SheetFooter className="flex-wrap justify-end">
        {saveError && <p role="alert" className="mr-auto text-sm text-critical">{saveError}</p>}
        <span className="mr-auto text-xs text-steel" aria-live="polite">{changes ? `${changes} change${changes === 1 ? "" : "s"} not saved` : "No changes"}</span>
        <Button type="button" variant="ghost" className={TOUCH} onClick={() => { setDraft({}); setSaveError(null); }} disabled={!changes}>Discard</Button>
        <WriteButton type="button" onClick={() => void save(patch, "Saved in Zuops", saveIdem, "save")} disabled={!changes || dealInvalid || pending}>
          {pending ? "Saving" : "Save to Zuops"}
        </WriteButton>
      </SheetFooter>

      <WonDialog
        open={wonOpen} onOpenChange={setWonOpen} pending={pending}
        initialDollars={l.deal_value_cents != null ? (l.deal_value_cents / 100).toFixed(l.deal_value_cents % 100 ? 2 : 0) : ""}
        currency={l.deal_currency || "USD"}
        bodyFor={(cents) => wonBody(stageList, cents)}
        onSave={async (body, idem) => {
          const ok = await save(body, "Marked won in Zuops", idem);
          if (ok) setWonOpen(false);
          return ok;
        }}
      />
    </>
  );
}

function optionValues(f: CustomField): Array<{ value: string; label: string }> {
  return (f.options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value ?? o.label ?? "", label: o.label ?? o.value ?? "" })).filter((o) => o.value);
}

function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: unknown; onChange: (v: unknown) => void }) {
  const id = `cf-${field.field_key}`;
  const type = field.field_type ?? "text";
  const hint = field.helper_text ?? undefined;
  if (type === "boolean") {
    return (
      <div className="flex items-start gap-2.5 sm:col-span-2">
        <Checkbox id={id} className="mt-0.5" checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        <div>
          <Label htmlFor={id} className="text-sm text-bone">{field.label}</Label>
          {hint && <p className="text-[0.6875rem] text-steel/70">{hint}</p>}
        </div>
      </div>
    );
  }
  if (type === "select") {
    const opts = optionValues(field);
    return (
      <Field label={field.label} htmlFor={id} hint={hint}>
        <Select value={typeof value === "string" && value ? value : undefined} onValueChange={onChange}>
          <SelectTrigger id={id} className={TOUCH}><SelectValue placeholder="Not set" /></SelectTrigger>
          <SelectContent>{opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    );
  }
  if (type === "multiselect") {
    const opts = optionValues(field);
    const picked = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="space-y-1.5 sm:col-span-2">
        <legend className="text-xs font-medium text-steel">{field.label}</legend>
        <div className="flex flex-wrap gap-3">
          {opts.map((o) => (
            <span key={o.value} className="flex items-center gap-2">
              <Checkbox id={`${id}-${o.value}`} checked={picked.includes(o.value)}
                onCheckedChange={(v) => onChange(v === true ? [...picked, o.value] : picked.filter((x) => x !== o.value))} />
              <Label htmlFor={`${id}-${o.value}`} className="text-sm text-bone">{o.label}</Label>
            </span>
          ))}
        </div>
        {hint && <p className="text-[0.6875rem] text-steel/70">{hint}</p>}
      </fieldset>
    );
  }
  if (type === "textarea") {
    return (
      <Field label={field.label} htmlFor={id} hint={hint} className="sm:col-span-2">
        <Textarea id={id} value={typeof value === "string" ? value : ""} placeholder={field.placeholder ?? undefined} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  }
  const numeric = type === "number" || type === "money" || type === "rating";
  const inputType = numeric ? "number" : type === "date" ? "date" : type === "datetime" ? "datetime-local" : type === "email" ? "email" : type === "phone" ? "tel" : type === "url" ? "url" : "text";
  const shown = value === null || value === undefined ? "" : String(value);
  return (
    <Field label={field.label} htmlFor={id} hint={hint}>
      <Input
        id={id} type={inputType} className={TOUCH} value={type === "datetime" ? isoToLocalInput(value) : shown}
        placeholder={field.placeholder ?? undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (numeric) onChange(raw === "" ? null : Number(raw));
          else if (type === "datetime") onChange(localInputToIso(raw));
          else onChange(raw);
        }}
      />
    </Field>
  );
}

function WonDialog({
  open, onOpenChange, initialDollars, currency, bodyFor, onSave, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialDollars: string;
  currency: string;
  bodyFor: (cents: number | null) => Record<string, unknown>;
  onSave: (body: Record<string, unknown>, idem: string) => Promise<boolean>;
  pending: boolean;
}) {
  const [amount, setAmount] = React.useState<string | null>(null);
  const [round, setRound] = React.useState(0);
  const text = amount ?? initialDollars;
  const cents = dollarsToCents(text);
  const body = cents === undefined ? null : bodyFor(cents);
  const idem = useIdemFor(`${round}|${stableStringify(body)}`);
  const onCloseAutoFocus = useReturnFocus(open);
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setAmount(null); }}>
      <DialogContent size="sm" onCloseAutoFocus={onCloseAutoFocus}>
        <form onSubmit={async (e) => {
          e.preventDefault();
          if (!body) return;
          if (await onSave(body, idem)) setRound((n) => n + 1);
        }}>
          <DialogHeader>
            <DialogTitle>Mark this lead won</DialogTitle>
            <DialogDescription>What did the customer pay? It counts as Sold in the Zuops sales report.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={`Amount (${currency.toUpperCase()})`} htmlFor="won-amount" hint={cents === undefined ? "Use a number like 1188 or 1188.50." : undefined}>
              <Input id="won-amount" inputMode="decimal" autoFocus className={TOUCH} value={text} aria-invalid={cents === undefined || undefined} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" className={TOUCH} onClick={() => onOpenChange(false)}>Cancel</Button>
            <WriteButton type="submit" disabled={cents === undefined || pending}><Trophy className="size-4" aria-hidden />Mark won</WriteButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
