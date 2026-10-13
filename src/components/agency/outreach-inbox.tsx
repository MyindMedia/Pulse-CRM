"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle, ArrowDownLeft, ArrowLeft, ArrowUpRight, CalendarCheck01, CheckCircle, CheckSquare, ChevronDown, Clock, Edit05,
  Inbox01, MessageChatCircle, PhoneCall01, Plus, RefreshCw01, SearchMd, Trash01, Upload01, User01, Users01, XCircle,
} from "@untitledui/icons";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingPanel } from "@/components/ui/feedback";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { bareAddress, displayNameOf } from "@convex/mail/address";
import {
  FILTER_LABEL, INBOX_FILTERS, defaultOpen, hostName, initialsOf, latestOpenable, matchesFilter, matchesSearch,
  type BookingItem, type CallItem, type DmItem, type DraftItem, type EmailItem, type EventItem, type InboxFilter, type InboxRow, type TimelineItem,
} from "@convex/outreach/inbox";
import { Attachments, MessageBody } from "./email/thread-view";
import { Unauthorized, type Tone } from "./outreach-panels";

/* Outreach > Prospects, as an inbox: a compact list of studios on the left and,
   for the open studio, a reading pane with its contact card, the whole history
   (Gmail style: older items fold to one line, the newest is open), every
   per-studio action and the Prepare email form. Nothing here sends: Prepare
   email makes a draft for the Review queue, where Approve and Send live.
   Phone: the list only; a studio opens full width with Back (as the Email tab). */

type ListData = NonNullable<FunctionReturnType<typeof api.outreachInbox.list>>;
type Conversation = NonNullable<FunctionReturnType<typeof api.outreachInbox.conversation>>;
export type InboxProspect = Conversation["prospect"];
type Seq = NonNullable<InboxProspect["sequence"]>;
type ProspectId = Id<"outreachProspects">;

/* ------------------------------ vocabulary ------------------------------ */

export const PROSPECT_STATUS: Record<string, { tone: Tone; short: string; meaning: string }> = {
  needs_website: { tone: "caution", short: "needs website", meaning: "Waiting for you to confirm the studio's website. A guessed site is never used." },
  ready_to_scrape: { tone: "info", short: "ready to read", meaning: "Website confirmed. Ready to read its public pages." },
  scraping: { tone: "info", short: "reading site", meaning: "Reading the studio's public pages now." },
  scraped: { tone: "positive", short: "contact found", meaning: "Published contact info found. Not verified." },
  no_contact: { tone: "caution", short: "no email", meaning: "No published email on the pages read." },
  blocked: { tone: "critical", short: "blocked", meaning: "The site's robots.txt disallows reading it, or the address is not a public website." },
  unreachable: { tone: "caution", short: "unreachable", meaning: "The site could not be reached. Check the address, then try again." },
  queued: { tone: "positive", short: "queued", meaning: "In the review queue. Nothing has been sent." },
  suppressed: { tone: "caution", short: "opted out", meaning: "Every address has opted out. Will not be contacted." },
  replied: { tone: "positive", short: "replied", meaning: "The studio replied. Follow-ups stopped; MaxB can still reply in the thread." },
};

/* Jev's label for the studio's latest reply (convex/lib/jev/outreachReplies.ts). */
const REPLY_INTENT: Record<string, { text: string; tone: Tone }> = {
  interested: { text: "interested", tone: "positive" },
  not_now: { text: "not now", tone: "neutral" },
  unsubscribe: { text: "asked to stop", tone: "critical" },
  wrong_person: { text: "wrong person", tone: "caution" },
  question: { text: "has a question", tone: "info" },
  auto_reply: { text: "auto-reply", tone: "neutral" },
};

const intentText = (label: string) => REPLY_INTENT[label]?.text ?? label.replace(/_/g, " ");

function ReplyIntentBadge({ r }: { r: { label: string; probability: number | null; optedOut: boolean } }) {
  const ri = REPLY_INTENT[r.label] ?? { text: intentText(r.label), tone: "neutral" as Tone };
  const sure = r.probability === null ? "" : ` (${Math.round(r.probability * 100)}% sure)`;
  const outcome = r.optedOut ? " The address was opted out automatically." : " A label only: nothing was changed.";
  return <Badge tone={ri.tone} title={`Jev's read of the latest reply${sure}.${outcome}`}>{`reply: ${ri.text}`}</Badge>;
}

const STEP_NAME = ["Lawrence's first email", "MaxB day 3", "MaxB day 7", "MaxB day 14"];

function SequenceLine({ s }: { s: Pick<Seq, "step" | "status" | "nextDueAt" | "stoppedMeaning" | "pendingDraft"> }) {
  if (s.status === "stopped") return <p className="text-xs text-steel">Follow-ups stopped. {s.stoppedMeaning}</p>;
  if (s.status === "done") return <p className="text-xs text-steel">Follow-ups finished: all 3 MaxB follow-ups were sent.</p>;
  return (
    <p className="text-xs text-steel">
      Sent: {STEP_NAME[s.step] ?? `step ${s.step}`}.{" "}
      {s.pendingDraft
        ? `${STEP_NAME[s.step + 1] ?? "The next step"} is in the Review queue, waiting for approval.`
        : s.nextDueAt
          ? `${STEP_NAME[s.step + 1] ?? "Next step"} will be drafted for review ${new Date(s.nextDueAt).toLocaleDateString()}. Nothing sends without your approval and Send.`
          : ""}
    </p>
  );
}

const DELIVERY_TONE: Record<string, Tone> = {
  draft: "neutral", approved: "info", submitting: "info", sending: "info", accepted: "info", delivered: "positive",
  bounced: "critical", rejected: "critical", suppressed: "caution", unknown: "caution",
};
const DELIVERY_ICON: Record<Tone, typeof CheckCircle> = {
  positive: CheckCircle, critical: XCircle, caution: AlertTriangle, info: Clock, neutral: Clock,
};

/* --------------------------------- helpers --------------------------------- */

function shortWhen(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}
const fullWhen = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const isWebUrl = (u: string) => /^https?:\/\//i.test(u);

/** A plain reply gets a frame about as tall as its text; anything with images
 *  or tables keeps the standard frame (it scrolls inside). */
export function frameHeight(html: string | null, text: string | null): number | undefined {
  if (!html || !text || /<(img|table)\b/i.test(html)) return undefined;
  const lines = text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 70)), 0);
  return Math.min(420, Math.max(120, lines * 22 + 56));
}
const nameFrom = (from: string) => displayNameOf(from) ?? bareAddress(from) ?? from;

function cleanError(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^[\s\S]*Uncaught (Convex)?Error:?\s*/, "").slice(0, 200) : "Something went wrong.";
}

/** One status line per area: what the last action did, or why it failed. */
function useRun() {
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const run = React.useCallback(async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      return true;
    } catch (e) {
      setErr(cleanError(e));
      return false;
    }
  }, []);
  return { run, msg, err, setMsg };
}

