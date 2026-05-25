"use client";

import * as React from "react";
import { useQuery, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Mail, MessageSquare, Send, Loader2 } from "lucide-react";
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

const CHANNEL_LABEL: Record<string, string> = { google: "Gmail", internal: "Email", sms: "SMS" };

/** Per-client comms: compose email or text, plus a unified history that
 *  includes inbound SMS replies. */
export function ClientMessages({ artistId }: { artistId: Id<"artists"> }) {
  const thread = useQuery(api.clientEmail.thread, { artistId });
  const sendEmail = useAction(api.clientEmail.sendToClient);
  const sendText = useAction(api.sms.sendClientSms);

  const [mode, setMode] = React.useState<"email" | "text">("email");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const canSend = body.trim().length > 0 && (mode === "text" || subject.trim().length > 0) && !busy;

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

  return (
    <div className="space-y-4">
      {/* Compose */}
      <Card>
        <CardContent className="pt-5">
          {/* Channel toggle */}
          <div className="mb-4 inline-flex rounded-lg border border-hairline-2 bg-coal/40 p-0.5">
            {(["email", "text"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  mode === m ? "bg-gold/15 text-bone" : "text-ash-dim hover:text-ash",
                )}
              >
                {m === "email" ? <Mail className="size-3.5" /> : <MessageSquare className="size-3.5" />}
                {m === "email" ? "Email" : "Text"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "email" && (
              <Field label="Subject" htmlFor="msg-subject">
                <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your session this week" />
              </Field>
            )}
            <Field
              label="Message"
              htmlFor="msg-body"
              hint={mode === "text" ? "Sent as an SMS from your studio. Standard rates apply." : undefined}
            >
              <Textarea id="msg-body" rows={mode === "text" ? 3 : 4} value={body} onChange={(e) => setBody(e.target.value)} placeholder={mode === "text" ? "Hey - quick heads up about your session…" : "Hi - just confirming…"} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!canSend}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {busy ? "Sending" : mode === "text" ? "Send text" : "Send email"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* History */}
      {thread === undefined ? (
        <p className="text-sm text-ash-dim">Loading…</p>
      ) : thread.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-hairline bg-coal/40 px-4 py-6 text-sm text-ash-dim">
          <Mail className="size-4" /> No messages with this client yet.
        </div>
      ) : (
        <div className="space-y-2">
          {thread.map((m) => {
            const inbound = m.direction === "in";
            return (
              <Card key={m._id} className={cn(inbound && "border-gold-dim/40")}>
                <CardContent className="space-y-1 pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display text-sm font-semibold text-bone">
                      {inbound ? "↩ Client reply" : m.subject}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone="neutral">{CHANNEL_LABEL[m.channel] ?? m.channel}</Badge>
                      <Badge tone={STATUS_TONE[m.status as keyof typeof STATUS_TONE] ?? "neutral"}>{m.status}</Badge>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-ash">{m.body}</p>
                  <p className="text-[0.6875rem] text-ash-dim">
                    {new Date(m._creationTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
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
