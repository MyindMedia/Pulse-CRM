"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Ban, CalendarPlus, CheckCircle2, History, MailX, MessageSquare, PhoneOff, Plus, Trophy, X, XCircle,
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
import { newIdem, useZuRead, useZuWrite } from "./use-zu";
import { useCrmNav } from "./crm-context";
import {
  ConfirmDialog, StageBadge, TOUCH, WriteButton, ZuErrorState, dateTime, money, phone, relTime,
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
  return lead.stage ?? lead.stage_key ?? null;
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
}: {
  leadId: string | null;
  onClose: () => void;
  onOpenInbox?: (leadId: string) => void;
  onBook?: (leadId: string) => void;
}) {
  return (
    <Sheet open={!!leadId} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent width="lg">
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
  const [noteIdem, setNoteIdem] = React.useState(() => newIdem());
  const [wonOpen, setWonOpen] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const l = lead.data?.lead;
  const stageList = React.useMemo(
    () => [...(stages.data?.stages ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [stages.data],
  );

  if (lead.error && !l) {
    return (
      <>
        <SheetHeader><SheetTitle>Lead</SheetTitle></SheetHeader>
        <SheetBody><ZuErrorState error={lead.error} onRetry={lead.refresh} /></SheetBody>
      </>
    );
  }
  if (!l) {
    return (
      <>
        <SheetHeader><SheetTitle>Loading lead</SheetTitle><SheetDescription>Reading it from Zuops.</SheetDescription></SheetHeader>
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
  const byBehavior = (b: string): Stage | undefined => stageList.find((s) => (s.behavior ?? s.key) === b);
  const events: TimelineEvent[] = (fullTimeline && timeline.data?.events) || lead.data?.events || [];
  const activeFields = (fields.data?.custom_fields ?? []).filter((f) => !f.archived_at).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const save = async (body: Record<string, unknown>, done: string) => {
    setSaveError(null);
    const res = await run(OP.leadUpdate, { path, body }, { invalidate: INVALIDATE });
    if (res.ok) {
      toast.success(done);
      setDraft({});
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
    const lost = byBehavior("lost");
    void save(lost ? { stage_key: lost.key } : { status: "lost" }, "Marked lost in Zuops");
  };

  const addNote = async () => {
    const text = note.trim();
    if (!text) return;
    const res = await run(OP.leadNote, { path, body: { body: text }, idem: noteIdem }, { invalidate: [OP.leadGet, OP.leadTimeline] });
    if (res.ok) {
      toast.success("Note added in Zuops");
      setNote("");
      setNoteIdem(newIdem());
    } else {
      toast.error(res.reason ?? "Zuops refused the note.");
    }
  };

  const name = l.full_name || l.email || phone(l.phone) || "Unnamed lead";
  const openInbox = onOpenInbox ?? nav.openInbox;
  const book = onBook ?? nav.openCalendar;

  return (
    <>
      <SheetHeader className="space-y-3">
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
          <div className="flex flex-wrap gap-2">
            {l.email_opt_out && <Badge tone="caution"><MailX className="size-3" aria-hidden />Email opted out</Badge>}
            {l.email_invalid && <Badge tone="caution"><MailX className="size-3" aria-hidden />Email invalid</Badge>}
            {l.phone_invalid && <Badge tone="caution"><PhoneOff className="size-3" aria-hidden />Phone invalid</Badge>}
            {l.existing_customer && <Badge tone="info"><CheckCircle2 className="size-3" aria-hidden />Existing customer</Badge>}
          </div>
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
                      className="grid size-5 place-items-center rounded-sm outline-none hover:bg-coal-3 focus-visible:ring-2 focus-visible:ring-gold/40 max-sm:size-8">
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
              if (res.ok) toast.success("Marked do not contact in Zuops");
              else toast.error(res.reason ?? "Zuops refused.");
            }}
            trigger={<WriteButton type="button" variant="danger" size="sm"><Ban className="size-4" aria-hidden />Do not contact</WriteButton>}
          />
        </section>
      </SheetBody>

      <SheetFooter className="flex-wrap justify-end">
        {saveError && <p role="alert" className="mr-auto text-sm text-critical">{saveError}</p>}
        <span className="mr-auto text-xs text-steel" aria-live="polite">{changes ? `${changes} change${changes === 1 ? "" : "s"} not saved` : "No changes"}</span>
        <Button type="button" variant="ghost" className={TOUCH} onClick={() => { setDraft({}); setSaveError(null); }} disabled={!changes}>Discard</Button>
        <WriteButton type="button" onClick={() => void save(patch, "Saved in Zuops")} disabled={!changes || dealInvalid || pending}>
          {pending ? "Saving" : "Save to Zuops"}
        </WriteButton>
      </SheetFooter>

      <WonDialog
        open={wonOpen} onOpenChange={setWonOpen} pending={pending}
        initialDollars={l.deal_value_cents != null ? (l.deal_value_cents / 100).toFixed(l.deal_value_cents % 100 ? 2 : 0) : ""}
        currency={l.deal_currency || "USD"}
        onSave={async (cents) => {
          const won = byBehavior("won");
          const ok = await save({ ...(won ? { stage_key: won.key } : { status: "won" }), deal_value_cents: cents }, "Marked won in Zuops");
          if (ok) setWonOpen(false);
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
        id={id} type={inputType} className={TOUCH} value={type === "datetime" ? shown.slice(0, 16) : shown}
        placeholder={field.placeholder ?? undefined}
        onChange={(e) => {
          const raw = e.target.value;
          if (numeric) onChange(raw === "" ? null : Number(raw));
          else if (type === "datetime") onChange(raw ? new Date(raw).toISOString() : null);
          else onChange(raw);
        }}
      />
    </Field>
  );
}

function WonDialog({
  open, onOpenChange, initialDollars, currency, onSave, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialDollars: string;
  currency: string;
  onSave: (cents: number | null) => void | Promise<void>;
  pending: boolean;
}) {
  const [amount, setAmount] = React.useState<string | null>(null);
  const text = amount ?? initialDollars;
  const cents = dollarsToCents(text);
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setAmount(null); }}>
      <DialogContent size="sm">
        <form onSubmit={(e) => { e.preventDefault(); if (cents !== undefined) void onSave(cents); }}>
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
