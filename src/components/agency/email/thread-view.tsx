"use client";

import * as React from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { AlertCircle, Archive, ArrowLeft, Download01, Image01, Inbox01, Paperclip, ReverseLeft, Send01 } from "@untitledui/icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea, Input } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { EMAIL_IFRAME_SANDBOX, emailSrcDoc, hasRemoteImages } from "@/lib/email-html";
import { splitAddresses, type MailboxOption } from "./email-dialogs";

type ThreadData = NonNullable<ReturnType<typeof useThread>>;
type Message = ThreadData["messages"][number];

function useThread(threadId: Id<"mailThreads">) {
  return useQuery(api.mail.getThread, { threadId });
}

const SEND_TONE = { sending: "info", accepted: "positive", rejected: "critical", unknown: "caution" } as const;
const SEND_LABEL = { sending: "Sending", accepted: "Sent", rejected: "Not sent", unknown: "Check in Resend" } as const;

function formatSize(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function MessageBody({ m }: { m: Message }) {
  const [images, setImages] = React.useState(false);
  if (m.bodyStatus === "pending") {
    return <p className="text-sm text-steel">Fetching the full message from Resend. It will appear here shortly.</p>;
  }
  if (m.html) {
    const remote = hasRemoteImages(m.html);
    return (
      <div className="space-y-2">
        {remote && !images && (
          <button
            type="button" onClick={() => setImages(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-graphite/60 px-2.5 py-1 text-xs text-steel transition-colors hover:text-bone"
          >
            <Image01 className="size-3.5" aria-hidden /> Images are hidden to block tracking. Load images
          </button>
        )}
        <iframe
          title={`Message from ${m.from}`}
          sandbox={EMAIL_IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={emailSrcDoc(m.html, { allowRemoteImages: images })}
          className="h-[420px] w-full rounded-md border border-graphite/40 bg-white"
        />
        {m.htmlTruncated && <p className="text-xs text-steel/70">This message was very long and was cut short.</p>}
      </div>
    );
  }
  return <p className="whitespace-pre-wrap break-words text-sm text-bone">{m.text ?? "(no content)"}</p>;
}

function Attachments({ m }: { m: Message }) {
  const convex = useConvex();
  if (m.attachments.length === 0) return null;
  async function open(index: number) {
    try {
      const url = await convex.query(api.mail.attachmentUrl, { messageId: m._id, index });
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.error("That file is not available.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not open that file."));
    }
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {m.attachments.map((a) => (
        <li key={a.index}>
          {a.status === "stored" ? (
            <button type="button" onClick={() => open(a.index)} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-graphite/60 px-2.5 py-1 text-xs text-bone hover:border-gold">
              <Download01 className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{a.filename}</span> <span className="text-steel/70">{formatSize(a.size)}</span>
            </button>
          ) : (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-graphite/40 px-2.5 py-1 text-xs text-steel" title={a.note ?? undefined}>
              <Paperclip className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{a.filename}</span>
              <span className="text-steel/70">{a.status === "pending" ? "copying" : a.note ?? a.status}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ThreadView({ threadId, mailboxes, onBack, onMoved }: {
  threadId: Id<"mailThreads">;
  mailboxes: MailboxOption[];
  onBack: () => void;
  onMoved?: (mailboxId: Id<"mailboxes">) => void;
}) {
  const data = useThread(threadId);
  const markRead = useMutation(api.mail.markThreadRead);
  const setStatus = useMutation(api.mail.setThreadStatus);
  const move = useMutation(api.mail.moveThread);
  const send = useMutation(api.mail.send);
  const [body, setBody] = React.useState("");
  const [to, setTo] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const unread = data?.messages.some((m) => !m.read) ?? false;
  React.useEffect(() => {
    if (unread) markRead({ threadId }).catch(() => undefined);
  }, [unread, threadId, markRead]);

  if (data === undefined) return <p className="p-4 text-sm text-steel/70">Loading the conversation</p>;
  if (data === null) return <p className="p-4 text-sm text-steel/70">This conversation is not available.</p>;

  const lastInbound = [...data.messages].reverse().find((m) => m.direction === "in");
  const defaultTo = lastInbound?.fromAddress ?? data.thread.participants[0] ?? "";
  const recipients = to ?? defaultTo;

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    if (!data?.mailbox) return;
    setBusy(true);
    try {
      await send({ mailboxId: data.mailbox._id, threadId, to: splitAddresses(recipients), body });
      setBody("");
      toast.success("Sending.");
    } catch (err) {
      toast.error(errorMessage(err, "That did not send."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start gap-2">
        <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to conversations" className="lg:hidden">
          <ArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="break-words font-grotesk text-lg font-semibold text-bone">{data.thread.subject}</h2>
          <p className="text-xs text-steel">
            {data.mailbox ? `${data.mailbox.displayName} · ${data.mailbox.address}` : `Unrouted · sent to ${data.thread.originalRecipients.join(", ") || "an unknown address"}`}
          </p>
        </div>
        <Button
          type="button" variant="outline" size="sm"
          onClick={() => setStatus({ threadId, status: data.thread.status === "archived" ? "open" : "archived" }).catch((err) => toast.error(errorMessage(err)))}
        >
          {data.thread.status === "archived" ? <><Inbox01 aria-hidden /> Move to inbox</> : <><Archive aria-hidden /> Archive</>}
        </Button>
      </div>

      {!data.mailbox && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-caution/30 bg-caution/5 p-3 text-sm text-bone">
          <AlertCircle className="size-4 text-caution" aria-hidden />
          <span className="flex-1">No inbox has this address. Move it to one to reply.</span>
          <Select onValueChange={(id) => move({ threadId, mailboxId: id as Id<"mailboxes"> }).then(() => { toast.success("Moved."); onMoved?.(id as Id<"mailboxes">); }).catch((err) => toast.error(errorMessage(err)))}>
            <SelectTrigger className="w-full sm:w-56" aria-label="Move to inbox"><SelectValue placeholder="Move to inbox" /></SelectTrigger>
            <SelectContent>
              {mailboxes.map((m) => <SelectItem key={m._id} value={m._id}>{m.displayName}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <ol className="space-y-3">
        {data.messages.map((m) => (
          <li key={m._id} className={`space-y-3 rounded-lg border p-3 sm:p-4 ${m.direction === "out" ? "border-gold-dim/30 bg-gold/[0.03]" : "border-graphite/50 bg-coal/40"}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="min-w-0 break-words text-sm font-medium text-bone">{m.from}</p>
              <p className="text-xs tabular-nums text-steel/70">{new Date(m.at).toLocaleString()}</p>
            </div>
            <p className="break-words text-xs text-steel">
              To {m.to.join(", ")}{m.cc.length ? ` · Cc ${m.cc.join(", ")}` : ""}
            </p>
            {m.sendStatus && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={SEND_TONE[m.sendStatus]}>{SEND_LABEL[m.sendStatus]}</Badge>
                {m.sendError && <span className="text-xs text-steel">{m.sendError}</span>}
              </div>
            )}
            {m.direction === "in" && m.authentication?.dmarc && m.authentication.dmarc !== "pass" && (
              <p className="flex items-center gap-1.5 text-xs text-caution"><AlertCircle className="size-3.5" aria-hidden /> The sender could not be verified (DMARC {m.authentication.dmarc}). Be careful with links.</p>
            )}
            <MessageBody m={m} />
            <Attachments m={m} />
          </li>
        ))}
      </ol>

      {data.mailbox && (
        <form onSubmit={reply} className="space-y-2 rounded-lg border border-graphite/50 bg-coal/40 p-3 sm:p-4">
          <div className="flex items-center gap-2 text-xs text-steel">
            <ReverseLeft className="size-3.5" aria-hidden /> Reply as {data.mailbox.fromName} &lt;{data.mailbox.address}&gt;
          </div>
          <Input aria-label="Reply to" value={recipients} onChange={(e) => setTo(e.target.value)} inputMode="email" autoComplete="off" />
          <Textarea aria-label="Reply" rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a reply" />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy || !body.trim() || !recipients.trim()}>
              <Send01 aria-hidden /> {busy ? "Sending" : "Send reply"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
