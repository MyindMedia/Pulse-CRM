"use client";

import * as React from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ThreadMessage } from "@convex/messageInbox";
import { toast } from "sonner";
import { Mail, MessageSquare, Send, Loader2, Link2, CheckCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/* The conversation with one client, laid out like a phone's messages app:
   the client on the left, the studio on the right in its accent colour, the
   newest at the bottom beside the composer. Used on the Messages page and on
   each client's Messages tab. */

const CHANNEL_LABEL: Record<string, string> = { google: "Gmail", internal: "Email", sms: "Text", portal: "Portal" };

/** How an inbound text found this studio, when that was not certain (convex/lib/smsRouting.ts). */
const ROUTED_LABEL: Record<string, string> = {
  last_texted: "Matched to your last text",
  best_guess: "Best guess, may be meant for another studio",
  assigned: "Sent on by your agency",
};

const STATUS_LABEL: Record<string, string> = { sent: "Delivered", simulated: "Not sent, SMS is off", failed: "Failed" };

const time = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function dayLabel(at: number) {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function authorLabel(m: ThreadMessage) {
  if (!m.author) return null;
  if (m.author.kind === "agent") return "Pulse agent";
  if (m.author.kind === "auto") return "Automatic";
  return m.author.name;
}

/** The waiting banner plus the bubbles. Scrolls itself to the newest message. */
export function ChatThread({ artistId, className }: { artistId: Id<"artists">; className?: string }) {
  const thread = useQuery(api.messageInbox.thread, { artistId });
  const markHandled = useMutation(api.messages.markHandled);
  const scroller = React.useRef<HTMLDivElement>(null);
  const count = thread?.length ?? 0;

  React.useEffect(() => {
    // Scroll the thread's own box, never the page around it.
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, artistId]);

  const latest = thread?.[thread.length - 1];
  const waiting = latest?.direction === "in" && !latest.handledAt;

  async function handled() {
    try {
      await markHandled({ artistId });
      toast.success("Marked handled.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not mark it handled.");
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {thread === undefined ? (
          <p className="text-sm text-steel/70">Loading…</p>
        ) : thread.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center text-sm text-steel/70">
            <Mail className="size-5" />
            No messages with this client yet. Say hello below.
          </div>
        ) : (
          <ol className="space-y-2">
            {thread.map((m, i) => {
              const prev = thread[i - 1];
              const newDay = !prev || dayLabel(prev._creationTime) !== dayLabel(m._creationTime);
              return (
                <React.Fragment key={m._id}>
                  {newDay && (
                    <li className="flex items-center gap-3 py-2 text-[0.6875rem] font-medium uppercase tracking-wider text-steel/60">
                      <span className="h-px flex-1 bg-graphite/50" />
                      {dayLabel(m._creationTime)}
                      <span className="h-px flex-1 bg-graphite/50" />
                    </li>
                  )}
                  <Bubble m={m} />
                </React.Fragment>
              );
            })}
          </ol>
        )}
      </div>
      {waiting && (
        <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gold-dim/40 bg-coal/60 px-3 py-2 sm:mx-6">
          <p className="text-xs text-bone">This client is waiting for a reply.</p>
          <Button type="button" size="sm" variant="ghost" onClick={handled}>
            <CheckCheck className="size-3.5" /> Mark handled
          </Button>
        </div>
      )}
    </div>
  );
}

function Bubble({ m }: { m: ThreadMessage }) {
  const inbound = m.direction === "in";
  const agent = m.author?.kind === "agent";
  const routed = inbound && m.routedBy ? ROUTED_LABEL[m.routedBy] : undefined;
  const isEmail = m.channel === "google" || m.channel === "internal";
  const meta = inbound
    ? [CHANNEL_LABEL[m.channel], time(m._creationTime), m.handledAt ? "Handled" : null]
    : [authorLabel(m), CHANNEL_LABEL[m.channel], STATUS_LABEL[m.status] ?? null, time(m._creationTime)];

  return (
    <li className={cn("flex flex-col", inbound ? "items-start" : "items-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]",
          inbound
            ? "rounded-bl-md border border-graphite/50 bg-coal-2 text-bone"
            : agent
              ? "rounded-br-md border border-gold-dim/50 bg-gold/10 text-bone"
              : "rounded-br-md bg-gradient-to-br from-gold to-gold-deep text-gold-ink",
          m.status === "failed" && "opacity-60",
        )}
      >
        {agent && (
          <p className="mb-0.5 flex items-center gap-1 text-[0.6875rem] font-semibold text-gold">
            <Sparkles className="size-3" /> Pulse agent
          </p>
        )}
        {isEmail && m.subject && <p className="mb-0.5 font-semibold">{m.subject}</p>}
        <p className="whitespace-pre-wrap break-words">{m.body}</p>
      </div>
      <p className="mt-1 px-1 text-[0.6875rem] text-steel/60">
        {meta.filter(Boolean).join(" · ")}
        {routed && <span className={cn(m.routedBy === "best_guess" && "text-gold")}> · {routed}</span>}
      </p>
    </li>
  );
}

type Mode = "text" | "email" | "portal";

const MODES: { mode: Mode; label: string; icon: typeof Mail }[] = [
  { mode: "text", label: "Text", icon: MessageSquare },
  { mode: "email", label: "Email", icon: Mail },
  { mode: "portal", label: "Portal", icon: Link2 },
];

const HINT: Record<Mode, string> = {
  text: "Texted from your studio's Pulse number, with a link to their portal.",
  email: "Sent from your connected Gmail, or from Pulse.",
  portal: "Posted in their client portal. They get a text or email with the link.",
};

/** Text, email or portal message to one client, pinned under the thread. */
export function ChatComposer({ artistId, className }: { artistId: Id<"artists">; className?: string }) {
  const sendEmail = useAction(api.clientEmail.sendToClient);
  const sendText = useAction(api.sms.sendClientSms);
  const sendPortal = useMutation(api.messages.sendPortal);

  const [mode, setMode] = React.useState<Mode>("text");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const box = React.useRef<HTMLTextAreaElement>(null);

  const canSend = body.trim().length > 0 && (mode !== "email" || subject.trim().length > 0) && !busy;

  // Grow with the message, up to about six lines.
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [body]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      if (mode === "text") {
        const res = await sendText({ artistId, body: body.trim() });
        if (res.status === "opted_out") return void toast.error("This client has opted out of texts.");
        if (res.status === "simulated") toast.success("Saved, but SMS isn't connected, so nothing was sent.");
        else if (res.status !== "sent") return void toast.error("Could not send the text.");
      } else if (mode === "portal") {
        const res = await sendPortal({ artistId, body: body.trim() });
        if (res.notified === "none") toast.success("Posted. They have no phone or email we can reach, so share their portal link yourself.");
      } else {
        await sendEmail({ artistId, subject: subject.trim(), body: body.trim() });
      }
      setSubject("");
      setBody("");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not send the message.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className={cn("border-t border-graphite/50 bg-coal/40 px-4 py-3 sm:px-6", className)}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-graphite/60 bg-coal/60 p-0.5" role="tablist" aria-label="Send as">
          {MODES.map(({ mode: m, label, icon: Icon }) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                mode === m ? "bg-gold/15 text-bone" : "text-steel/70 hover:text-steel",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        <p className="min-w-0 flex-1 truncate text-[0.6875rem] text-steel/60">{HINT[mode]}</p>
      </div>
      {mode === "email" && (
        <Input
          aria-label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="mb-2"
        />
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={box}
          aria-label="Message"
          rows={1}
          maxLength={mode === "portal" ? 2000 : undefined}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && mode !== "email") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={mode === "email" ? "Write an email…" : "Type a message…"}
          className="min-h-10 flex-1 resize-none rounded-xl border border-graphite/60 bg-obsidian px-3.5 py-2.5 text-sm text-bone outline-none placeholder:text-steel/50 focus-visible:border-gold/60 focus-visible:ring-2 focus-visible:ring-gold/20"
        />
        <Button type="submit" size="icon" disabled={!canSend} aria-label={mode === "text" ? "Send text" : mode === "portal" ? "Post to portal" : "Send email"}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </form>
  );
}
