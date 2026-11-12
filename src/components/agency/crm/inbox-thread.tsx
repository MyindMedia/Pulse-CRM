"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Archive, ArchiveRestore, ArrowLeft, Bot, CalendarClock, CalendarPlus, Camera, CirclePause, CirclePlay, Globe, Mail,
  MailOpen, MessageSquareText, MessagesSquare, Paperclip, Pencil, Phone, Send, Sparkles, StickyNote, UserRound,
  Voicemail, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCrm, useCrmNav } from "./crm-context";
import { ConfirmDialog, TOUCH, WriteButton, ZuErrorState, confirmCopy, dateTime, phone, relTime, type ConfirmGrant } from "./crm-ui";
import { newIdem, useIdemFor, useZuRead, useZuWrite, type ZuLimits } from "./use-zu";
import { currentTime, useNow } from "./inbox-clock";
import { INBOX_OP } from "./inbox-ops";
import { INBOX_INVALIDATE, InboxComposer } from "./inbox-composer";
import {
  applyDraftChange, channelOptions, channelWord, contactSlots, defaultChannel, emptyDraft, threadItems,
  toLocalInput, validateSchedule, type ComposerDraft, type EventKind, type ThreadItem,
} from "./inbox-logic";
import type {
  Conversation, PhoneNumbersResponse, ReplySuggestion, ScheduledMessage, ScheduledResponse, ThreadResponse,
} from "./inbox-types";
import type { Lead, LeadResponse, LimitsResponse } from "./zu-types";

/* One conversation: header actions, the thread oldest first (scrolled to the
   newest), scheduled messages as dashed bubbles, the AI suggestion card, and the
   composer. Message bodies stay in React state only (design D7). */

const KIND_ICON: Record<EventKind, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  sms: MessageSquareText,
  email: Mail,
  instagram: Camera,
  messenger: MessagesSquare,
  chat: Globe,
  call: Phone,
  voicemail: Voicemail,
  note: StickyNote,
  other: StickyNote,
};

const READ_KINDS: Array<"message"> = ["message"];
export const SLOW_POLL_MS = 300_000;

