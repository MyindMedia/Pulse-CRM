"use client";

import { Loading02, Send01, ShieldTick } from "@untitledui/icons";
import { Button } from "@/components/ui/button";

/* The summary card for a booking link without prices
   (orgs.bookingFeatures.hidePricing). Same layout as the priced summary,
   with every money line gone: what was picked, then "Request booking".
   The server never sent a price, so there is nothing here to hide. */

export type RequestLine = { label: string; value?: string };

export function RequestSummary({
  lines,
  canSubmit,
  submitting,
  onSubmit,
  hint,
}: {
  lines: RequestLine[];
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  /** Why the button is disabled, when it is. */
  hint?: string | null;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-graphite/50 bg-coal p-5">
      {lines.map((l, i) => (
        <div key={`${l.label}-${i}`} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-steel">{l.label}</span>
          {l.value && <span className="shrink-0 font-meta text-bone">{l.value}</span>}
        </div>
      ))}
      <Button type="button" size="lg" className="w-full" disabled={!canSubmit} onClick={onSubmit}>
        {submitting ? (
          <>
            <Loading02 className="size-4 animate-spin" />
            Sending your request…
          </>
        ) : (
          <>
            Request booking
            <Send01 className="size-4" />
          </>
        )}
      </Button>
      {hint && <p className="text-center text-xs text-steel/70">{hint}</p>}
    </div>
  );
}

/** One line under a priced summary when the studio approves every booking
 *  (bookingFeatures.requireApproval with prices shown). */
export function ApprovalNote() {
  return (
    <p className="flex items-start gap-2 text-xs text-steel">
      <ShieldTick className="mt-0.5 size-3.5 shrink-0 text-gold" />
      The studio reviews every booking. You&apos;ll get an email and text once it&apos;s confirmed.
    </p>
  );
}
