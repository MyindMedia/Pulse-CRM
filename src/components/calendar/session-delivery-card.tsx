"use client";

import { useEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { Check, Link2, Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { createPressGuard } from "@/lib/press-guard";
import { uploads } from "@/lib/upload-manager";
import safe from "@/components/delivery/text-safe.module.css";
import {
  PAY_LINK_TOAST,
  deliveryCardView,
  sentToast,
  type CardAction,
  type CardActionKey,
  type CardPill,
} from "@/lib/delivery-card-view";

/* "Deliver to client": the card under the Files list. It shows where the
   client's delivery stands (not sent, waiting for payment, sent, link off) and
   offers only what the caller may do. Every figure and button comes from
   `sessionDelivery.status`, turned into copy by deliveryCardView (unit tested
   in src/lib/delivery-card-view.test.ts); the dollar amount arrives only for
   callers with money sight (balanceCents is null for everyone else).

   No live region on the card: a result is read out once by the Files
   section's role="status" node (uploads.say), not by re-reading the card.

   V3-01: no button sets `disabled` while its own request runs (that drops
   keyboard focus to the dialog). One request runs at a time, guarded by
   createPressGuard; the others stay focusable and a press on them is
   refused. When the pressed button goes away because the state moved on
   (Ready to deliver becomes Send now anyway, Turn off link becomes Ready),
   focus moves to the card's first action, or its heading, instead of being
   lost. */

/** How long after a request focus may still be moved back into the card. */
const REFOCUS_MS = 5000;

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

class NoLinkYet extends Error {}

function StatePill({ pill }: { pill: CardPill }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-graphite/60 bg-coal-2 px-2.5 text-[0.75rem] font-semibold",
        pill.tone === "ok" && "text-[color:var(--ok-text)]",
        pill.tone === "wait" && "text-[color:var(--gold-text)]",
        pill.tone === "off" && "text-steel",
      )}
    >
      {pill.icon === "check" && <Check className="size-3" aria-hidden />}
      {pill.icon === "lock" && <Lock className="size-3" aria-hidden />}
      {pill.label}
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
  const [busy, setBusy] = useState<CardActionKey | null>(null);
  const [guard] = useState(createPressGuard);
  const cardRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set after a request that started with focus in the card: until then, if
  // focus falls to the page (the pressed button unmounted), put it back.
  const refocusUntil = useRef(0);
  const [loadedAt] = useState(() => Date.now());
  // Set when the clipboard refused: the link in a read-only field to copy by hand.
  const [manualLink, setManualLink] = useState<string | null>(null);
  const manualField = useRef<HTMLInputElement>(null);

  // Every render: the state change that removes the pressed button is a render.
  useEffect(() => {
    if (!refocusUntil.current) return;
    if (Date.now() > refocusUntil.current) {
      refocusUntil.current = 0;
      return;
    }
    const card = cardRef.current;
    const el = document.activeElement;
    if (!card) return;
    const lost = !el || el === document.body;
    if (!lost) {
      // Still on a control in the card (it may yet unmount), or moved on by the user.
      if (!card.contains(el)) refocusUntil.current = 0;
      return;
    }
    refocusUntil.current = 0;
    const target = card.querySelector<HTMLElement>("[data-card-action]:not([disabled])") ?? headingRef.current;
    target?.focus();
  });

  useEffect(() => {
    if (!manualLink) return;
    manualField.current?.focus();
    manualField.current?.select();
  }, [manualLink]);

  if (status === null) return null;
  if (status === undefined) return <Skeleton className="h-28 w-full" aria-label="Loading delivery" />;

  const view = deliveryCardView(status, { canUpload, now: loadedAt });
  const email = status.clientEmail;
  // Waiting with nothing owed, Resend releases; otherwise it sends the current email again.
  const resendReleases = status.state === "released" || !status.balanceDue;

  /** Shows and reads out a result once: a toast, and the section's status line. */
  function tell(ok: boolean, text: string) {
    if (ok) toast.success(text);
    else toast.error(text);
    uploads.say(sessionId, text);
  }

  /** Runs one card request unless another is in flight. */
  function guarded(key: CardActionKey, fn: () => Promise<void>) {
    if (guard.anyBusy()) return;
    const hadFocus = !!cardRef.current?.contains(document.activeElement);
    void guard.run("card", async () => {
      setBusy(key);
      try {
        await fn();
      } finally {
        setBusy(null);
        if (hadFocus) refocusUntil.current = Date.now() + REFOCUS_MS;
      }
    });
  }

  function act(key: CardActionKey, fn: () => Promise<string>) {
    guarded(key, async () => {
      setManualLink(null);
      try {
        tell(true, await fn());
      } catch (err) {
        tell(false, errorText(err, "That did not work. Try again."));
      }
    });
  }

  /* Copy link. Safari and Firefox only let a page write to the clipboard while
     the click that asked for it is still "live", and an await on the network
     spends it. So the clipboard write starts here, synchronously, with a
     ClipboardItem whose text is a promise of the link; the browser waits for
     the promise itself. Where ClipboardItem is missing, writeText after the
     fetch (still inside the activation window in those browsers). */
  function copyLink(): Promise<void> {
    setManualLink(null);
    const url: Promise<string> = convex.query(api.sessionDelivery.link, { sessionId }).then((res) => {
      if (!res) throw new NoLinkYet();
      return res.url;
    });
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    let written: Promise<void> | null = null;
    if (typeof ClipboardItem !== "undefined" && clip && typeof clip.write === "function") {
      try {
        written = clip.write([new ClipboardItem({ "text/plain": url.then((u) => new Blob([u], { type: "text/plain" })) })]);
      } catch {
        written = null; // a ClipboardItem that will not take a promise: use writeText
      }
    }
    if (!written) {
      written =
        clip && typeof clip.writeText === "function"
          ? url.then((u) => clip.writeText(u))
          : url.then(() => Promise.reject(new Error("no clipboard")));
    }
    return written.then(
      () => {
        tell(true, "Link copied");
      },
      async () => {
        // Find out whether there was a link at all before blaming the clipboard.
        let link: string;
        try {
          link = await url;
        } catch (err) {
          tell(false, err instanceof NoLinkYet ? "There is no link to copy yet." : errorText(err, "Could not copy the link."));
          return;
        }
        uploads.say(sessionId, "Could not copy. Select the link and copy it.");
        setManualLink(link);
      },
    );
  }

  function run(key: CardActionKey) {
    switch (key) {
      case "ready":
        return act("ready", async () => {
          const res = await markReady({ sessionId });
          return res.state === "released" ? sentToast(email) : PAY_LINK_TOAST;
        });
      case "release":
        return act("release", async () => {
          await releaseNow({ sessionId });
          return sentToast(email);
        });
      case "resend":
        return act("resend", async () => {
          await resend({ sessionId });
          return resendReleases ? sentToast(email) : PAY_LINK_TOAST;
        });
      case "off":
        return act("off", async () => {
          await turnOff({ sessionId });
          return "Link turned off";
        });
      case "copy":
        // The clipboard write starts inside guard.run's first synchronous
        // step, so it still runs within the click.
        return guarded("copy", copyLink);
    }
  }

  function actionButton(a: CardAction) {
    return (
      <Button
        key={a.key}
        size="sm"
        variant={a.variant}
        className={cn(BTN, "aria-disabled:opacity-40 aria-busy:cursor-wait")}
        data-card-action={a.key}
        disabled={a.disabled}
        aria-busy={busy === a.key || undefined}
        aria-disabled={(busy !== null && busy !== a.key) || undefined}
        onClick={() => run(a.key)}
      >
        {a.key === "ready" && <Send className="size-3.5" aria-hidden />}
        {a.key === "copy" && <Link2 className="size-3.5" aria-hidden />}
        {a.label}
      </Button>
    );
  }

  return (
    <section
      ref={cardRef}
      aria-label="Deliver to client"
      data-testid="session-delivery"
      data-state={status.state}
      className={cn("grid gap-2.5 rounded-lg border border-graphite/50 bg-coal-2 p-3.5", safe.safeText)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-sm font-bold text-bone">
          Deliver to client
        </h3>
        {view.pill && <StatePill pill={view.pill} />}
      </div>
      <div className="space-y-1.5 text-[0.8125rem] leading-relaxed text-steel">
        {view.lines.map((l, i) => (
          <p key={i} className={cn(l.tone === "mono" && "font-meta text-[0.75rem]", l.tone === "caution" && "text-[color:var(--warn-text)]")}>
            {l.parts.map((p, j) =>
              p.strong ? (
                <b key={j} className="font-semibold text-bone">
                  {p.text}
                </b>
              ) : (
                <span key={j}>{p.text}</span>
              ),
            )}
          </p>
        ))}
      </div>
      {view.actions.length > 0 && <div className="flex flex-wrap gap-2">{view.actions.map(actionButton)}</div>}
      {manualLink && (
        <div className="grid gap-1.5">
          <p className="text-[0.8125rem] text-[color:var(--warn-text)]">Could not copy. Select the link and copy it.</p>
          <input
            ref={manualField}
            readOnly
            value={manualLink}
            aria-label="Delivery link"
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 w-full min-w-0 rounded-md border border-graphite/60 bg-coal px-2.5 font-meta text-[0.75rem] text-bone max-sm:h-11"
          />
        </div>
      )}
    </section>
  );
}
