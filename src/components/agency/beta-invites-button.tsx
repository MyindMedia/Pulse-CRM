"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

/* Entry point to the beta invite dashboard, from the sub-accounts section.

   It carries a count rather than being a bare link, because the number that
   matters here is the one nobody goes looking for: people who signed the
   agreement and then never built a studio. That is a list of warm leads
   sitting one nudge away, and it is invisible unless something surfaces it. */

export function BetaInvitesButton({ className }: { className?: string }) {
  const data = useQuery(api.betaAccess.list);

  // Signed, but never came back to build anything.
  const waiting = data
    ? data.items.filter((i) => i.signedAt && i.status !== "claimed" && i.status !== "revoked").length
    : 0;
  const total = data?.counts.total ?? 0;

  return (
    <Link
      href="/agency/beta"
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border border-graphite/60 px-3 py-1.5",
        "font-meta text-[0.65rem] uppercase tracking-[0.06em] text-steel transition-colors",
        "hover:border-gold hover:text-bone",
        className,
      )}
    >
      <Ticket className="size-3.5 text-steel/70 transition-colors group-hover:text-gold" />
      Beta invites
      {total > 0 && (
        <span className="font-mono text-[0.65rem] tabular-nums text-steel/60">{total}</span>
      )}
      {waiting > 0 && (
        <span
          className="rounded-full bg-gold px-1.5 py-0.5 font-mono text-[0.6rem] font-bold tabular-nums text-gold-ink"
          title={`${waiting} signed the agreement but have not built a studio yet`}
        >
          {waiting}
        </span>
      )}
    </Link>
  );
}
