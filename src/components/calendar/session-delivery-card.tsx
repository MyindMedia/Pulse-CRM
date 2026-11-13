"use client";

import { useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Link2, Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { money, shortDate, timeOfDay } from "@/lib/format";
import { cn } from "@/lib/utils";

/* "Deliver to client": the card under the Files list. It shows where the
   client's delivery stands (not sent, waiting for payment, sent, link off) and
   offers only what the caller may do. Every figure and button comes from
   `sessionDelivery.status`; the dollar amount arrives only for callers with
   money sight (balanceCents is null for everyone else). */

const BTN = "h-9 max-sm:h-11";

function errorText(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "data" in err) {
    const data = (err as { data?: unknown }).data;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && "message" in data) return String((data as { message: unknown }).message);
  }
  if (err instanceof Error && err.message) return err.message.replace(/^\[.*?\]\s*/, "").replace(/^Uncaught \w+:\s*/, "");
  return fallback;
}

/** "today at 2:41 PM", "Nov 11 at 2:41 PM". */
function when(ts: number): string {
  const sameDay = new Date(ts).toDateString() === new Date().toDateString();
  return `${sameDay ? "today" : shortDate(ts)} at ${timeOfDay(ts)}`;
}

function StatePill({ tone, children }: { tone: "ok" | "wait" | "off"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-graphite/60 bg-coal-2 px-2.5 text-[0.75rem] font-semibold",
        tone === "ok" && "text-positive",
        tone === "wait" && "text-gold",
        tone === "off" && "text-steel",
      )}
    >
      {children}
    </span>
  );
}

