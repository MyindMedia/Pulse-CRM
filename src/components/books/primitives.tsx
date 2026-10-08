"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatAmount, formatUsd } from "@/lib/books/money";

/** A money figure. Tabular, right aligned by the caller. Negatives keep the
 *  true minus sign everywhere; nothing is coloured red. */
export function Money({ cents, usd = false, className }: { cents: number; usd?: boolean; className?: string }) {
  return <span className={cn("tabular-nums", className)}>{usd ? formatUsd(cents) : formatAmount(cents)}</span>;
}

/** A difference, signed: "+1,900.00" when the journal reads higher. */
export function SignedMoney({ cents, className }: { cents: number; className?: string }) {
  const text = cents > 0 ? `+${formatAmount(cents)}` : formatAmount(cents);
  return <span className={cn("tabular-nums", className)}>{text}</span>;
}

export function ReceiptBadge({ status }: { status: "yes" | "no" | "pending" }) {
  if (status === "yes") return <Badge tone="positive">Yes</Badge>;
  if (status === "no") return <Badge tone="caution">No</Badge>;
  return <Badge tone="neutral">Pending</Badge>;
}

export function StatusBadge({ status }: { status: "pass" | "warn" | "fail" }) {
  if (status === "pass") return <Badge tone="positive">Pass</Badge>;
  if (status === "warn") return <Badge tone="caution">Warn</Badge>;
  return <Badge tone="critical">Fail</Badge>;
}

export function Notice({ tone = "neutral", title, children }: { tone?: "neutral" | "caution"; title?: string; children: React.ReactNode }) {
  return (
    <div
      role="note"
      className={cn(
        "books-avoid-break rounded-lg border px-3.5 py-2.5 text-sm",
        tone === "caution" ? "border-caution/30 bg-caution/5 text-bone" : "border-graphite/60 bg-coal-2 text-steel",
      )}
    >
      {title && <p className="font-medium text-bone">{title}</p>}
      <div className={cn(title && "mt-0.5", "leading-relaxed")}>{children}</div>
    </div>
  );
}

/** Catches a failed Convex query so one bad read shows a message, not a blank page. */
export class BooksErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-critical/30 bg-critical/5 p-5">
        <p className="font-medium text-bone">We could not load these books.</p>
        <p className="mt-1 text-sm text-steel">{this.state.error.message || "Something went wrong reading the ledger."}</p>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="mt-3 inline-flex h-8 items-center rounded-md border border-graphite/60 px-3 text-xs text-bone hover:bg-coal-3"
        >
          Try again
        </button>
      </div>
    );
  }
}

export function Skeletonish({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 py-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 animate-pulse rounded-md bg-coal-3/70 motion-reduce:animate-none" />
      ))}
    </div>
  );
}
