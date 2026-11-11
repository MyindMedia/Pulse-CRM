"use client";

import * as React from "react";
import { toast } from "sonner";
import { CalendarClock, Lightbulb, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { useCrm } from "./crm-context";
import { ConfirmDialog, TOUCH, WriteButton, dateTime, phone, type ConfirmGrant } from "./crm-ui";
import { useZuWrite, type ZuLimits } from "./use-zu";
import { useNow } from "./inbox-clock";
import { INBOX_OP } from "./inbox-ops";
import {
  MAX_SCHEDULE_DAYS, draftProblem, sendRequest, toLocalInput, validateSchedule,
  type ChannelOption, type ComposerDraft,
} from "./inbox-logic";
import type { ReplyIdea, ReplyIdeasResponse } from "./inbox-types";

/* The composer (design D6, eval X-02, X-05). Nothing is sent from a key press or a
   button click on its own: Send and Schedule open one ConfirmDialog that says
   exactly what will happen, and only its confirm button runs the send, carrying
   the grant it hands over. The draft (and its Idempotency-Key) lives in the
   thread's React state only. */

export const INBOX_INVALIDATE = [INBOX_OP.thread, INBOX_OP.conversations, INBOX_OP.scheduled, INBOX_OP.suggestions] as const;

export type ComposerRecipient = {
  leadId: string;
  name: string;
  phone: string | null;
  email: string | null;
};

export function recipientLine(channel: ComposerDraft["channel"], to: ComposerRecipient): string {
  switch (channel) {
    case "sms": return `${to.name} at ${phone(to.phone) || "their phone"}`;
    case "email": return `${to.name} at ${to.email || "their email"}`;
    case "instagram": return `${to.name} in their Instagram conversation`;
    case "messenger": return `${to.name} in their Messenger conversation`;
  }
}

export function senderLine(channel: ComposerDraft["channel"], fromNumber: string | null): string {
  switch (channel) {
    case "sms": return fromNumber ? `from ${phone(fromNumber)}` : "from your Zuops number";
    case "email": return "from your Zuops sending address";
    case "instagram": return "through your connected Instagram account";
    case "messenger": return "through your connected Facebook Page";
  }
}

const NOUN: Record<ComposerDraft["channel"], string> = { sms: "text", email: "email", instagram: "Instagram reply", messenger: "Messenger reply" };

export function InboxComposer({
  to,
  options,
  draft,
  onDraft,
  onSent,
  fromNumber,
  slots,
  frozenReason,
  onLimits,
}: {
  to: ComposerRecipient;
  options: ChannelOption[];
  draft: ComposerDraft;
  onDraft: (patch: Partial<Omit<ComposerDraft, "idem">>) => void;
  /** After Zuops accepted the send: the thread starts a new draft (new key). */
  onSent: () => void;
  fromNumber: string | null;
  slots: { remaining: number; cap: number | null } | null;
  frozenReason?: string | null;
  onLimits?: (limits: ZuLimits) => void;
}) {
  const { canWrite } = useCrm();
  const { run, pending } = useZuWrite();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [scheduling, setScheduling] = React.useState(draft.sendAt !== "");
  const [error, setError] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState<string | null>(null);
  const [ideas, setIdeas] = React.useState<ReplyIdea[] | null>(null);
  const [ideasBusy, setIdeasBusy] = React.useState(false);

  const option = options.find((o) => o.channel === draft.channel);
  const now = useNow(5_000);
  const problem = draftProblem(draft, option, now);
  const anyAvailable = options.some((o) => o.available);
  const noun = NOUN[draft.channel];
  const when = draft.sendAt ? validateSchedule(draft.sendAt, now) : null;
  const ids = { text: `cmp-text-${to.leadId}`, subject: `cmp-subject-${to.leadId}`, at: `cmp-at-${to.leadId}`, err: `cmp-err-${to.leadId}` };

  const edit = (patch: Partial<Omit<ComposerDraft, "idem">>) => {
    setError(null);
    setShown(null);
    onDraft(patch);
  };

  /** Runs only from ConfirmDialog's onConfirm, with the grant it made. */
  const sendWithGrant = async (grant: ConfirmGrant) => {
    const req = sendRequest(draft, to.leadId, grant, now);
    const res = await run(req.op, req.args, { invalidate: INBOX_INVALIDATE });
    if (res.limits) onLimits?.(res.limits);
    if (res.ok) {
      toast.success(draft.sendAt && when?.ok ? `Scheduled for ${dateTime(when.ms)}. Edit or cancel it from the thread.` : `Sent to ${to.name}.`);
      setScheduling(false);
      setIdeas(null);
      onSent();
      return;
    }
    // The same key is kept, so pressing Send again is a safe retry.
    setError(res.reason ?? "Zuops refused the message.");
  };

  const askForConfirm = () => {
    if (problem) {
      setShown(problem);
      return;
    }
    setConfirmOpen(true);
  };

  const loadIdeas = async () => {
    setIdeasBusy(true);
    setError(null);
    const res = await run(INBOX_OP.replyIdeas, { path: { lead_id: to.leadId }, body: { channel: draft.channel } });
    setIdeasBusy(false);
    if (!res.ok) {
      setError(res.reason ?? "Zuops could not write reply ideas.");
      return;
    }
    const data = res.data as ReplyIdeasResponse | undefined;
    const list = (data?.replies ?? []).filter((r) => r.text);
    setIdeas(list);
    if (!list.length) toast.info("Zuops had no reply ideas for this conversation.");
  };

  const title = draft.suggestionId
    ? "Send this edited AI reply?"
    : draft.sendAt ? `Schedule this ${noun}?` : `Send this ${noun}?`;
  const confirmBody = (
    <div className="space-y-2">
      <p>
        {draft.suggestionId
          ? <>Zuops sends your edited version of the AI reply to {recipientLine(draft.channel, to)}, and makes any booking or cancellation it suggested.</>
          : draft.sendAt && when?.ok
            ? <>Zuops sends it to {recipientLine(draft.channel, to)} {senderLine(draft.channel, fromNumber)} on {dateTime(when.ms)}. You can edit or cancel it until then.</>
            : <>Send this {noun} to {recipientLine(draft.channel, to)} {senderLine(draft.channel, fromNumber)}?</>}
      </p>
      <p className="line-clamp-4 whitespace-pre-wrap break-words rounded-md border border-graphite/50 bg-coal/40 p-2 text-bone">{draft.text.trim()}</p>
      <p className="text-xs">It reaches a real person. It counts against today&apos;s contact limit and uses credits, except Instagram and Messenger replies.</p>
    </div>
  );

  const slotLine = slots
    ? `${slots.remaining.toLocaleString("en-US")}${slots.cap !== null ? ` of ${slots.cap.toLocaleString("en-US")}` : ""} contacts left today`
    : null;

  return (
    <section aria-label={`Write to ${to.name}`} className="space-y-3 rounded-lg border border-graphite/50 bg-coal/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Channel" className="flex flex-wrap gap-1">
          {options.map((o) => (
            <Button
              key={o.channel} type="button" size="sm" variant={o.channel === draft.channel ? "primary" : "secondary"}
              className={TOUCH} aria-pressed={o.channel === draft.channel}
              onClick={() => edit({ channel: o.channel })}
              title={o.reason ?? undefined}
            >
              {o.label}
              {!o.available && <span className="text-[0.6875rem] font-normal opacity-80">(off)</span>}
            </Button>
          ))}
        </div>
        <span className="min-w-0 flex-1 text-xs text-steel">{senderLine(draft.channel, fromNumber).replace(/^./, (c) => c.toUpperCase())}</span>
        {slotLine && <span className="text-xs tabular-nums text-steel">{slotLine}</span>}
      </div>

      {option && !option.available && (
        <p role="status" className="text-sm text-caution">{option.reason}</p>
      )}
      {frozenReason && <p role="status" className="text-sm text-caution">Sending is paused in Zuops: {frozenReason}</p>}
      {!canWrite && <p className="text-xs text-steel">Read only here. Sending is off on this deployment.</p>}
      {draft.suggestionId && (
        <p className="flex items-center gap-2 text-xs text-info">
          Editing an AI suggestion. Sending approves it with your changes.
          <button type="button" className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-gold" onClick={() => edit({ suggestionId: null })}>
            Send as a new message instead
          </button>
        </p>
      )}

      {draft.channel === "email" && !draft.suggestionId && (
        <div className="space-y-1">
          <Label htmlFor={ids.subject}>Subject</Label>
          <Input id={ids.subject} className={TOUCH} value={draft.subject} maxLength={200} onChange={(e) => edit({ subject: e.target.value })} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor={ids.text}>Message</Label>
        <Textarea
          id={ids.text} value={draft.text} rows={3} placeholder={`Write a ${noun}`}
          aria-describedby={shown || error ? ids.err : undefined}
          onChange={(e) => edit({ text: e.target.value })}
        />
        <p className="text-[0.6875rem] text-steel/80">
          Variables: {"{first_name}"}, {"{full_name}"}, {"{business_name}"}. Zuops fills them in for this lead. Nothing is sent until you confirm.
        </p>
      </div>

      {scheduling && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={ids.at}>Send at (your time)</Label>
            <Input
              id={ids.at} type="datetime-local" className={cn("w-auto", TOUCH)} value={draft.sendAt}
              min={toLocalInput(now + 120_000)} max={toLocalInput(now + MAX_SCHEDULE_DAYS * 86_400_000)}
              onChange={(e) => edit({ sendAt: e.target.value })}
            />
          </div>
          <Button type="button" variant="ghost" size="sm" className={TOUCH} onClick={() => { setScheduling(false); edit({ sendAt: "" }); }}>
            <X className="size-4" aria-hidden />Send now instead
          </Button>
        </div>
      )}

      {(shown || error) && <p id={ids.err} role="alert" className="text-sm text-critical">{error ?? shown}</p>}

      {ideas && ideas.length > 0 && (
        <div className="space-y-2">
          <p className="overline">Reply ideas</p>
          <ul className="space-y-2">
            {ideas.map((idea, i) => (
              <li key={i} className="flex flex-wrap items-start gap-2 rounded-md border border-graphite/50 p-2 text-sm">
                <span className="min-w-0 flex-1">
                  {idea.label && <span className="block text-xs font-semibold text-bone">{idea.label}</span>}
                  <span className="block whitespace-pre-wrap break-words text-steel">{idea.text}</span>
                </span>
                <Button type="button" size="sm" variant="secondary" className={TOUCH} onClick={() => { edit({ text: idea.text ?? "" }); setIdeas(null); }}>
                  Use this
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <WriteButton type="button" variant="ghost" size="sm" onClick={loadIdeas} disabled={ideasBusy || pending}>
          <Lightbulb className="size-4" aria-hidden />{ideasBusy ? "Thinking" : "Reply ideas"}
        </WriteButton>
        {!scheduling && draft.channel !== "instagram" && draft.channel !== "messenger" && !draft.suggestionId && (
          <WriteButton type="button" variant="secondary" size="sm" onClick={() => setScheduling(true)} disabled={!anyAvailable}>
            <CalendarClock className="size-4" aria-hidden />Schedule
          </WriteButton>
        )}
        <WriteButton type="button" size="sm" onClick={askForConfirm} disabled={pending || !anyAvailable}>
          <Send className="size-4" aria-hidden />{pending ? "Sending" : draft.sendAt ? "Schedule" : "Send"}
        </WriteButton>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={title}
        body={confirmBody}
        confirmLabel={draft.sendAt ? `Schedule ${noun}` : `Send ${noun}`}
        onConfirm={(grant) => sendWithGrant(grant)}
      />
    </section>
  );
}
