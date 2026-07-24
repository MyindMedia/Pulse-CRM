"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/utils";

/** Lightweight "join the waitlist / get updates" email capture for the
 *  marketing site. Calls the public `subscribers.join` action (mirrors the
 *  Contact form), which stores the subscriber and pushes them to the Resend
 *  Audience. On success it kicks off the Day 0 / Day 2 / Day 5 nurture sequence. */
export function WaitlistForm({
  source = "footer",
  className,
}: {
  source?: string;
  className?: string;
}) {
  const join = useAction(api.subscribers.join);
  const [email, setEmail] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<null | "new" | "already">(null);
  const [err, setErr] = React.useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setErr("");
    setBusy(true);
    try {
      const res = await join({ email: email.trim(), source });
      setDone(res.already ? "already" : "new");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        className={cn(
          "flex items-center gap-3 rounded-chrome border border-gold/40 bg-gold/[0.06] px-4 py-3.5",
          className,
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-gold/50 bg-gold/10 text-gold">
          <Check className="size-4" />
        </span>
        <p className="font-grotesk text-sm text-bone">
          {done === "already" ? "You're already on the list." : "You're in. Check your inbox."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className={cn("w-full", className)}>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <label htmlFor="wl-email" className="sr-only">
          Email address
        </label>
        <input
          id="wl-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@studio.com"
          autoComplete="email"
          className="w-full rounded-chrome border border-graphite/60 bg-obsidian/60 px-4 py-3 text-[15px] text-bone placeholder:text-steel/60 outline-none transition-colors focus:border-gold/70 focus:bg-obsidian/80"
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-chrome bg-gold px-6 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all hover:-translate-y-0.5 hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Join
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-critical">{err}</p>}
    </form>
  );
}
