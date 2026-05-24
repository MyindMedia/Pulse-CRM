"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Sparkles, ArrowRight, X } from "lucide-react";
import * as React from "react";

/**
 * Resumable-onboarding nudge. Shows until the owner finishes the /welcome
 * wizard (onboardingCompletedAt set). Dismissible per-session (the studio is
 * active either way — this is a gentle prompt, not a gate).
 */
export function OnboardingNudge() {
  const mine = useQuery(api.onboarding.mine, {});
  const [dismissed, setDismissed] = React.useState(false);

  if (!mine || mine.onboardingCompletedAt || dismissed) return null;

  const done = Object.values(mine.steps).filter(Boolean).length;
  const total = Object.keys(mine.steps).length;

  return (
    <div className="mb-6 flex items-center gap-4 rounded-xl border border-gold-dim/40 bg-gold/[0.06] px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
        <Sparkles className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-bone">
          Finish setting up your studio
        </p>
        <p className="truncate text-xs text-ash">
          {done} of {total} steps done — add your logo, details, and first room to start taking bookings.
        </p>
      </div>
      <Link
        href="/welcome"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-gold px-3 text-xs font-semibold text-gold-ink transition-opacity hover:opacity-90"
      >
        Continue
        <ArrowRight className="size-3.5" />
      </Link>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-ash-dim transition-colors hover:text-ash"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
