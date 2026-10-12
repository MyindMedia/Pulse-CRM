"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { useCapabilities } from "@/lib/use-capabilities";
import type { InvoiceSummary } from "@/components/payments/money-summary";
import { Chassis, ChassisTitle, Delta, StatTile, lastMonthName, usd } from "@/components/dashboard/hw/parts";

/* Cash position (kit "Invoices and splits"): collected this month against
 * last month, what is outstanding (and overdue), drafts not yet sent, and
 * staff payouts still owed. The kit's "In BILL" tile is left out: Pulse has
 * no BILL integration, so there is nothing true to put in it. */
export function CashPosition({ summary }: { summary: InvoiceSummary | undefined }) {
  const o = useQuery(api.dashboard.overview, {});
  const stripe = useQuery(api.stripeConnect.status, {});
  const { can, loaded } = useCapabilities();
  const books = loaded && can("insights.read");
  const payouts = useQuery(api.payouts.list, books ? {} : "skip");
  // payouts.list totals: owed = queued + approved (committed, not yet paid).
  const owed = payouts && !Array.isArray(payouts) ? payouts.totals.owedCents : 0;

  return (
    <Chassis grid brackets>
      <ChassisTitle title="Cash position" right={stripe?.chargesEnabled ? <Badge tone="info">Stripe connected</Badge> : null} />
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!summary ? (
          [0, 1, 2, 3].map((i) => <StatTile key={i} label="Loading" value="--" />)
        ) : (
          <>
            <StatTile
              label="Collected"
              value={usd(summary.collectedThisMonth)}
              highlight
              foot={o ? <Delta value={o.kpis.revenueDelta} against={lastMonthName()} /> : null}
            />
            <StatTile
              label="Outstanding"
              value={usd(summary.outstanding)}
              foot={summary.overdue > 0 ? <span className="text-critical">{usd(summary.overdue)} overdue</span> : "all current"}
            />
            <StatTile label="Drafts" value={usd(summary.draftValue)} foot="not yet sent" />
            {books ? (
              <StatTile label="Payouts owed" value={usd(owed)} foot={payouts === undefined ? "" : "to staff, queued or approved"} />
            ) : (
              <StatTile label="Invoices" value={String(summary.count)} foot="on file" />
            )}
          </>
        )}
      </div>
    </Chassis>
  );
}