export function InboxThread({
  leadId,
  conversation,
  suggestions,
  onBack,
  onOpenLead,
}: {
  leadId: string;
  conversation: Conversation | undefined;
  suggestions: ReplySuggestion[];
  onBack: () => void;
  onOpenLead: (leadId: string) => void;
}) {
  const { canWrite } = useCrm();
  const nav = useCrmNav();
  const path = { lead_id: leadId };
  // A "message" signal refetches the open thread only (with the list, in the
  // panel). The rest refresh on a slow poll or after this panel's own writes,
  // which invalidate them (F-U3).
  const thread = useZuRead<ThreadResponse>(INBOX_OP.thread, { path, query: { limit: 50 } }, { kinds: READ_KINDS, pollMs: SLOW_POLL_MS });
  const leadRead = useZuRead<LeadResponse>(INBOX_OP.lead, { path }, { kinds: ["lead"], pollMs: SLOW_POLL_MS });
  const scheduled = useZuRead<ScheduledResponse>(INBOX_OP.scheduled, { query: { lead_id: leadId, limit: 25 } }, { pollMs: SLOW_POLL_MS });
  const limits = useZuRead<LimitsResponse>(INBOX_OP.limits, undefined, { pollMs: SLOW_POLL_MS });
  const phones = useZuRead<PhoneNumbersResponse>(INBOX_OP.phoneNumbers, undefined, { pollMs: 600_000 });
  const { run, pending } = useZuWrite();

  const lead: Lead | undefined = leadRead.data?.lead;
  const leadRec = (lead ?? {}) as Record<string, unknown>;
  const items = React.useMemo(() => threadItems(thread.data?.messages), [thread.data]);
  const name = lead?.full_name || conversation?.name || thread.data?.lead?.full_name || lead?.email || phone(lead?.phone) || "Unnamed lead";
  const convChannel = conversation?.channel ?? null;
  // Moves, so the 24 hour Instagram and Messenger window closes on time (F-U14).
  const now = useNow(30_000);
  const options = React.useMemo(
    () => channelOptions(lead ?? (thread.data?.lead as Lead | undefined), convChannel, items, now),
    [lead, thread.data, convChannel, items, now],
  );

  const [draft, setDraft] = React.useState<ComposerDraft | null>(null);
  const shownDraft = draft ?? emptyDraft(defaultChannel(options, convChannel), () => "pending");
  const onDraft = (patch: Partial<Omit<ComposerDraft, "idem">>) =>
    setDraft((d) => applyDraftChange(d ?? emptyDraft(defaultChannel(options, convChannel), newIdem), patch, newIdem));

  const [writeLimits, setWriteLimits] = React.useState<ZuLimits | null>(null);
  const slots = contactSlots(limits.data?.limits, writeLimits);

  const aiPaused = conversation?.ai?.paused ?? (leadRec.ai_paused === true);
  const aiUntil = conversation?.ai?.paused_until ?? (typeof leadRec.ai_paused_until === "string" ? leadRec.ai_paused_until : null);
  const archived = conversation?.archived ?? (leadRec.inbox_archived === true);
  const unread = conversation?.unread ?? (leadRec.unread === true);

  // Opening a conversation marks it read, once per open (writes only).
  const marked = React.useRef(false);
  React.useEffect(() => {
    if (marked.current || !canWrite || !unread) return;
    marked.current = true;
    void run(INBOX_OP.markRead, { path: { lead_id: leadId } }, { invalidate: [INBOX_OP.conversations] });
  }, [canWrite, unread, run, leadId]);

  // Keep the newest message in view.
  const scroller = React.useRef<HTMLDivElement>(null);
  const lastId = items[items.length - 1]?.id;
  React.useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId, scheduled.data]);

  const assigned = typeof leadRec.assigned_phone_number_id === "string" ? leadRec.assigned_phone_number_id : null;
  const numbers = (phones.data?.phone_numbers ?? []).filter((p) => !p.released_at);
  const fromNumber = (numbers.find((p) => p.id === assigned) ?? numbers.find((p) => p.is_default) ?? numbers[0])?.phone_number ?? null;

  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [pauseOpen, setPauseOpen] = React.useState(false);
  const [cancelled, setCancelled] = React.useState<ScheduledMessage[]>([]);

  const act = async (op: string, body: Record<string, unknown> | undefined, done: string, grant?: ConfirmGrant) => {
    const res = await run(op, { path, body, ...grant }, { invalidate: [INBOX_OP.conversations, INBOX_OP.lead, INBOX_OP.thread] });
    if (res.ok) toast.success(done);
    else toast.error(res.reason ?? "Zuops refused.");
    return res.ok;
  };

  const leadSuggestions = suggestions.filter((s) => s.lead_id === leadId && (s.status ?? "pending") === "pending");
  const upcoming = (scheduled.data?.scheduled_messages ?? []).filter((m) => !cancelled.some((c) => c.id === m.id));
  const sub = [channelWord(convChannel), phone(lead?.phone ?? conversation?.phone) || lead?.email || conversation?.email].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <header className="min-w-0 space-y-2 rounded-lg border border-graphite/50 bg-coal/40 p-3">
        <div className="flex min-w-0 flex-wrap items-start gap-2">
          <Button type="button" variant="secondary" size="sm" className={cn("lg:hidden", TOUCH)} onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden />Back
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-grotesk text-base font-semibold text-bone">{name}</h2>
            <p className="truncate text-xs text-steel">{sub || "Conversation"}</p>
          </div>
          {aiPaused
            ? <Badge tone="caution"><CirclePause className="size-3" aria-hidden />AI paused{aiUntil ? ` until ${dateTime(aiUntil)}` : ""}</Badge>
            : <Badge tone="info"><Bot className="size-3" aria-hidden />AI on</Badge>}
          {archived && <Badge><Archive className="size-3" aria-hidden />Archived</Badge>}
        </div>
        {conversation?.ai?.handoff_question && (
          <p className="text-xs text-caution">The AI handed this to your team: {conversation.ai.handoff_question}</p>
        )}
        <div className="flex min-w-0 flex-wrap gap-2">
          <WriteButton type="button" variant="secondary" size="sm" disabled={pending}
            onClick={() => void act(INBOX_OP.markUnread, undefined, "Marked unread")}>
            <MailOpen className="size-4" aria-hidden />Mark unread
          </WriteButton>
          {aiPaused ? (
            <ConfirmDialog
              title={`Turn the AI back on for ${name}?`}
              body={<>The AI starts replying to {name} again and their automatic follow-ups pick up where they stopped. {confirmCopy("changes_sending")}</>}
              confirmLabel="Resume AI"
              onConfirm={(grant) => act(INBOX_OP.aiPause, { paused: false }, "AI replies are back on for this lead", grant)}
              trigger={
                <WriteButton type="button" variant="secondary" size="sm" disabled={pending}>
                  <CirclePlay className="size-4" aria-hidden />Resume AI
                </WriteButton>
              }
            />
          ) : (
            <WriteButton type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setPauseOpen(true)}>
              <CirclePause className="size-4" aria-hidden />Pause AI
            </WriteButton>
          )}
          {archived ? (
            <WriteButton type="button" variant="secondary" size="sm" disabled={pending}
              onClick={() => void act(INBOX_OP.unarchive, undefined, "Back in the Inbox. Follow-ups switched off by archiving stay off.")}>
              <ArchiveRestore className="size-4" aria-hidden />Move to Inbox
            </WriteButton>
          ) : (
            <WriteButton type="button" variant="secondary" size="sm" disabled={pending} onClick={() => setArchiveOpen(true)}>
              <Archive className="size-4" aria-hidden />Archive
            </WriteButton>
          )}
          <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => onOpenLead(leadId)}>
            <UserRound className="size-4" aria-hidden />Lead
          </Button>
          <Button type="button" variant="secondary" size="sm" className={TOUCH} onClick={() => nav.openCalendar(leadId)}>
            <CalendarPlus className="size-4" aria-hidden />Book
          </Button>
        </div>
      </header>

      {thread.error && !thread.data ? (
        <ZuErrorState error={thread.error} onRetry={thread.refresh} />
      ) : thread.loading ? (
        <div aria-busy="true" aria-label="Loading the conversation" className="space-y-3 p-2">
          <Skeleton className="h-12 w-2/3" /><Skeleton className="ml-auto h-12 w-2/3" /><Skeleton className="h-12 w-1/2" />
        </div>
      ) : (
        <div ref={scroller} className="max-h-[60vh] min-h-48 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-lg border border-graphite/50 bg-obsidian/40 p-3" tabIndex={0} aria-label={`Messages with ${name}`}>
          {thread.error && <p role="alert" className="mb-2 text-xs text-caution">Showing the last copy. {thread.error.reason}</p>}
          {items.length === 0 && upcoming.length === 0 && cancelled.length === 0 ? (
            <p className="py-8 text-center text-sm text-steel">No messages with {name} yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {items.map((it) => <Bubble key={it.id} item={it} />)}
              {[...upcoming, ...cancelled].map((m) => (
                <ScheduledBubble
                  key={m.id} item={m} leadName={name}
                  isCancelled={cancelled.some((c) => c.id === m.id)}
                  onCancelled={() => setCancelled((list) => [...list.filter((c) => c.id !== m.id), { ...m, status: "cancelled" }])}
                  onRestored={() => setCancelled((list) => list.filter((c) => c.id !== m.id))}
                />
              ))}
            </ol>
          )}
        </div>
      )}

      {leadSuggestions.map((s) => (
        <SuggestionCard
          key={s.id} suggestion={s} leadName={name}
          onEditFirst={() => onDraft({ text: s.body ?? "", suggestionId: s.id, channel: (["sms", "email", "instagram", "messenger"].includes(s.channel ?? "") ? s.channel : shownDraft.channel) as ComposerDraft["channel"], sendAt: "" })}
        />
      ))}

      {leadRead.error && !lead ? (
        <p role="alert" className="text-sm text-caution">The lead did not load, so sending is off. {leadRead.error.reason}</p>
      ) : !lead && leadRead.loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <InboxComposer
          to={{ leadId, name, phone: lead?.phone ?? null, email: lead?.email ?? null }}
          options={options}
          draft={shownDraft}
          onDraft={onDraft}
          onSent={() => setDraft(emptyDraft(shownDraft.channel, newIdem))}
          fromNumber={fromNumber}
          slots={slots}
          frozenReason={limits.data?.limits?.frozen ? limits.data.limits.frozen_reason || "Zuops froze sending for now." : null}
          onLimits={(l) => { if (typeof l.contactsRemaining === "number") setWriteLimits(l); }}
        />
      )}

      <ArchiveDialog
        open={archiveOpen} onOpenChange={setArchiveOpen} name={name} pending={pending}
        onArchive={async () => { if (await act(INBOX_OP.archive, undefined, "Archived. Follow-up texts for this lead are off.")) setArchiveOpen(false); }}
      />
      <PauseDialog
        open={pauseOpen} onOpenChange={setPauseOpen} name={name} pending={pending}
        onPause={async (until) => {
          if (await act(INBOX_OP.aiPause, until ? { paused: true, until } : { paused: true }, until ? `AI paused until ${dateTime(until)}` : "AI paused for this lead")) setPauseOpen(false);
        }}
      />
    </div>
  );
}

