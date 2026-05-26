"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CreditCard, ArrowRight, X } from "lucide-react";

/**
 * Dashboard nudge: until Stripe is live, prompt the studio to set up payments so
 * they can start collecting. Links to the guided walkthrough on /payments.
 * Dismissible per session (not a gate).
 */
export function GetPaidBanner() {
  const status = useQuery(api.stripeConnect.status, {});
  const [dismissed, setDismissed] = React.useState(false);

  // Hide while loading, once live, or if dismissed this session.
  if (!status || (status.connected && status.chargesEnabled) || dismissed) return null;

  const pending = status.connected && !status.chargesEnabled;

  return (
    <div className="mb-6 flex items-center gap-4 rounded-xl border border-gold-dim/40 bg-gold/[0.06] px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
        <CreditCard className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-bone">
          {pending ? "Finish setting up payments" : "Start collecting payments"}
        </p>
        <p className="truncate text-xs text-ash">
          {pending
            ? "Stripe is connected but not verified yet - finish setup to go live."
            : "Connect Stripe to take deposits and get invoices paid online. About 3 minutes."}
        </p>
      </div>
      <Link
        href="/payments"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-gold px-3 text-xs font-semibold text-gold-ink transition-opacity hover:opacity-90"
      >
        {pending ? "Finish setup" : "Set up payments"}
        <ArrowRight className="size-3.5" />
      </Link>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-ash-dim transition-colors hover:text-ash">
        <X className="size-4" />
      </button>
    </div>
  );
}
