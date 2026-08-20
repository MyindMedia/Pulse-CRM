/* ============================================================
   Payout arithmetic - pure, so it can be tested without a database
   and shown to an engineer who disagrees with a number.

   Every branch returns the explanation alongside the amount. A payout
   nobody can explain is a payout somebody will dispute.
   ============================================================ */

export type PayBasis = "commission" | "points" | "hourly" | "manual";

export type PayoutInput = {
  payType?: "hourly" | "salary" | "commission" | "points";
  commissionPct?: number;
  pointsPerSession?: number;
  payRateCents?: number;
  /** What the session billed. */
  sessionRateCents: number;
  /** Hours actually clocked against this session, when known. */
  hours?: number;
  /** The org's value of one point. */
  pointValueCents?: number;
};

export type PayoutResult = {
  basis: PayBasis;
  amountCents: number;
  explanation: string;
  snapshot: {
    sessionRateCents: number;
    commissionPct?: number;
    points?: number;
    pointValueCents?: number;
    hours?: number;
  };
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const clampPct = (p: number) => Math.min(Math.max(p, 0), 100);

/**
 * What this teammate earned for this session, on whichever basis they are on.
 *
 * Returns null when there is nothing to pay out: a salaried teammate is
 * already paid, and an unconfigured one must not be silently given zero -
 * a zero payout row reads as "we owe you nothing", which is a different and
 * wrong claim from "nobody set this up yet".
 */
export function payoutForSession(input: PayoutInput): PayoutResult | null {
  const rate = Math.max(0, Math.round(input.sessionRateCents));

  // Salary is already covered by payroll. Paying a session cut on top would
  // double-pay, which is the expensive direction to get wrong.
  if (input.payType === "salary") return null;

  if (input.payType === "commission") {
    const pct = clampPct(input.commissionPct ?? 0);
    if (pct <= 0) return null;
    const amount = Math.round((rate * pct) / 100);
    return {
      basis: "commission",
      amountCents: amount,
      explanation: `${pct}% of the ${money(rate)} session rate`,
      snapshot: { sessionRateCents: rate, commissionPct: pct },
    };
  }

  if (input.payType === "points") {
    const points = Math.max(0, input.pointsPerSession ?? 0);
    const value = Math.max(0, Math.round(input.pointValueCents ?? 0));
    if (points <= 0 || value <= 0) return null;
    const amount = Math.round(points * value);
    return {
      basis: "points",
      amountCents: amount,
      explanation: `${points} point${points === 1 ? "" : "s"} at ${money(value)} each`,
      snapshot: { sessionRateCents: rate, points, pointValueCents: value },
    };
  }

  if (input.payType === "hourly") {
    const hours = input.hours ?? 0;
    const perHour = Math.max(0, Math.round(input.payRateCents ?? 0));
    if (hours <= 0 || perHour <= 0) return null;
    const amount = Math.round(hours * perHour);
    return {
      basis: "hourly",
      amountCents: amount,
      explanation: `${round2(hours)} hour${hours === 1 ? "" : "s"} at ${money(perHour)}/hr`,
      snapshot: { sessionRateCents: rate, hours: round2(hours) },
    };
  }

  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Totals for a set of payouts, split by where each one has got to. */
export function payoutTotals(
  rows: { amountCents: number; status: "queued" | "approved" | "paid" | "void" }[],
): { queuedCents: number; approvedCents: number; paidCents: number; owedCents: number } {
  let queuedCents = 0, approvedCents = 0, paidCents = 0;
  for (const r of rows) {
    if (r.status === "queued") queuedCents += r.amountCents;
    else if (r.status === "approved") approvedCents += r.amountCents;
    else if (r.status === "paid") paidCents += r.amountCents;
  }
  // Owed is what is committed but not yet out the door.
  return { queuedCents, approvedCents, paidCents, owedCents: queuedCents + approvedCents };
}
