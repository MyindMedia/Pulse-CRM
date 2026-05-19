"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import { CreditCard, Receipt, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/feedback";
import { money, relativeTime } from "@/lib/format";
import { titleCase } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { bookingMoney, type PaymentRow } from "./types";

type PaymentKind = "deposit" | "balance" | "full";

/** A single labelled money line. */
function MoneyLine({
  label,
  value,
  tone = "ash",
}: {
  label: string;
  value: string;
  tone?: "ash" | "bone" | "gold" | "positive" | "caution";
}) {
  const color = {
    ash: "text-ash",
    bone: "text-bone",
    gold: "text-gold-bright",
    positive: "text-positive",
    caution: "text-caution",
  }[tone];
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ash-dim">{label}</span>
      <span className={cn("font-mono text-sm font-semibold tabular-nums", color)}>
        {value}
      </span>
    </div>
  );
}

/**
 * Reusable booking-payment panel. Renders the money summary, a progress
 * bar, the payment history and the staff "Record a payment" control.
 *
 * Used by both the internal Bookings drawer and the calendar session
 * sheet so the payment surface stays identical across the app.
 */
export function PaymentPanel({
  sessionId,
  rateCents,
  depositCents,
  amountPaidCents,
  cancelled,
}: {
  sessionId: Id<"sessions">;
  rateCents: number;
  depositCents: number;
  amountPaidCents?: number;
  cancelled?: boolean;
}) {
  const payments = useQuery(api.payments.forSession, { sessionId }) as
    | PaymentRow[]
    | undefined;
  const record = useMutation(api.payments.record);
  const [busy, setBusy] = React.useState(false);

  const m = bookingMoney({ rateCents, depositCents, amountPaidCents });
  const depositOutstanding = Math.max(0, m.deposit - m.paid);

  async function take(kind: PaymentKind) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await record({ sessionId, kind, payerName: "Front desk" });
      toast.success(
        res.fullyPaid
          ? "Payment recorded — booking paid in full"
          : `Payment recorded — ${money(res.balance)} balance remaining`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not record the payment",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Money summary */}
      <div className="space-y-2 rounded-md border border-hairline bg-coal-2 p-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ash">
            <Wallet className="size-3.5" />
            Payment
          </span>
          <Badge tone={m.fullyPaid ? "positive" : m.paid > 0 ? "caution" : "neutral"}>
            {m.fullyPaid ? "Paid in full" : m.paid > 0 ? "Partly paid" : "Unpaid"}
          </Badge>
        </div>
        <div className="space-y-1.5">
          <MoneyLine label="Total" value={money(m.total)} tone="bone" />
          <MoneyLine label="Deposit" value={money(m.deposit)} />
          <MoneyLine
            label="Paid"
            value={money(m.paid)}
            tone={m.paid > 0 ? "positive" : "ash"}
          />
          <MoneyLine
            label="Balance"
            value={money(m.balance)}
            tone={m.balance > 0 ? "caution" : "ash"}
          />
        </div>
        <Progress
          value={m.paid}
          max={Math.max(m.total, 1)}
          tone={m.fullyPaid ? "positive" : "gold"}
        />
      </div>

      {/* Record-a-payment control */}
      {!cancelled && !m.fullyPaid && (
        <div className="space-y-1.5 rounded-md border border-dashed border-hairline-2 p-3">
          <p className="overline">Record a payment</p>
          <p className="text-[0.6875rem] text-ash-dim">
            Take a payment on the client&apos;s behalf. Amounts are derived
            from the booking — recorded as a simulated provider.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {depositOutstanding > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => take("deposit")}
              >
                <CreditCard className="size-3.5" />
                Deposit · {money(depositOutstanding)}
              </Button>
            )}
            {m.paid >= m.deposit && m.balance > 0 && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => take("balance")}
              >
                <CreditCard className="size-3.5" />
                Balance · {money(m.balance)}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => take("full")}
            >
              <Wallet className="size-3.5" />
              Pay in full · {money(m.balance)}
            </Button>
            {busy && <Spinner className="self-center" />}
          </div>
        </div>
      )}

      {/* Payment history */}
      <div className="space-y-1.5">
        <p className="overline">Payment history</p>
        {payments === undefined ? (
          <div className="space-y-1.5">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <p className="rounded-md border border-dashed border-hairline-2 py-5 text-center text-xs text-ash-dim">
            No payments recorded against this booking yet.
          </p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline">
            {payments.map((p) => (
              <li
                key={p._id}
                className="flex items-center justify-between gap-3 bg-coal-2 px-3 py-2"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Receipt className="size-3.5 shrink-0 text-ash-dim" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-bone">
                      {titleCase(p.kind)} payment
                    </span>
                    <span className="block truncate font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                      {titleCase(p.provider)}
                      {p.payerName ? ` · ${p.payerName}` : ""}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm font-semibold tabular-nums text-positive">
                    {money(p.amountCents)}
                  </span>
                  <span className="block text-[0.625rem] text-ash-dim">
                    {relativeTime(p.paidAt ?? p._creationTime)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
