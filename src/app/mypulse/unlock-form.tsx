"use client";

import * as React from "react";
import { Lock, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { unlock, type UnlockState } from "./actions";

const INITIAL: UnlockState = { error: null };

export function UnlockForm() {
  const [state, formAction, pending] = React.useActionState(unlock, INITIAL);

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-5 py-16">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pulse-logo-main.png" alt="Pulse" className="h-6 w-auto" />

        <form
          action={formAction}
          className="mt-8 rounded-chrome border border-hairline bg-coal-2 p-6 shadow-card"
        >
          <span className="grid size-10 place-items-center rounded-lg bg-gold/12 text-gold">
            <Lock className="size-5" />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-bone">
            Sales enablement
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ash">
            Everything Pulse does, in one page, for the people who sell it. Enter the
            password you were given.
          </p>

          <label htmlFor="mypulse-password" className="overline mt-6 block">
            Password
          </label>
          <input
            id="mypulse-password"
            name="password"
            type="password"
            autoFocus
            autoComplete="current-password"
            className="mt-2 h-11 w-full rounded-lg border border-hairline-2 bg-ink px-3 text-sm text-bone outline-none placeholder:text-ash-dim focus:border-gold"
            placeholder="••••••••••"
          />

          {state.error && (
            <p role="alert" className="mt-3 text-sm text-critical">
              {state.error}
            </p>
          )}

          <Button type="submit" className="mt-5 w-full" disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {pending ? "Checking" : "Open the page"}
            {!pending && <ArrowRight className="size-4" />}
          </Button>
        </form>

        <p className="mt-4 text-center font-meta text-[11px] uppercase tracking-[0.12em] text-ash-dim">
          Internal · not for forwarding
        </p>
      </div>
    </main>
  );
}