function Feedback({ msg, err }: { msg: string | null; err: string | null }) {
  return (
    <>
      {msg && <p role="status" className="text-sm text-positive">{msg}</p>}
      {err && <p role="alert" className="text-sm text-critical">{err}</p>}
    </>
  );
}

function Avatar({ name, unread, size = "md" }: { name: string; unread?: boolean; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full bg-coal-2 font-meta font-semibold uppercase text-ash",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_1px_2px_rgba(0,0,0,0.5)]",
        size === "lg" ? "size-10 text-xs" : "size-8 text-[0.6875rem]",
      )}
    >
      {initialsOf(name)}
      {unread && <span className="pl-led absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-gold ring-2 ring-obsidian" data-on="true" />}
    </span>
  );
}

/* ---------------------------------- list ---------------------------------- */

function RowChip({ r }: { r: InboxRow }) {
  if (r.hasUnreadReply) return <Badge tone="gold">new reply</Badge>;
  if (r.optedOut) return <Badge tone="critical">opted out</Badge>;
  if (r.bookedAt) return <Badge tone="positive">booked</Badge>;
  if (r.replyIntent) return <Badge tone={REPLY_INTENT[r.replyIntent.label]?.tone ?? "neutral"}>{intentText(r.replyIntent.label)}</Badge>;
  if (r.replied) return <Badge tone="positive">replied</Badge>;
  if (r.status === "queued" && r.sequence) {
    const s = r.sequence.status;
    return <Badge tone={s === "active" ? "info" : "neutral"}>{s === "active" ? "emailed" : s === "done" ? "follow-ups done" : "follow-ups off"}</Badge>;
  }
  const st = PROSPECT_STATUS[r.status];
  return <Badge tone={st?.tone ?? "neutral"}>{st?.short ?? r.status.replace(/_/g, " ")}</Badge>;
}

function RowPreview({ r }: { r: InboxRow }) {
  const tone = r.hasUnreadReply ? "text-bone" : "text-steel";
  if (r.lastKind === "status") {
    return <span className="min-w-0 flex-1 truncate text-xs text-steel/70">{r.note ?? PROSPECT_STATUS[r.status]?.meaning ?? ""}</span>;
  }
  if (r.lastKind === "reply") {
    return (
      <span className={cn("flex min-w-0 flex-1 items-center gap-1 text-xs", tone)}>
        <ArrowDownLeft className="size-3 shrink-0" aria-hidden /> <span className="min-w-0 truncate">Studio replied</span>
      </span>
    );
  }
  const Icon = r.lastKind === "dm" ? MessageChatCircle : r.lastDirection === "in" ? ArrowDownLeft : ArrowUpRight;
  const label = r.lastKind === "dm" ? "Instagram DM: " : r.lastDirection === "in" ? "Received: " : "Sent: ";
  return (
    <span className={cn("flex min-w-0 flex-1 items-center gap-1 text-xs", tone)}>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="sr-only">{label}</span>
      <span className="min-w-0 truncate">{r.lastSnippet}</span>
    </span>
  );
}

function RowBody({ r }: { r: InboxRow }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-2">
        <span className={cn("min-w-0 flex-1 truncate text-sm", r.hasUnreadReply ? "font-semibold text-bone" : "font-medium text-ash")}>
          {r.name}
          {r.hasUnreadReply && <span className="sr-only">, unread reply</span>}
        </span>
        <time dateTime={new Date(r.lastActivityAt).toISOString()} className="shrink-0 text-[0.6875rem] tabular-nums text-steel/70">
          {shortWhen(r.lastActivityAt)}
        </time>
      </span>
      <span className="mt-1 flex items-center gap-2">
        <RowPreview r={r} />
        <span className="shrink-0"><RowChip r={r} /></span>
      </span>
    </span>
  );
}

const ROW_CLASS = "relative flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors duration-150 ease-out hover:bg-coal-2/50";

export function InboxListRow({ r, active, selecting, checked, onOpen, onCheck }: {
  r: InboxRow; active: boolean; selecting: boolean; checked: boolean; onOpen: (id: ProspectId) => void; onCheck: (id: ProspectId, on: boolean) => void;
}) {
  const activeClass = active && "bg-gold/10 shadow-[inset_2px_0_0_var(--color-gold)] hover:bg-gold/10";
  if (selecting) {
    return (
      <label className={cn(ROW_CLASS, "cursor-pointer", checked && "bg-coal-2/60")}>
        <span className="grid size-8 shrink-0 place-items-center">
          <input type="checkbox" checked={checked} onChange={(e) => onCheck(r.id, e.target.checked)} aria-label={`Select ${r.name}`} className="size-4 accent-[var(--color-gold)]" />
        </span>
        <RowBody r={r} />
      </label>
    );
  }
  return (
    <button type="button" data-row={r.id} onClick={() => onOpen(r.id)} aria-current={active ? "true" : undefined} className={cn(ROW_CLASS, activeClass)}>
      <Avatar name={r.name} unread={r.hasUnreadReply} />
      <RowBody r={r} />
    </button>
  );
}

/** Up and down arrows move between rows. */
function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-row]")];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

export function BulkRoutingBar({ selecting, count, onStart, onCancel, onConfirm }: {
  selecting: boolean; count: number; onStart: () => void; onCancel: () => void; onConfirm: () => void;
}) {
  if (!selecting) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-steel">
        <Button type="button" size="sm" variant="ghost" onClick={onStart}><CheckSquare aria-hidden /> Select</Button>
        <span className="min-w-0">Confirm routing for several studios at once.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-graphite/40 bg-coal/40 px-3 py-2 text-xs text-steel">
      <Button type="button" size="sm" variant="secondary" disabled={count === 0} onClick={onConfirm}>Confirm routing for selected ({count})</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Done</Button>
      <span className="basis-full">For studios whose generic inbox you checked. Clears the generic-inbox hold; it never approves an email.</span>
    </div>
  );
}

/* --------------------------------- dialogs --------------------------------- */

/** What Add studios does, in the owner's words. */
export function AddStudiosHelp() {
  return (
    <>
      Paste Instagram handles, Instagram links or websites, one per line. Contact info is what the studio published
      itself: on its website, its Google Maps listing, or (on request) its own Instagram profile. It is published, not
      verified. Nothing is emailed from here.
    </>
  );
}

/** What the CSV import touches, and what it never does. */
export function ImportCsvHelp() {
  return (
    <>
      Per-studio copy from outreach-staged.csv, matched by website: the studio name (optional studio_name column), the
      opening line, subject and body for Lawrence&apos;s email, MaxB&apos;s day 3, 7 and 14 follow-ups, and the Instagram DM.
      It updates studios already on the list and never adds one. Email addresses in the file are never imported as
      contacts. Up to 200 rows.
    </>
  );
}

type ImportReport = { matched: number; unmatched: number; skipped: number; draftsVoided: number; unmatchedWebsites: string[]; skippedRows: Array<{ line: number; reason: string }> };