export function SessionDeliveryCard({ sessionId, canUpload }: { sessionId: Id<"sessions">; canUpload: boolean }) {
  const status = useQuery(api.sessionDelivery.status, { sessionId });
  const convex = useConvex();
  const markReady = useMutation(api.sessionDelivery.markReady);
  const releaseNow = useMutation(api.sessionDelivery.releaseNow);
  const turnOff = useMutation(api.sessionDelivery.turnOff);
  const resend = useMutation(api.sessionDelivery.resend);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadedAt] = useState(() => Date.now());

  if (status === null) return null;
  if (status === undefined) return <Skeleton className="h-28 w-full" aria-label="Loading delivery" />;

  const name = status.clientFirstName || "the client";
  const n = status.finalCount;
  const filesLabel = `${n} file${n === 1 ? "" : "s"} marked Final.`;

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorText(err, "That did not work. Try again."));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    setBusy("copy");
    try {
      const res = await convex.query(api.sessionDelivery.link, { sessionId });
      if (!res) {
        toast.error("There is no link to copy yet.");
        return;
      }
      await navigator.clipboard.writeText(res.url);
      toast.success("Link copied");
    } catch (err) {
      toast.error(errorText(err, "Could not copy the link."));
    } finally {
      setBusy(null);
    }
  }

  const readyButton = (
    <Button
      size="sm"
      className={BTN}
      disabled={!status.canMarkReady || busy !== null}
      onClick={() => void act("ready", () => markReady({ sessionId }), "Delivery set up")}
    >
      <Send className="size-3.5" />
      Ready to deliver
    </Button>
  );
  const copyButton = canUpload ? (
    <Button size="sm" variant="ghost" className={BTN} disabled={busy !== null} onClick={() => void copyLink()}>
      <Link2 className="size-3.5" />
      Copy link
    </Button>
  ) : null;
  const turnOffButton = status.canTurnOff ? (
    <Button
      size="sm"
      variant="ghost"
      className={BTN}
      disabled={busy !== null}
      onClick={() => void act("off", () => turnOff({ sessionId }), "Link turned off")}
    >
      Turn off link
    </Button>
  ) : null;

  let pill: React.ReactNode = null;
  let body: React.ReactNode;
  let actions: React.ReactNode[] = [];

  if (status.state === "awaiting_payment") {
    pill = (
      <StatePill tone="wait">
        <Lock className="size-3" aria-hidden />
        Waiting for payment
      </StatePill>
    );
    const owed =
      status.balanceCents === null ? (
        <b className="font-semibold text-bone">A balance is still owed.</b>
      ) : status.balanceCents > 0 ? (
        <b className="font-semibold text-bone">{money(status.balanceCents)} is still owed.</b>
      ) : (
        <b className="font-semibold text-bone">Nothing is owed now.</b>
      );
    body = (
      <p>
        {status.lastSentAt ? `${name} was emailed a pay link ${when(status.lastSentAt)}.` : `No pay link email has gone out to ${name} yet.`}{" "}
        {owed} The download link sends by itself when it is paid.
      </p>
    );
    actions = [
      status.canRelease && (
        <Button
          key="release"
          size="sm"
          variant="secondary"
          className={BTN}
          disabled={busy !== null}
          onClick={() => void act("release", () => releaseNow({ sessionId }), "Download link sent")}
        >
          Send now anyway
        </Button>
      ),
      copyButton && <span key="copy">{copyButton}</span>,
      turnOffButton && <span key="off">{turnOffButton}</span>,
    ].filter(Boolean);
  } else if (status.state === "released") {
    pill = (
      <StatePill tone="ok">
        <Check className="size-3" aria-hidden />
        Sent
      </StatePill>
    );
    const expired = status.expiresAt !== null && status.expiresAt <= loadedAt;
    const stats = [
      status.firstOpenedAt ? `Opened ${timeOfDay(status.firstOpenedAt)}` : "Not opened yet",
      `${status.downloadCount} download${status.downloadCount === 1 ? "" : "s"}`,
      status.expiresAt ? (expired ? `link expired ${shortDate(status.expiresAt)}` : `link works until ${shortDate(status.expiresAt)}`) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    body = (
      <>
        <p>
          <b className="font-semibold text-bone">Sent to {status.sentTo ?? "the email on file"}</b>
          {status.lastSentAt ? ` ${when(status.lastSentAt)}.` : "."}
        </p>
        <p className="font-meta text-[0.75rem]">{stats}</p>
      </>
    );
    actions = [
      canUpload && (
        <Button
          key="resend"
          size="sm"
          variant="secondary"
          className={BTN}
          disabled={busy !== null}
          onClick={() => void act("resend", () => resend({ sessionId }), "Sent again")}
        >
          Resend
        </Button>
      ),
      copyButton && <span key="copy">{copyButton}</span>,
      turnOffButton && <span key="off">{turnOffButton}</span>,
    ].filter(Boolean);
  } else if (status.state === "off") {
    pill = <StatePill tone="off">Link off</StatePill>;
    body = (
      <p>
        {status.offAt ? `The link was turned off on ${shortDate(status.offAt)}. ` : "The link was turned off. "}
        {name === "the client" ? "The client" : name} can no longer download.
      </p>
    );
    actions = canUpload ? [<span key="ready">{readyButton}</span>] : [];
  } else {
    // Not sent yet.
    const lines: string[] = [];
    if (n === 0) lines.push("Mark at least one file Final to deliver.");
    if (!status.clientEmail) lines.push(`Add an email for ${name} to deliver.`);
    body =
      n > 0 ? (
        <>
          <p>
            <b className="font-semibold text-bone">{filesLabel}</b>{" "}
            {status.clientEmail
              ? status.balanceDue
                ? `${name} gets a download link by email once the booking is paid.`
                : `${name} gets a download link by email as soon as you tap Ready to deliver.`
              : null}
          </p>
          {!status.clientEmail && <p className="text-caution">{lines.join(" ")}</p>}
        </>
      ) : (
        <p>{lines.join(" ")}</p>
      );
    actions = canUpload ? [<span key="ready">{readyButton}</span>] : [];
  }

  return (
    <section
      aria-label="Deliver to client"
      aria-live="polite"
      data-testid="session-delivery"
      data-state={status.state}
      className="grid gap-2.5 rounded-lg border border-graphite/50 bg-coal-2 p-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-bone">Deliver to client</h3>
        {pill}
      </div>
      <div className="space-y-1.5 text-[0.8125rem] leading-relaxed text-steel">{body}</div>
      {actions.length > 0 && <div className="flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}
