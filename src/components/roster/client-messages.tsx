"use client";

import * as React from "react";
import { useQuery, useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Mail, Send, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";

const STATUS_TONE = { sent: "positive", simulated: "neutral", failed: "critical" } as const;

/** Per-client email: compose + send (Gmail or internal Pulse) and a history. */
export function ClientMessages({ artistId }: { artistId: Id<"artists"> }) {
  const thread = useQuery(api.clientEmail.thread, { artistId });
  const send = useAction(api.clientEmail.sendToClient);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !body.trim() || busy) return;
    setBusy(true);
    try {
      const res = await send({ artistId, subject: subject.trim(), body: body.trim() });
      toast.success(
        res.channel === "google" ? "Sent from your Gmail." : "Sent via Pulse.",
      );
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
          <form onSubmit={submit} className="space-y-3">
            <Field label="Subject" htmlFor="msg-subject">
              <Input id="msg-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your session this week" />
            </Field>
            <Field label="Message" htmlFor="msg-body">
              <Textarea id="msg-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi — just confirming…" />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!subject.trim() || !body.trim() || busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {busy ? "Sending" : "Send email"}
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
          <Mail className="size-4" /> No emails sent to this client yet.
        </div>
      ) : (
        <div className="space-y-2">
          {thread.map((m) => (
            <Card key={m._id}>
              <CardContent className="space-y-1 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-sm font-semibold text-bone">{m.subject}</p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge tone="neutral">{m.channel === "google" ? "Gmail" : "Pulse"}</Badge>
                    <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm text-ash">{m.body}</p>
                <p className="text-[0.6875rem] text-ash-dim">
                  {new Date(m._creationTime).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