export function AddStudiosDialog({ manage }: { manage: boolean }) {
  const add = useMutation(api.outreachProspects.add);
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const { run, msg, err, setMsg } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary" disabled={!manage}><Plus aria-hidden /> Add studios</Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add studios</DialogTitle>
          <DialogDescription><AddStudiosHelp /></DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <label htmlFor="prospect-lines" className="sr-only">Handles, links or websites</label>
          <textarea
            id="prospect-lines" value={text} onChange={(e) => setText(e.target.value)} rows={6} disabled={!manage}
            placeholder={"@icecreamsound\nhttps://instagram.com/mixrecordingstudio\nunionrecordingstudio.com"}
            className="w-full rounded border border-graphite/60 bg-obsidian px-3 py-2 text-sm text-bone placeholder:text-steel/50"
          />
          <Feedback msg={msg} err={err} />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button" size="sm" variant="primary" disabled={!manage || text.trim() === ""}
            onClick={() => void run(async () => {
              const r = await add({ lines: text.split("\n") });
              setText("");
              setMsg(`${r.added} added, ${r.duplicates} already on the list, ${r.invalid} not recognised.`);
            })}
          >
            Add to list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ImportCsvDialog() {
  const importCsv = useMutation(api.outreachProspects.importCsv);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const { run, err } = useRun();
  return (
    <Dialog onOpenChange={(o) => { if (!o) setReport(null); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary"><Upload01 aria-hidden /> Import outreach CSV</Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Import outreach CSV</DialogTitle>
          <DialogDescription><ImportCsvHelp /></DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2 text-sm">
          <label htmlFor="import-csv" className="text-steel">Choose the CSV file</label>
          <input
            id="import-csv" type="file" accept=".csv,text/csv" className="block max-w-full text-xs text-steel"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setReport(null);
              void run(async () => setReport(await importCsv({ csv: await file.text() })));
            }}
          />
          {report && (
            <div role="status" className="space-y-1 text-xs text-steel">
              <p className="text-bone">{report.matched} matched, {report.unmatched} not on the list, {report.skipped} skipped.{report.draftsVoided > 0 ? ` ${report.draftsVoided} open draft(s) used the old copy and were voided.` : ""}</p>
              {report.unmatchedWebsites.length > 0 && <p className="break-words">Not on the list: {report.unmatchedWebsites.join(", ")}</p>}
              {report.skippedRows.length > 0 && <p className="break-words">Skipped: {report.skippedRows.map((s) => `line ${s.line} (${s.reason})`).join(", ")}</p>}
            </div>
          )}
          <Feedback msg={null} err={err} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ reading pane ------------------------------ */

type SigMode = "original" | "static" | "image" | "animated";
export type Prep = { email?: string; sig?: SigMode; routing?: boolean; persona?: "lawrence" | "maxb"; hook?: string; subject?: string; body?: string };
type PrepareArgs = {
  prospectId: ProspectId; email: string; persona: "lawrence" | "maxb"; templateKey: string; observation?: string;
  subjectOverride?: string; bodyOverride?: string; signatureMode: SigMode; routingConfirmed: boolean;
};

/** The Prepare email form, unchanged from the old card: Lawrence writes first,
 *  MaxB replies in his thread. It prepares a draft; it never sends. */
export function PrepareEmailForm({ p, cur, onChange, onPrepare }: {
  p: Pick<InboxProspect, "id" | "name" | "hook" | "hookSourceUrl" | "subjectDefault" | "bodyDefault" | "routingConfirmed" | "contacts" | "sequence">;
  cur: Prep; onChange: (patch: Prep) => void; onPrepare: (args: PrepareArgs) => void;
}) {
  const seq = p.sequence;
  const open = (p.contacts?.emails ?? []).filter((e) => !e.suppressed);
  const persona = cur.persona ?? (seq ? "maxb" : "lawrence");
  const lawrence = persona === "lawrence";
  const chosen = lawrence ? open.find((e) => e.address === (cur.email ?? open[0]?.address)) : open.find((e) => e.address === seq?.recipient);
  const hook = cur.hook ?? p.hook ?? "";
  const subject = cur.subject ?? p.subjectDefault ?? "";
  const body = cur.body ?? (lawrence ? p.bodyDefault ?? "" : "");
  const field = "w-full min-w-0 rounded border border-graphite/60 bg-obsidian px-2 py-1.5 text-bone";
  const select = "w-full min-w-0 rounded border border-graphite/60 bg-obsidian px-2 py-1.5 text-bone sm:w-auto sm:max-w-full";
  return (
    <div className="space-y-2 p-3 text-xs">
      <p className="font-meta uppercase tracking-wide text-steel/70">Prepare the email</p>
      <p className="text-steel">
        {lawrence
          ? "The first email to a studio comes from Lawrence. If it is sent, MaxB's follow-ups are drafted for your review on day 3, 7 and 14."
          : "MaxB replies in Lawrence's thread, to the address Lawrence wrote to."}
      </p>
      <div className="grid grid-cols-1 items-center gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
        <label htmlFor={`from-${p.id}`} className="text-steel">From</label>
        <select id={`from-${p.id}`} value={persona} onChange={(e) => onChange({ persona: e.target.value as "lawrence" | "maxb" })} className={select}>
          <option value="lawrence" disabled={!!seq}>Lawrence Berment (first email)</option>
          <option value="maxb" disabled={!seq}>MaxB | Pulse (reply in the thread)</option>
        </select>
        <label htmlFor={`to-${p.id}`} className="text-steel">To</label>
        {lawrence ? (
          <select id={`to-${p.id}`} value={chosen?.address ?? ""} onChange={(e) => onChange({ email: e.target.value })} className={select}>
            {open.map((e) => <option key={e.address} value={e.address}>{e.address}</option>)}
          </select>
        ) : (
          <span id={`to-${p.id}`} className="break-all text-bone">{seq?.recipient}</span>
        )}
        <label htmlFor={`sig-${p.id}`} className="text-steel">Signature</label>
        <select id={`sig-${p.id}`} value={cur.sig ?? "image"} onChange={(e) => onChange({ sig: e.target.value as SigMode })} className={select}>
          <option value="image">Exact picture of your Final signature (recommended)</option>
          <option value="animated">Animated GIF (needs the site deployed first)</option>
          <option value="original">Your HTML file as-is (breaks in Gmail)</option>
          <option value="static">Email-safe rebuild</option>
        </select>
      </div>
      {lawrence && (
        <>
          <label htmlFor={`hook-${p.id}`} className="block text-steel">Opening line (required: one true, specific line about this studio)</label>
          <input id={`hook-${p.id}`} value={hook} onChange={(e) => onChange({ hook: e.target.value })} className={field}
            placeholder="Saw you just opened a second live room in Silver Lake." />
          {p.hookSourceUrl && <p className="break-all text-steel/60">Source: {p.hookSourceUrl}</p>}
          <label htmlFor={`subject-${p.id}`} className="block text-steel">Subject (optional)</label>
          <input id={`subject-${p.id}`} value={subject} onChange={(e) => onChange({ subject: e.target.value })} className={field}
            placeholder={`A question about running ${p.name ?? "the studio"}`} />
        </>
      )}
      <label htmlFor={`body-${p.id}`} className="block text-steel">Body (optional: replaces only the middle paragraphs; the greeting, offer, demo link, footer and opt-out stay)</label>
      <textarea id={`body-${p.id}`} value={body} onChange={(e) => onChange({ body: e.target.value })} rows={4} className={field}
        placeholder="Leave blank for the standard copy. Blank line between paragraphs." />
      {lawrence && chosen?.generic && !p.routingConfirmed && (
        <label className="flex items-start gap-2 text-steel">
          <input type="checkbox" checked={!!cur.routing} onChange={(e) => onChange({ routing: e.target.checked })} className="mt-0.5" />
          <span>This is a generic inbox. I have confirmed who handles studio operations.</span>
        </label>
      )}
      <Button
        type="button" size="sm" variant="secondary"
        disabled={!chosen || (lawrence && !hook.trim())}
        onClick={() => onPrepare({
          prospectId: p.id, email: chosen!.address, persona,
          templateKey: lawrence ? "lawrence_first" : "maxb_reply",
          observation: lawrence ? hook : undefined,
          subjectOverride: lawrence && subject.trim() ? subject : undefined,
          bodyOverride: body.trim() ? body : undefined,
          signatureMode: cur.sig ?? "image", routingConfirmed: !!cur.routing,
        })}
      >
        Prepare email
      </Button>
      {lawrence && !hook.trim() && <p className="text-steel/70">Add an opening line to prepare Lawrence&apos;s email.</p>}
    </div>
  );
}

/** The full contacts block, opened by the "Contact info" toggle. */
export function ContactDetails({ p, manage, onOptOut, onConfirmRouting }: {
  p: InboxProspect; manage: boolean; onOptOut: (email: string) => void; onConfirmRouting: () => void;
}) {
  const c = p.contacts;
  const generic = c?.emails.some((e) => e.generic) ?? false;
  return (
    <div className="space-y-3 text-xs">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="font-meta uppercase tracking-wide text-steel/70">Website</dt>
          <dd className="mt-0.5 break-all text-bone">
            {p.websiteUrl && isWebUrl(p.websiteUrl)
              ? <a href={p.websiteUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-graphite underline-offset-2 hover:decoration-gold">{p.host ?? p.websiteUrl}</a>
              : "No website yet"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="font-meta uppercase tracking-wide text-steel/70">Instagram</dt>
          <dd className="mt-0.5 break-all text-bone">{p.handle ? `@${p.handle}` : "No handle"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="font-meta uppercase tracking-wide text-steel/70">Added</dt>
          <dd className="mt-0.5 text-bone">
            {new Date(p.createdAt).toLocaleDateString()} via {p.source}
            {p.priority ? ` · priority ${p.priority}` : ""}{p.fitScore !== null ? ` · fit ${p.fitScore}` : ""}
          </dd>
        </div>
      </dl>
      {c ? (
        <div className="grid grid-cols-1 gap-3 rounded-md border border-graphite/40 bg-coal/40 p-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <p className="font-meta uppercase tracking-wide text-steel/70">Emails (published, not verified)</p>
            {c.emails.length === 0 ? <p className="text-steel">None found.</p> : (
              <ul className="space-y-1">
                {c.emails.map((e) => (
                  <li key={e.address} className="flex flex-wrap items-center gap-2 text-bone">
                    <span className="break-all">{e.address}</span>
                    {e.generic && <Badge tone="caution">generic inbox</Badge>}
                    {e.suppressed && <Badge tone="critical">opted out</Badge>}
                    <span className="text-steel/60">from {hostName(e.sourceUrl)}</span>
                    {manage && !e.suppressed && (
                      <button type="button" className="text-steel underline hover:text-bone" onClick={() => onOptOut(e.address)}>
                        mark opted out
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {generic && <p className="text-steel/70">A generic inbox is not a confirmed decision-maker. Confirm routing before pitching.</p>}
          </div>
          <div className="min-w-0 space-y-1">
            <p className="font-meta uppercase tracking-wide text-steel/70">Phones, social, booking</p>
            <p className="text-bone">{c.phones.map((x) => x.number).join(", ") || "No phone found."}</p>
            {c.socials.length === 0 ? <p className="text-steel">No social links.</p> : (
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {c.socials.map((s) => (
                  <li key={s.url} className="min-w-0 break-all text-steel">
                    {s.platform}:{" "}
                    {isWebUrl(s.url)
                      ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-graphite underline-offset-2 hover:text-bone">{s.url.replace(/^https?:\/\//, "")}</a>
                      : s.url}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-steel">{c.booking.length ? `Booking: ${c.booking.join(", ")}` : "No booking platform detected."}</p>
            <p className="text-steel/60">Read {new Date(c.scrapedAt).toLocaleString()}</p>
          </div>
        </div>
      ) : (
        <p className="text-steel">No contact info yet. Confirm the website, then use Find contact info.</p>
      )}
      {generic && (
        <div className="flex flex-wrap items-center gap-2">
          {p.routingConfirmed ? (
            <Badge tone="info">routing confirmed{p.routingConfirmedAt ? ` ${new Date(p.routingConfirmedAt).toLocaleDateString()}` : ""}</Badge>
          ) : manage ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={onConfirmRouting}>Confirm routing</Button>
              <span className="text-steel">You checked who handles studio operations behind the generic inbox. It never approves an email.</span>
            </>
          ) : (
            <span className="text-steel">Routing not confirmed yet.</span>
          )}
        </div>
      )}
    </div>
  );
}

function DeliveryLine({ d }: { d: NonNullable<EmailItem["delivery"]> }) {
  const tone = DELIVERY_TONE[d.status] ?? "neutral";
  const Icon = DELIVERY_ICON[tone];
  return (
    <div className="space-y-0.5">
      <Badge tone={tone}><Icon className="size-3" aria-hidden />{d.status}</Badge>
      {d.meaning && <p className="text-steel/80">{d.meaning}</p>}
      {d.error && <p className="text-critical">{d.error}</p>}
    </div>
  );
}

/** Lawrence's or MaxB's email exactly as it went out (signature image inlined
 *  by the Review queue's own preview), drawn in the same sandbox as received mail. */
function OutreachEmailBody({ item }: { item: EmailItem & { draftId: Id<"outreachDrafts"> } }) {
  const preview = useQuery(api.outreachDrafts.preview, { id: item.draftId });
  if (preview === undefined) return <p className="text-xs text-steel/70">Loading the email as it was sent</p>;
  return (
    <MessageBody m={{ bodyStatus: "ok", html: preview?.html ?? item.html, text: preview?.text ?? item.text, from: item.from, htmlTruncated: false }} />
  );
}

type MessageLike = EmailItem | DraftItem | DmItem;

function messageMeta(item: MessageLike) {
  if (item.kind === "draft") {
    return { Icon: Edit05, word: "Draft, not sent", frame: "border-dashed border-graphite/70", icon: "text-steel" };
  }
  if (item.kind === "dm") {
    return { Icon: MessageChatCircle, word: item.status === "sent" ? "Instagram DM" : "DM approved", frame: "border-graphite/50 shadow-[inset_2px_0_0_var(--color-gold)]", icon: "text-gold" };
  }
  return item.direction === "in"
    ? { Icon: ArrowDownLeft, word: "Received", frame: "border-graphite/50 shadow-[inset_2px_0_0_var(--color-info)]", icon: "text-info" }
    : { Icon: ArrowUpRight, word: "Sent", frame: "border-graphite/50 shadow-[inset_2px_0_0_var(--color-gold)]", icon: "text-gold" };
}

const DRAFT_STATUS: Record<DraftItem["status"], { text: string; tone: Tone }> = {
  draft: { text: "awaiting approval", tone: "info" },
  hold: { text: "on hold", tone: "caution" },
  approved: { text: "approved, not sent", tone: "positive" },
  expired: { text: "approval expired", tone: "caution" },
};

function MessageDetails({ item, onOpenReviewQueue }: { item: MessageLike; onOpenReviewQueue?: () => void }) {
  if (item.kind === "dm") {
    return (
      <div className="space-y-2 text-xs">
        <p className="text-steel">To @{item.handle} · {fullWhen(item.at)} · {item.status === "sent" ? "sent from Instagram by a person" : "approved, not marked sent yet"}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-bone">{item.text}</p>
      </div>
    );
  }
  if (item.kind === "draft") {
    const st = DRAFT_STATUS[item.status];
    return (
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={st.tone}>{st.text}</Badge>
          <span className="text-steel">{item.label}</span>
        </div>
        <p className="break-all text-steel">From {item.from} · To {item.to.join(", ")} · prepared {fullWhen(item.at)}</p>
        <p className="text-sm text-bone">{item.subject}</p>
        {item.holdReason && <p className="text-caution">{item.holdReason}</p>}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-graphite/40 bg-obsidian/60 p-2 font-sans text-xs text-ash">{item.text}</pre>
        <p className="text-steel/80">Nothing has been sent. Approve and send it in the Review queue.</p>
        {onOpenReviewQueue && <Button type="button" size="sm" variant="secondary" onClick={onOpenReviewQueue}>Open the Review queue</Button>}
      </div>
    );
  }
  return (
    <div className="space-y-2 text-xs">
      <p className="break-all text-steel">
        From {item.from} · To {item.to.join(", ")}{item.cc.length ? ` · Cc ${item.cc.join(", ")}` : ""}
      </p>
      <p className="text-steel/80">{fullWhen(item.at)}{item.label ? ` · ${item.label}` : ""}</p>
      <p className="break-words text-sm text-bone">{item.subject}</p>
      <div className="flex flex-wrap items-start gap-2">
        {item.unread && <Badge tone="gold">new</Badge>}
        {item.intent && <ReplyIntentBadge r={item.intent} />}
      </div>
      {item.delivery && <DeliveryLine d={item.delivery} />}
      {item.authFailed && (
        <p className="flex items-center gap-1.5 text-caution"><AlertTriangle className="size-3.5" aria-hidden /> The sender could not be verified. Be careful with links.</p>
      )}
      {item.source === "outreach" && item.draftId ? (
        <OutreachEmailBody item={{ ...item, draftId: item.draftId }} />
      ) : item.source === "log" ? (
        <p className="text-steel">A recorded send. No copy of the email is stored.</p>
      ) : item.bodyOmitted ? (
        <p className="text-steel">This older message is not loaded here to keep the page light. It is in the Email tab.</p>
      ) : (
        <MessageBody
          m={{ bodyStatus: item.bodyPending ? "pending" : "ok", html: item.html, text: item.text, from: item.from, htmlTruncated: item.htmlTruncated }}
          height={frameHeight(item.html, item.text)}
        />
      )}
      {item.messageId && item.attachments.length > 0 && <Attachments m={{ _id: item.messageId, attachments: item.attachments }} />}
    </div>
  );
}

function MessageEntry({ item, open, onToggle, onOpenReviewQueue }: {
  item: MessageLike; open: boolean; onToggle: () => void; onOpenReviewQueue?: () => void;
}) {
  const meta = messageMeta(item);
  const unread = item.kind === "email" && item.unread;
  const who = item.kind === "dm" ? `To @${item.handle}` : nameFrom(item.from);
  const bodyId = `msg-${item.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  return (
    <li className={cn("overflow-hidden rounded-lg border bg-coal/40", meta.frame)}>
      <button
        type="button" onClick={onToggle} aria-expanded={open} aria-controls={bodyId}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors duration-150 ease-out hover:bg-coal-2/40"
      >
        <meta.Icon className={cn("size-4 shrink-0", meta.icon)} aria-hidden />
        <span className="shrink-0 font-meta text-[0.625rem] uppercase tracking-wide text-steel/80">{meta.word}</span>
        <span className={cn("min-w-0 shrink truncate text-sm", unread ? "font-semibold text-bone" : "text-ash")}>{who}</span>
        <span className={cn("hidden min-w-0 flex-1 truncate text-xs text-steel sm:block", open && "sm:invisible")}>{item.snippet}</span>
        <span className="flex-1 sm:hidden" />
        <time dateTime={new Date(item.at).toISOString()} className="shrink-0 text-[0.6875rem] tabular-nums text-steel/70">{shortWhen(item.at)}</time>
        <ChevronDown className={cn("size-4 shrink-0 text-steel/70 transition-transform duration-150 ease-out motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={bodyId} key="body"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-graphite/40 px-3 pb-3 pt-2">
              <MessageDetails item={item} onOpenReviewQueue={onOpenReviewQueue} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

const BOOKING_TONE: Record<string, Tone> = { confirmed: "positive", completed: "positive", cancelled: "critical", no_show: "caution", other: "neutral" };

function BookingEntry({ item }: { item: BookingItem }) {
  const verb = item.status === "cancelled" ? "Demo cancelled" : item.status === "completed" ? "Demo held" : "Demo booked";
  return (
    <li className="flex items-start gap-3 rounded-lg border border-graphite/40 bg-coal/30 px-3 py-2 text-xs">
      <CalendarCheck01 className="mt-0.5 size-4 shrink-0 text-positive" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-bone">{verb}: {fullWhen(item.startsAt)}{item.timezone ? ` (${item.timezone})` : ""}</p>
        <p className="break-words text-steel">
          {[item.title, item.contactName, item.contactEmail, item.location].filter(Boolean).join(" · ")}
        </p>
        {item.meetingUrl && isWebUrl(item.meetingUrl) && (
          <a href={item.meetingUrl} target="_blank" rel="noopener noreferrer" className="text-steel underline underline-offset-2 hover:text-bone">Meeting link</a>
        )}
      </div>
      <Badge tone={BOOKING_TONE[item.status] ?? "neutral"}>{item.status.replace(/_/g, " ")}</Badge>
    </li>
  );
}

const CALL_TONE: Record<string, Tone> = { completed: "positive", failed: "critical", dry_run: "info", queued: "info", dialing: "info", skipped: "neutral", cancelled: "neutral" };

function CallEntry({ item }: { item: CallItem }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-graphite/40 bg-coal/30 px-3 py-2 text-xs">
      <PhoneCall01 className="mt-0.5 size-4 shrink-0 text-steel" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm text-bone">Confirmation call · {fullWhen(item.at)}</p>
        {item.summary && <p className="break-words text-steel">{item.summary}</p>}
        {(item.disposition || item.answeredBy) && <p className="text-steel/80">{[item.disposition, item.answeredBy && `answered by ${item.answeredBy}`].filter(Boolean).join(" · ")}</p>}
        {item.skipReason && <p className="text-steel/80">Skipped: {item.skipReason}</p>}
        {item.error && <p className="text-critical">{item.error}</p>}
      </div>
      <Badge tone={CALL_TONE[item.status] ?? "neutral"}>{item.status.replace(/_/g, " ")}</Badge>
    </li>
  );
}

function EventLine({ item }: { item: EventItem }) {
  return (
    <li className="flex items-center gap-3 py-1 text-[0.6875rem] text-steel/70">
      <span aria-hidden className="h-px flex-1 bg-graphite/40" />
      <span className="max-w-[85%] text-center">
        {item.text} <time dateTime={new Date(item.at).toISOString()} className="tabular-nums">{shortWhen(item.at)}</time>
      </span>
      <span aria-hidden className="h-px flex-1 bg-graphite/40" />
    </li>
  );
}

/** Gmail-style history: the newest message (and anything unread when the
 *  studio was opened) is open, everything else folds to one line; with many
 *  items the middle folds into "N earlier". What opened stays open after the
 *  reply is marked read, so nothing folds away under the reader. */
export function ConversationTimeline({ items, truncated, onOpenReviewQueue }: {
  items: TimelineItem[]; truncated?: boolean; onOpenReviewQueue?: () => void;
}) {
  const latest = latestOpenable(items);
  const [openedAtMount] = React.useState(() => defaultOpen(items));
  const [userOpen, setUserOpen] = React.useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = React.useState(false);
  const isOpen = (id: string) => userOpen[id] ?? (openedAtMount.has(id) || id === latest);
  const fold = items.length > 7 && !showAll;
  const shown = fold ? [items[0], ...items.slice(items.length - 4)] : items;
  const hidden = items.length - shown.length;
  if (items.length === 0) return <p className="text-sm text-steel/70">Nothing yet.</p>;
  return (
    <ol aria-label="Conversation history" className="space-y-2">
      {truncated && <li className="text-center text-[0.6875rem] text-steel/70">Older history is not shown.</li>}
      {shown.map((it, i) => (
        <React.Fragment key={it.id}>
          {fold && i === 1 && (
            <li className="flex items-center gap-3">
              <span aria-hidden className="h-px flex-1 bg-graphite/40" />
              <button type="button" onClick={() => setShowAll(true)} className="rounded-full border border-graphite/60 bg-coal-2 px-3 py-1 text-xs text-steel transition-colors hover:text-bone">
                {hidden} earlier
              </button>
              <span aria-hidden className="h-px flex-1 bg-graphite/40" />
            </li>
          )}
          {it.kind === "event" ? <EventLine item={it} />
            : it.kind === "booking" ? <BookingEntry item={it} />
            : it.kind === "call" ? <CallEntry item={it} />
            : <MessageEntry item={it} open={isOpen(it.id)} onToggle={() => setUserOpen((m) => ({ ...m, [it.id]: !isOpen(it.id) }))} onOpenReviewQueue={onOpenReviewQueue} />}
        </React.Fragment>
      ))}
    </ol>
  );
}

function RemoveButton({ onRemove }: { onRemove: () => void }) {
  const [confirming, setConfirming] = React.useState(false);
  if (!confirming) {
    return <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}><Trash01 aria-hidden /> Remove</Button>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="danger" onClick={() => { setConfirming(false); onRemove(); }}>Confirm remove</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
    </span>
  );
}

export function ConversationPane({ prospectId, prep, onPrep, site, onSite, onBack, onGone, focusOnOpen, onOpenReviewQueue }: {
  prospectId: ProspectId;
  prep: Prep;
  onPrep: (patch: Prep) => void;
  site: string;
  onSite: (value: string) => void;
  onBack: () => void;
  onGone: () => void;
  focusOnOpen?: boolean;
  onOpenReviewQueue?: () => void;
}) {
  const data = useQuery(api.outreachInbox.conversation, { prospectId });
  const markRead = useMutation(api.mail.markThreadRead);
  const setWebsite = useMutation(api.outreachProspects.setWebsite);
  const requestScrape = useMutation(api.outreachProspects.requestScrape);
  const queue = useMutation(api.outreachProspects.queueForReview);
  const suppress = useMutation(api.outreachProspects.suppressEmail);
  const remove = useMutation(api.outreachProspects.remove);
  const markReplied = useMutation(api.outreachProspects.markReplied);
  const confirmRouting = useMutation(api.outreachProspects.confirmRouting);
  const stopSequence = useMutation(api.outreachSequences.stop);
  const prepare = useMutation(api.outreachDrafts.prepare);
  const [infoOpen, setInfoOpen] = React.useState(false);
  const [composeOpen, setComposeOpen] = React.useState(false);
  const { run, msg, err, setMsg } = useRun();
  const heading = React.useRef<HTMLHeadingElement>(null);
  const loaded = data !== undefined && data !== null;

  // Opening a studio with an unread reply marks that mail thread read, through
  // the Email tab's own mutation (only for people who can read the Email tab).
  const unreadKey = data?.mailVisible ? data.unreadThreadIds.join(",") : "";
  React.useEffect(() => {
    if (!unreadKey) return;
    for (const threadId of unreadKey.split(",")) markRead({ threadId: threadId as Id<"mailThreads"> }).catch(() => undefined);
  }, [unreadKey, markRead]);

  // Phone: the list is gone, so the studio's name takes focus.
  React.useEffect(() => {
    if (loaded && focusOnOpen) heading.current?.focus();
  }, [loaded, focusOnOpen]);

  if (data === undefined) return <LoadingPanel label="Loading the conversation" />;
  if (data === null) {
    return (
      <div className="space-y-3 rounded-lg border border-graphite/50 bg-coal/40 p-4 text-sm text-steel">
        <p>This studio is no longer on the list.</p>
        <Button type="button" size="sm" variant="secondary" onClick={onGone}><ArrowLeft aria-hidden /> Back to studios</Button>
      </div>
    );
  }

  const p = data.prospect;
  const manage = data.canManage;
  const seq = p.sequence;
  const st = PROSPECT_STATUS[p.status] ?? { tone: "neutral" as Tone, short: p.status, meaning: "" };
  const primaryEmail = seq?.recipient ?? p.contacts?.emails.find((e) => !e.suppressed)?.address ?? null;
  const canScrape = ["ready_to_scrape", "no_contact", "blocked", "unreachable", "scraped"].includes(p.status) && Boolean(p.websiteUrl);
  const composeReady = manage && Boolean(p.contacts) && (p.status === "queued" || (p.status === "replied" && Boolean(seq)));
  const infoId = `contact-info-${p.id}`;
  const composeId = `compose-${p.id}`;
  const id = p.id;

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      aria-labelledby={`pane-title-${p.id}`}
      className="min-w-0 space-y-4 rounded-lg border border-graphite/50 bg-coal/30 p-3 sm:p-4"
    >
      <header className="space-y-3">
        <div className="flex items-start gap-3">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to studios" className="lg:hidden">
            <ArrowLeft aria-hidden />
          </Button>
          <Avatar name={p.displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 id={`pane-title-${p.id}`} ref={heading} tabIndex={-1} className="break-words font-grotesk text-lg font-semibold leading-tight text-bone outline-none">
              {p.displayName}
            </h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-steel">
              {p.handle && <span>@{p.handle}</span>}
              {p.websiteUrl && isWebUrl(p.websiteUrl)
                ? <a href={p.websiteUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-graphite underline-offset-2 hover:text-bone">{p.host}</a>
                : <span>No website yet</span>}
              {primaryEmail && <span className="break-all">{primaryEmail}</span>}
            </p>
          </div>
          <Button
            type="button" size="sm" variant="outline" aria-expanded={infoOpen} aria-controls={infoId} aria-label="Contact info"
            onClick={() => setInfoOpen((o) => !o)} className="shrink-0"
          >
            <User01 aria-hidden /> <span className="hidden sm:inline">Contact info</span>
            <ChevronDown className={cn("transition-transform duration-150 ease-out motion-reduce:transition-none", infoOpen && "rotate-180")} aria-hidden />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={st.tone}>{p.status.replace(/_/g, " ")}</Badge>
          {p.replyIntent && <ReplyIntentBadge r={p.replyIntent} />}
          {p.bookedAt && <Badge tone="positive">Booked a demo {new Date(p.bookedAt).toLocaleDateString()}</Badge>}
          {p.routingConfirmed && <Badge tone="info">routing confirmed</Badge>}
        </div>
        <p className="text-xs text-steel/80">{p.note ?? st.meaning}</p>
        {seq && <SequenceLine s={seq} />}
      </header>

      <AnimatePresence initial={false}>
        {infoOpen && (
          <motion.section
            id={infoId} key="info" aria-label="Contact info"
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-graphite/40 bg-obsidian/50 p-3">
              <ContactDetails
                p={p} manage={manage}
                onOptOut={(email) => void run(() => suppress({ email, reason: "opt-out" }), `${email} will not be contacted.`)}
                onConfirmRouting={() => void run(async () => {
                  const r = await confirmRouting({ ids: [id] });
                  setMsg(`Routing confirmed. ${r.holdsCleared} held draft(s) moved back to awaiting approval. Nothing was approved or sent.`);
                })}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {manage ? (
        <div className="space-y-2">
          {(p.status === "needs_website" || p.status === "unreachable") && (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`site-${p.id}`} className="sr-only">Confirm website for {p.displayName}</label>
              <input
                id={`site-${p.id}`} value={site} onChange={(e) => onSite(e.target.value)} placeholder="studio-website.com"
                className="min-w-0 flex-1 basis-48 rounded border border-graphite/60 bg-obsidian px-3 py-1.5 text-sm text-bone"
              />
              <Button type="button" size="sm" variant="secondary" disabled={!site.trim()} onClick={() => void run(() => setWebsite({ id, url: site }), "Website confirmed.")}>
                Confirm website
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {canScrape && (
              <Button type="button" size="sm" variant="secondary" onClick={() => void run(() => requestScrape({ id }), "Reading the site now.")}>
                <RefreshCw01 aria-hidden /> {p.status === "ready_to_scrape" ? "Find contact info" : "Read again"}
              </Button>
            )}
            {p.status === "scraped" && (
              <Button type="button" size="sm" variant="primary" onClick={() => void run(() => queue({ id }), "Added to the review queue. Nothing was sent.")}>
                Queue for review
              </Button>
            )}
            {p.status === "queued" && (
              <Button type="button" size="sm" variant="secondary" onClick={() => void run(() => markReplied({ id }), "Marked replied. Follow-ups stopped.")}>
                Mark replied
              </Button>
            )}
            {seq?.status === "active" && (
              <Button type="button" size="sm" variant="ghost" onClick={() => void run(() => stopSequence({ prospectId: id }), "Follow-ups stopped for this studio.")}>
                Stop follow-ups
              </Button>
            )}
            <RemoveButton onRemove={() => void run(() => remove({ id })).then((ok) => { if (ok) onGone(); })} />
          </div>
          <Feedback msg={msg} err={err} />
        </div>
      ) : (
        <p className="text-xs text-steel">Only an owner or admin can change prospects.</p>
      )}

      <section aria-label="History" className="space-y-2">
        {!data.mailVisible && (
          <p className="text-xs text-steel/80">Replies are shown to owners and admins who can read the Email tab.</p>
        )}
        <ConversationTimeline key={p.id} items={data.timeline} truncated={data.truncated} onOpenReviewQueue={onOpenReviewQueue} />
      </section>

      {composeReady && (
        <section aria-label="Compose" className="pl-well overflow-hidden rounded-lg border border-graphite/40 bg-obsidian/40">
          <button
            type="button" aria-expanded={composeOpen} aria-controls={composeId} onClick={() => setComposeOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-bone transition-colors duration-150 ease-out hover:bg-coal-2/40"
          >
            <Edit05 className="size-4 shrink-0 text-gold" aria-hidden />
            <span className="min-w-0 flex-1">{seq ? "Prepare a MaxB reply in the thread" : "Prepare Lawrence's first email"}</span>
            <ChevronDown className={cn("size-4 shrink-0 text-steel transition-transform duration-150 ease-out motion-reduce:transition-none", composeOpen && "rotate-180")} aria-hidden />
          </button>
          <AnimatePresence initial={false}>
            {composeOpen && (
              <motion.div
                id={composeId} key="compose"
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-graphite/40"
              >
                <PrepareEmailForm
                  p={p} cur={prep} onChange={onPrep}
                  onPrepare={(args) => void run(() => prepare(args), "Draft prepared. Open the Review queue tab to preview it. Nothing was sent.")}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}
    </motion.article>
  );
}

/* ---------------------------------- inbox ---------------------------------- */

function Placeholder({ needs, unread }: { needs: number; unread: number }) {
  return (
    <div className="hidden min-h-72 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-graphite/50 px-6 py-12 text-center lg:flex">
      <Inbox01 className="size-6 text-steel/70" aria-hidden />
      <p className="text-sm text-bone">Pick a studio to see its conversation</p>
      <p className="text-xs text-steel">
        {needs} need{needs === 1 ? "s" : ""} action{unread ? `, ${unread} with an unread reply` : ""}.
      </p>
    </div>
  );
}

const DESKTOP = "(min-width: 1024px)";
const isDesktop = () => typeof window !== "undefined" && window.matchMedia(DESKTOP).matches;

export function OutreachInbox({ selected: controlled, onSelect, onOpenReviewQueue }: {
  /** Optional: the page can hold the open studio so it survives a tab switch. */
  selected?: ProspectId | null;
  onSelect?: (id: ProspectId | null) => void;
  onOpenReviewQueue?: () => void;
} = {}) {
  const data = useQuery(api.outreachInbox.list, {});
  const confirmRouting = useMutation(api.outreachProspects.confirmRouting);
  const [own, setOwn] = React.useState<ProspectId | null>(null);
  const selected = controlled !== undefined ? controlled : own;
  const select = (id: ProspectId | null) => { setOwn(id); onSelect?.(id); };
  const [focusOnOpen, setFocusOnOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<InboxFilter>("all");
  const [selecting, setSelecting] = React.useState(false);
  const [checked, setChecked] = React.useState<Record<string, boolean>>({});
  const [prep, setPrep] = React.useState<Record<string, Prep>>({});
  const [sites, setSites] = React.useState<Record<string, string>>({});
  const bulk = useRun();
  // Reduced motion: every panel and message opens instantly.
  const reduceMotion = useReducedMotion();
  const paneRef = React.useRef<HTMLElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  if (data === undefined) return <LoadingPanel label="Loading prospects" />;
  if (data === null) return <Unauthorized />;
  const manage = data.canManage;
  const rows: ListData["rows"] = data.rows;
  const counts = Object.fromEntries(INBOX_FILTERS.map((f) => [f, rows.filter((r) => matchesFilter(r, f)).length])) as Record<InboxFilter, number>;
  const unread = rows.filter((r) => r.hasUnreadReply).length;
  const visible = rows.filter((r) => matchesFilter(r, filter) && matchesSearch(r, query));
  const selectedIds = rows.filter((r) => checked[r.id]).map((r) => r.id);

  const open = (id: ProspectId) => {
    const phone = !isDesktop();
    setFocusOnOpen(phone);
    select(id);
    if (phone) requestAnimationFrame(() => paneRef.current?.scrollIntoView({ block: "start" }));
  };
  const back = () => {
    const was = selected;
    select(null);
    requestAnimationFrame(() => {
      const row = was ? listRef.current?.querySelector<HTMLButtonElement>(`button[data-row="${was}"]`) : null;
      row?.focus();
      row?.scrollIntoView({ block: "center" });
    });
  };

  return (
    <MotionConfig reducedMotion="user" transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <AddStudiosDialog manage={manage} />
          {manage && <ImportCsvDialog />}
          <p className="ml-auto text-xs text-steel">
            {rows.length} studio{rows.length === 1 ? "" : "s"} · {counts.needs_action} need{counts.needs_action === 1 ? "s" : ""} action
            {unread ? ` · ${unread} unread repl${unread === 1 ? "y" : "ies"}` : ""}
          </p>
        </div>
        {!manage && <p className="text-xs text-steel">Only an owner or admin can add or change prospects.</p>}

        {rows.length === 0 ? (
          <EmptyState icon={Users01} title="No prospects yet" description="Use Add studios to paste a few handles or websites and start a list." />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
            <section aria-label="Studios" className={cn("min-w-0", selected && "hidden lg:block")}>
              <div className="space-y-2 lg:sticky lg:top-[4.5rem] lg:flex lg:max-h-[calc(100dvh-5.5rem)] lg:flex-col">
                <label className="pl-search flex w-full min-w-0 rounded-md border border-graphite/50 bg-ink-2 px-3">
                  <SearchMd className="size-4 shrink-0 text-steel/70" aria-hidden />
                  <span className="sr-only">Search studios</span>
                  <input
                    type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, handle, website or email"
                    className="h-9 min-w-0 flex-1 bg-transparent text-sm text-bone outline-none placeholder:text-steel/60"
                  />
                </label>
                <div role="group" aria-label="Show" className="pl-well flex flex-wrap gap-1 rounded-md p-1">
                  {INBOX_FILTERS.map((f) => (
                    <button
                      key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-on={filter === f}
                      className={cn(
                        "pl-bank-key inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-xs font-medium transition-colors duration-150 ease-out",
                        filter === f ? "bg-coal-2 text-bone" : "text-steel hover:text-bone",
                      )}
                    >
                      <span className="pl-led size-1.5 rounded-full bg-steel/40" data-on={filter === f} aria-hidden />
                      {FILTER_LABEL[f]}
                      <span className="tabular-nums text-steel/80">{counts[f]}</span>
                    </button>
                  ))}
                </div>
                {manage && (
                  <BulkRoutingBar
                    selecting={selecting} count={selectedIds.length}
                    onStart={() => setSelecting(true)}
                    onCancel={() => { setSelecting(false); setChecked({}); }}
                    onConfirm={() => void bulk.run(async () => {
                      const r = await confirmRouting({ ids: selectedIds });
                      setChecked({});
                      setSelecting(false);
                      bulk.setMsg(`Routing confirmed for ${r.changed} studio(s). ${r.holdsCleared} held draft(s) moved back to awaiting approval. Nothing was approved or sent.`);
                    })}
                  />
                )}
                <Feedback msg={bulk.msg} err={bulk.err} />
                {visible.length === 0 ? (
                  <p className="rounded-lg border border-graphite/50 bg-coal/40 px-4 py-6 text-sm text-steel/70">
                    {query.trim() ? "No studio matches that search." : `Nothing to show under ${FILTER_LABEL[filter]}.`}
                  </p>
                ) : (
                  <ul
                    ref={listRef} aria-label="Studios" onKeyDown={onListKeyDown}
                    className="divide-y divide-graphite/40 overflow-hidden rounded-lg border border-graphite/50 bg-coal/40 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                  >
                    {visible.map((r) => (
                      <li key={r.id}>
                        <InboxListRow
                          r={r} active={selected === r.id} selecting={selecting} checked={!!checked[r.id]}
                          onOpen={open} onCheck={(id, on) => setChecked((s) => ({ ...s, [id]: on }))}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {data.suppressedCount > 0 && (
                  <p className="text-xs text-steel">{data.suppressedCount} address(es) are on the opt-out list and will never be queued.</p>
                )}
              </div>
            </section>

            <section ref={paneRef} aria-label="Conversation" className={cn("min-w-0 scroll-mt-20", !selected && "hidden lg:block")}>
              {selected ? (
                <ConversationPane
                  key={selected} prospectId={selected}
                  prep={prep[selected] ?? {}} onPrep={(patch) => setPrep((m) => ({ ...m, [selected]: { ...(m[selected] ?? {}), ...patch } }))}
                  site={sites[selected] ?? ""} onSite={(v) => setSites((m) => ({ ...m, [selected]: v }))}
                  onBack={back} onGone={() => select(null)} focusOnOpen={focusOnOpen} onOpenReviewQueue={onOpenReviewQueue}
                />
              ) : (
                <Placeholder needs={counts.needs_action} unread={unread} />
              )}
            </section>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
