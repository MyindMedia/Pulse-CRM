"use client";

import { Wallet, AlertTriangle, BadgeCheck, FileText } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { SkeletonCards } from "@/components/ui/skeleton";
import { money } from "@/lib/format";

/** Shape of `api.invoices.summary`. */
export type InvoiceSummary = {
  outstanding: number;
  overdue: number;
  collectedThisMonth: number;
  draftValue: number;
  count: number;
};

/** Four-up money headline for the Payments list. */
export function MoneySummary({ summary }: { summary: InvoiceSummary | undefined }) {
  if (!summary) return <SkeletonCards cards={4} />;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Outstanding"
        value={money(summary.outstanding, { compact: true })}
        icon={Wallet}
        hint="sent + viewed + overdue"
      />
      <StatTile
        label="Overdue"
        value={money(summary.overdue, { compact: true })}
        icon={AlertTriangle}
        hint={summary.overdue > 0 ? "needs chasing" : "all current"}
        accent={summary.overdue > 0}
        className={
          summary.overdue > 0
            ? "border-critical/40 bg-critical/[0.05]"
            : undefined
        }
      />
      <StatTile
        label="Collected · MTD"
        value={money(summary.collectedThisMonth, { compact: true })}
        icon={BadgeCheck}
        hint="paid this month"
      />
      <StatTile
        label="Draft value"
        value={money(summary.draftValue, { compact: true })}
        icon={FileText}
        hint="not yet sent"
      />
    </div>
  );
}
