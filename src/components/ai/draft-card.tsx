"use client";

import * as React from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id, Doc } from "@convex/_generated/dataModel";
import { Sparkles, Copy, Check, Mail, Eye, EyeOff, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SimpleMarkdown } from "@/components/ai/simple-markdown";
import { cn } from "@/lib/utils";

/** Single Pulse Agent artifact rendered with copy + dismiss + ack actions.
 * Works for recaps, prep packets, reminders, briefings, rate-cut promos -
 * anything in the aiArtifacts table. */
export function AiDraftCard({
  artifact,
  defaultExpanded,
  className,
}: {
  artifact: Doc<"aiArtifacts">;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const setStatus = useMutation(api.aiArtifacts.setStatus);
  const sendDraft = useAction(api.agent.sendArtifactDraft);
  const [expanded, setExpanded] = React.useState(defaultExpanded ?? false);
  const [copied, setCopied] = React.useState<"body" | "email" | null>(null);
  const [sending, setSending] = React.useState(false);

  // Merged (token-substituted) view of the email draft. The raw draft body
  // carries privacy merge tokens like {{user_FirstName}} - the model never
  // sees the real client name - so everything user-facing here (preview,
  // send, mailto fallback, copy) uses the server-merged copy instead.
  const merged = useQuery(
    api.agent.mergedDraftEmail,
    expanded && artifact.emailDraft ? { artifactId: artifact._id } : "skip",
  );
  const emailBody = merged?.body ?? artifact.emailDraft?.body ?? "";
  const emailSubject = merged?.subject ?? artifact.emailDraft?.subject ?? "";

  async function send() {
    setSending(true);
    try {
      const res = await sendDraft({ artifactId: artifact._id });
      if (res.ok) toast.success(res.channel === "google" ? "Sent from your Gmail." : "Sent.");
      else toast.error("Send failed. Try again or use your mail app.");
    } catch (err) {
      // ConvexError carries its human-readable message in .data.
      const data = err && typeof err === "object" && "data" in err ? (err as { data?: unknown }).data : null;
      toast.error(typeof data === "string" ? data : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  async function copy(kind: "body" | "email", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success("Copied.");
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed.");
    }
  }

  async function ack() {
    try {
      await setStatus({ id: artifact._id, status: "acknowledged" });
    } catch {
      toast.error("Could not acknowledge.");
    }
  }

  async function dismiss() {
    try {
      await setStatus({ id: artifact._id, status: "dismissed" });
    } catch {
      toast.error("Could not dismiss.");
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-graphite/50 bg-coal p-4 shadow-elev-1",
        artifact.status === "acknowledged" && "opacity-70",
        artifact.status === "dismissed" && "opacity-50",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-gold/15 text-gold">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-grotesk text-sm font-semibold text-bone">
                {artifact.title}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-steel">
                {artifact.summary}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <Badge
                tone={artifact.source === "openai" ? "gold" : "neutral"}
                className="shrink-0"
              >
                {artifact.source === "openai" ? "AI" : "Draft"}
              </Badge>
            </div>
          </div>

          {(artifact.body || artifact.emailDraft) && (
            <div className="mt-3 space-y-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <>
                    <EyeOff className="size-3.5" /> Hide details
                  </>
                ) : (
                  <>
                    <Eye className="size-3.5" /> Show details
                  </>
                )}
              </Button>

              {expanded && artifact.body && (
                <div className="rounded-md border border-graphite/50 bg-coal-2 p-3">
                  <SimpleMarkdown text={artifact.body} />
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copy("body", artifact.body!)}
                    >
                      {copied === "body" ? (
                        <>
                          <Check className="size-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {expanded && artifact.emailDraft && (
                <div className="rounded-md border border-graphite/50 bg-coal-2 p-3">
                  <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                    Email draft
                  </p>
                  {artifact.emailDraft.to && (
                    <p className="mt-1 text-xs text-steel">
                      <span className="text-steel/70">To:</span>{" "}
                      {artifact.emailDraft.to}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs font-medium text-bone">
                    {emailSubject}
                  </p>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-steel">
                    {emailBody}
                  </pre>
                  <div className="mt-2 flex justify-end gap-2">
                    {merged?.canSend && (
                      <Button size="sm" onClick={send} disabled={sending}>
                        <Send className="size-3.5" /> {sending ? "Sending..." : "Send"}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!merged}
                      onClick={() => {
                        // Fallback path: hand off to the user's mail app - with
                        // merge tokens already substituted server-side.
                        if (!merged) return;
                        const to = merged.to ?? artifact.emailDraft!.to ?? "";
                        const subject = encodeURIComponent(merged.subject);
                        const body = encodeURIComponent(merged.body);
                        window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
                      }}
                    >
                      <Mail className="size-3.5" /> Open in mail
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copy("email", `${emailSubject}\n\n${emailBody}`)}
                    >
                      {copied === "email" ? (
                        <>
                          <Check className="size-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" /> Copy email
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {artifact.status === "ready" && (
            <div className="mt-3 flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={ack}>
                <Check className="size-3.5" /> Mark read
              </Button>
              <Button variant="ghost" size="sm" onClick={dismiss}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Empty-list helper. */
export function NoArtifactsYet({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-dashed border-graphite/60 py-6 text-center text-xs text-steel/70">
      <Sparkles className="mx-auto mb-2 size-4 text-gold-dim" />
      {message}
    </div>
  );
}

export type AiArtifact = Doc<"aiArtifacts">;
export type AiArtifactId = Id<"aiArtifacts">;
