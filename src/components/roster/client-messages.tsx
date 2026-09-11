"use client";

import * as React from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Mail, MessageSquare, Send, Loader2, Link2, CheckCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_TONE = {
  sent: "positive",
  simulated: "neutral",
  failed: "critical",
  received: "info",
} as const;

const CHANNEL_LABEL: Record<string, string> = { google: "Gmail", internal: "Email", sms: "SMS", portal: "Portal" };

/** How an inbound text found this studio, when that was not certain. Exact
 *  matches and portal messages say nothing (convex/lib/smsRouting.ts). */
const ROUTED_LABEL: Record<string, string> = {
  last_texted: "Matched to your last text",
  best_guess: "Best guess, may be meant for another studio",
  assigned: "Sent on by your agency",
};

type Mode = "email" | "text" | "portal";

const MODES: { mode: Mode; label: string; icon: typeof Mail }[] = [
  { mode: "email", label: "Email", icon: Mail },
  { mode: "text", label: "Text", icon: MessageSquare },
  { mode: "portal", label: "Portal", icon: Link2 },
];

const HINT: Record<Mode, string | undefined> = {
  email: undefined,
  text: "Sent as an SMS from your studio, with a link to their portal where replies come straight to you. Standard rates apply.",
  portal: "Posted in their client portal. They get a text or email with the link, never the message itself.",
};

/** Per-client comms: compose email, text or a portal message, plus a unified
 *  history that includes replies by text and in the portal. */
export function ClientMessages({ artistId }: { artistId: Id<"artists"> }) {
  const thread = useQuery(api.clientEmail.thread, { artistId });
  const sendEmail = useAction(api.clientEmail.sendToClient);
  const sendText = useAction(api.sms.sendClientSms);
  const sendPortal = useMutation(api.messages.sendPortal);
  const markHandled = useMutation(api.messages.markHandled);

  const [mode, setMode] = React.useState<Mode>("email");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const canSend = body.trim().length > 0 && (mode !== "email" || subject.trim().length > 0) && !busy;

  // Waiting: the client wrote last and nobody has dealt with it yet.
  const latest = thread?.[0];
  const waiting = latest?.direction === "in" && !latest.handledAt;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setBusy(true);
    try {
      if (mode === "text") {
        const res = await sendText({ artistId, body: body.trim() });
        if (res.status === "opted_out") toast.error("This client has opted out of SMS.");
        else if (res.status === "simulated") toast.success("Text queued - SMS isn't connected yet.");
        else if (res.status === "sent") toast.success("Text sent.");
        else toast.error("Could not send the text.");
      } else if (mode === "portal") {
        const res = await sendPortal({ artistId, body: body.trim() });
        if (res.notified === "text") toast.success("Posted. They got a text with the link.");
        else if (res.notified === "email") toast.success("Posted. They got an email with the link.");
        else toast.success("Posted. They have no phone or email we can reach, so share their portal link yourself.");
      } else {
        const res = await sendEmail({ artistId, subject: subject.trim(), body: body.trim() });
        toast.success(res.channel === "google" ? "Sent from your Gmail." : "Sent via Pulse.");
      }
      setSubject("");
      setBody("");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not send the message.");
    } finally {
      setBusy(false);
    }
  }

  async function handled() {
    try {
      await markHandled({ artistId });
      toast.success("Marked handled.");
    } catch (err) {
      toast.error(err instanceof ConvexError ? String(err.data) : "Could not mark it handled.");
    }
  }

  return (
    <div className="space-y-4">
      {/* Compose */}
      <Card>
        <CardContent className="pt-5">
          {/* Channel toggle */}
          <div className="mb-4 inline-flex rounded-lg border border-graphite/60 bg-coal/40 p-0.5">
            {MODES.map(({ mode: m, label, icon: Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === m ? "bg-gold/15 text-bone" : "text-steel/70 hover:text-steel",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "email" && (
              <Field label="Subject" htmlFor="msg-subject">
                <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your session this week" />
              </Field>
            )}
            <Field label="Message" htmlFor="msg-body" hint={HINT[mode]}>
              <Textarea
                id="msg-body"
                rows={mode === "email" ? 4 : 3}
                maxLength={mode === "portal" ? 2000 : undefined}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={mode === "email" ? "Hi - just confirming…" : "Hey - quick heads up about your session…"}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!canSend}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {busy ? "Sending" : mode === "text" ? "Send text" : mode === "portal" ? "Post to portal" : "Send email"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {waiting && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-dim/40 bg-coal/40 px-4 py-3">
          <p className="text-sm text-bone">This client is waiting for a reply.</p>
          <Button type="button" size="sm" variant="ghost" onClick={handled}>
            <CheckCheck className="size-3.5" /> Mark handled
          </Button>
        </div>
      )}

      {/* History */}
      {thread === undefined ? (
        <p className="text-sm text-steel/70">Loading…</p>
      ) : thread.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-graphite/50 bg-coal/40 px-4 py-6 text-sm text-steel/70">
          <Mail className="size-4" /> No messages with this client yet.
        </div>
      ) : (
        <div className="space-y-2">
          {thread.map((m) => {
            const inbound = m.direction === "in";
            const routed = inbound && m.routedBy ? ROUTED_LABEL[m.routedBy] : undefined;
            return (
              <Card key={m._id} className={cn(inbound && "border-gold-dim/40")}>
                <CardContent className="space-y-1 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-grotesk text-sm font-semibold text-bone">
                      {inbound ? "↩ Client reply" : m.subject}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {inbound && m.handledAt && <Badge tone="neutral">Handled</Badge>}
                      <Badge tone="neutral">{CHANNEL_LABEL[m.channel] ?? m.channel}</Badge>
                      <Badge tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? "neutral"}>{m.status}</Badge>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-steel">{m.body}</p>
                  <p className="text-[0.6875rem] text-steel/70">
                    {new Date(m._creationTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {routed && <span className={cn(m.routedBy === "best_guess" && "text-gold")}> · {routed}</span>}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