function Bubble({ item }: { item: ThreadItem }) {
  const Icon = KIND_ICON[item.kind];
  const out = item.direction === "outbound";
  const internal = item.direction === "internal";
  return (
    <li
      className={cn(
        "min-w-0 max-w-[92%] break-words rounded-lg border px-3 py-2 text-sm sm:max-w-[80%]",
        internal ? "self-center border-dashed border-graphite/60 bg-coal/40" : out ? "self-end border-gold-dim/40 bg-gold/10" : "self-start border-graphite/50 bg-coal-2",
      )}
    >
      <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-steel">
        <Icon className="size-3" aria-hidden />
        <span>{item.label}</span>
        {item.at && <> · <time dateTime={item.at}>{relTime(item.at)}</time></>}
      </p>
      {item.subject && <p className="font-semibold text-bone">{item.subject}</p>}
      {item.text ? <p className="whitespace-pre-wrap break-words text-bone">{item.text}</p> : !item.media.length && <p className="text-steel">(no text)</p>}
      {item.media.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {item.media.map((m, i) => (
            <li key={m.url}>
              <a href={m.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-info underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-gold max-sm:min-h-11">
                <Paperclip className="size-3" aria-hidden />{m.label} {i + 1}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** The PATCH body for an edited scheduled message, or why it cannot be saved.
 *  Null body: nothing changed. */
export function scheduledEditBody(
  item: Pick<ScheduledMessage, "body" | "scheduled_at">,
  text: string,
  at: string,
  now: number,
): { body: Record<string, unknown> | null } | { error: string } {
  if (!text.trim()) return { error: "Write a message first." };
  const body: Record<string, unknown> = {};
  if (text.trim() !== (item.body ?? "").trim()) body.body = text.trim();
  const origAt = item.scheduled_at ? toLocalInput(Date.parse(item.scheduled_at)) : "";
  if (at !== origAt) {
    const v = validateSchedule(at, now);
    if (!v.ok) return { error: v.reason };
    body.scheduled_at = v.iso;
  }
  return { body: Object.keys(body).length ? body : null };
}

function ScheduledBubble({
  item, leadName, isCancelled, onCancelled, onRestored,
}: {
  item: ScheduledMessage;
  leadName: string;
  isCancelled: boolean;
  onCancelled: () => void;
  onRestored: () => void;
}) {
  const { run, pending } = useZuWrite();
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState(item.body ?? "");
  const [at, setAt] = React.useState(() => (item.scheduled_at ? toLocalInput(Date.parse(item.scheduled_at)) : ""));
  const [error, setError] = React.useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = React.useState<Record<string, unknown> | null>(null);
  // Bumped after each accepted write, so the next action gets a fresh key while
  // a retry of the same action reuses its key (F-U9).
  const [round, setRound] = React.useState(0);
  const path = { scheduled_message_id: item.id };
  const failed = item.status === "failed";
  const word = channelWord(item.channel);
  const keys = {
    cancel: useIdemFor(`sched-cancel:${item.id}:${round}`),
    restore: useIdemFor(`sched-restore:${item.id}:${round}`),
    edit: useIdemFor(`sched-edit:${item.id}:${round}:${text.trim()}:${at}`),
    sendNow: useIdemFor(`sched-send-now:${item.id}:${round}`),
  };

  const patch = async (body: Record<string, unknown>, idem: string, done: string, grant?: ConfirmGrant) => {
    setError(null);
    const res = await run(INBOX_OP.scheduledUpdate, { path, body, idem, ...grant }, { invalidate: [INBOX_OP.scheduled] });
    if (res.ok) { toast.success(done); setRound((r) => r + 1); }
    else setError(res.reason ?? "Zuops refused.");
    return res.ok;
  };

  const save = () => {
    const r = scheduledEditBody(item, text, at, currentTime());
    if ("error" in r) { setError(r.error); return; }
    if (!r.body) { setEditing(false); return; }
    setError(null);
    setPendingEdit(r.body);
  };

  return (
    <li className="min-w-0 max-w-[92%] self-end rounded-lg border border-dashed border-gold-dim/60 bg-coal/40 px-3 py-2 text-sm sm:max-w-[80%]">
      <p className="mb-1 flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-steel">
        <CalendarClock className="size-3" aria-hidden />
        <span>{isCancelled ? `Cancelled ${word.toLowerCase()}` : `Scheduled ${word.toLowerCase()}`} · {dateTime(item.scheduled_at)}</span>
        {failed && <Badge tone="critical">Failed</Badge>}
        {item.status === "sending" && <Badge tone="info">Sending</Badge>}
      </p>
      {failed && item.last_error && <p className="break-words text-xs text-critical">{item.last_error}</p>}
      {editing ? (
        <div className="min-w-0 space-y-2">
          <Label htmlFor={`sm-text-${item.id}`}>Message</Label>
          <Textarea id={`sm-text-${item.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          <Label htmlFor={`sm-at-${item.id}`}>Send at (your time)</Label>
          <Input id={`sm-at-${item.id}`} type="datetime-local" className={cn("w-full max-w-full", TOUCH)} value={at} onChange={(e) => setAt(e.target.value)} />
        </div>
      ) : (
        <>
          {item.subject && <p className="break-words font-semibold text-bone">{item.subject}</p>}
          <p className={cn("whitespace-pre-wrap break-words", isCancelled ? "text-steel line-through" : "text-bone")}>{item.body}</p>
        </>
      )}
      {error && <p role="alert" className="mt-1 break-words text-xs text-critical">{error}</p>}
      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
        {isCancelled ? (
          <ConfirmDialog
            title={`Restore this ${word.toLowerCase()} to ${leadName}?`}
            body={<>Zuops sends it to {leadName} on {dateTime(item.scheduled_at)} as scheduled. {confirmCopy("changes_sending")}</>}
            confirmLabel="Restore"
            onConfirm={async (grant) => {
              if (await patch({ status: "pending" }, keys.restore, "Restored. It will go out as scheduled.", grant)) onRestored();
            }}
            trigger={
              <WriteButton type="button" size="sm" variant="secondary" disabled={pending}>
                <ArchiveRestore className="size-4" aria-hidden />Restore
              </WriteButton>
            }
          />
        ) : editing ? (
          <>
            <Button type="button" size="sm" variant="ghost" className={TOUCH} onClick={() => { setEditing(false); setText(item.body ?? ""); setError(null); }}>Discard</Button>
            <WriteButton type="button" size="sm" onClick={save} disabled={pending}>Save</WriteButton>
            <ConfirmDialog
              open={pendingEdit !== null}
              onOpenChange={(v) => { if (!v) setPendingEdit(null); }}
              title={`Save the changes to this scheduled ${word.toLowerCase()}?`}
              body={
                <>
                  Zuops sends the changed message to {leadName}
                  {typeof pendingEdit?.scheduled_at === "string" ? ` on ${dateTime(pendingEdit.scheduled_at)}` : ` on ${dateTime(item.scheduled_at)}`}. {confirmCopy("changes_sending")}
                </>
              }
              confirmLabel="Save changes"
              onConfirm={async (grant) => {
                if (!pendingEdit) return;
                if (await patch(pendingEdit, keys.edit, "Scheduled message updated", grant)) setEditing(false);
                setPendingEdit(null);
              }}
            />
          </>
        ) : (
          <>
            <WriteButton type="button" size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={item.status === "sending"}>
              <Pencil className="size-4" aria-hidden />Edit
            </WriteButton>
            <WriteButton type="button" size="sm" variant="secondary" disabled={pending || item.status === "sending"}
              onClick={async () => { if (await patch({ status: "cancelled" }, keys.cancel, "Cancelled. Restore it from the thread.")) onCancelled(); }}>
              <X className="size-4" aria-hidden />Cancel
            </WriteButton>
            <ConfirmDialog
              title={`Send this ${word.toLowerCase()} now?`}
              body={<>Zuops sends it to {leadName} right away instead of on {dateTime(item.scheduled_at)}. {confirmCopy("reaches")}</>}
              confirmLabel="Send now"
              onConfirm={async (grant) => {
                const res = await run(INBOX_OP.sendScheduledNow, { path, idem: keys.sendNow, ...grant }, { invalidate: INBOX_INVALIDATE });
                if (res.ok) { setRound((r) => r + 1); toast.success(res.status === 202 ? "Zuops will retry sending it in a couple of minutes." : `Sent to ${leadName}.`); }
                else toast.error(res.reason ?? "Zuops refused.");
              }}
              trigger={
                <WriteButton type="button" size="sm" disabled={item.status === "sending"}>
                  <Send className="size-4" aria-hidden />Send now
                </WriteButton>
              }
            />
          </>
        )}
      </div>
    </li>
  );
}

export function SuggestionCard({
  suggestion, leadName, onEditFirst,
}: {
  suggestion: ReplySuggestion;
  leadName: string;
  onEditFirst: () => void;
}) {
  const { run, pending } = useZuWrite();
  const path = { suggestion_id: suggestion.id };
  const idem = useIdemFor(`suggestion-approve:${suggestion.id}`);
  const dismissKey = useIdemFor(`suggestion-dismiss:${suggestion.id}`);
  const plan = suggestion.books
    ? `It also books ${suggestion.books.title || "an appointment"} on ${dateTime(suggestion.books.starts_at, suggestion.books.timezone)}.`
    : suggestion.cancels
      ? `It also cancels ${suggestion.cancels.title || "the appointment"} on ${dateTime(suggestion.cancels.starts_at, suggestion.cancels.timezone)}.`
      : null;
  return (
    <section aria-label="AI suggested reply" className="space-y-2 rounded-lg border border-info/40 bg-info/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-info"><Sparkles className="size-3.5" aria-hidden />AI suggested reply · {channelWord(suggestion.channel)}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-bone">{suggestion.body}</p>
      {plan && <p className="text-xs text-steel">{plan}</p>}
      {suggestion.error && <p className="text-xs text-critical">{suggestion.error}</p>}
      <div className="flex flex-wrap gap-2">
        <ConfirmDialog
          title="Send the AI's reply?"
          body={<>Zuops sends this reply to {leadName} as the AI.{plan ? ` ${plan}` : ""} {confirmCopy("reaches")}</>}
          confirmLabel="Send this"
          onConfirm={async (grant) => {
            const res = await run(INBOX_OP.approveSuggestion, { path, idem, ...grant }, { invalidate: INBOX_INVALIDATE });
            if (res.ok) toast.success(`Suggested reply sent to ${leadName}.`);
            else toast.error(res.reason ?? "Zuops did not send it.");
          }}
          trigger={<WriteButton type="button" size="sm" disabled={pending}><Send className="size-4" aria-hidden />Send this</WriteButton>}
        />
        <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={onEditFirst}>
          <Pencil className="size-4" aria-hidden />Edit first
        </Button>
        <WriteButton type="button" size="sm" variant="ghost" disabled={pending}
          onClick={async () => {
            const res = await run(INBOX_OP.dismissSuggestion, { path, idem: dismissKey }, { invalidate: [INBOX_OP.suggestions] });
            if (res.ok) toast.success("Dismissed. Nothing was sent.");
            else toast.error(res.reason ?? "Zuops refused.");
          }}>
          <X className="size-4" aria-hidden />Dismiss
        </WriteButton>
      </div>
    </section>
  );
}

function ArchiveDialog({
  open, onOpenChange, name, onArchive, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  onArchive: () => void | Promise<void>;
  pending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Archive this conversation?</DialogTitle>
          <DialogDescription>
            Archiving switches {name}&apos;s automatic follow-up texts off. A new message from them brings the conversation back. Nothing is sent.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap">
          <Button type="button" variant="ghost" className={TOUCH} onClick={() => onOpenChange(false)}>Keep it</Button>
          <WriteButton type="button" onClick={() => void onArchive()} disabled={pending}><Archive className="size-4" aria-hidden />Archive</WriteButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PauseDialog({
  open, onOpenChange, name, onPause, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  onPause: (untilIso: string | null) => void | Promise<void>;
  pending: boolean;
}) {
  const [until, setUntil] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!until) { void onPause(null); return; }
    const v = validateSchedule(until, currentTime());
    if (!v.ok) { setError(v.reason); return; }
    void onPause(v.iso);
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setUntil(""); setError(null); } }}>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Pause the AI for {name}?</DialogTitle>
            <DialogDescription>The AI stops replying to this lead, and their automatic follow-ups hold, until you resume it or the time below.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-1">
            <Label htmlFor="ai-pause-until">Turn back on at (optional, your time)</Label>
            <Input id="ai-pause-until" type="datetime-local" className={TOUCH} value={until} onChange={(e) => { setUntil(e.target.value); setError(null); }} />
            {error && <p role="alert" className="text-xs text-critical">{error}</p>}
          </DialogBody>
          <DialogFooter className="flex-wrap">
            <Button type="button" variant="ghost" className={TOUCH} onClick={() => onOpenChange(false)}>Cancel</Button>
            <WriteButton type="submit" disabled={pending}><CirclePause className="size-4" aria-hidden />Pause AI</WriteButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
