/* Pure profit-and-loss math. Kept dependency-free so it is unit-testable and so
   the same roll-up can feed both the Expenses dashboard and the AI profitability
   surfaces. Revenue and expenses are both in integer cents. */

export type ExpenseLite = { category: string; amountCents: number };

export type CategoryTotal = { category: string; amountCents: number };

export type PnlSummary = {
  revenueCents: number;
  expensesCents: number;
  netCents: number;
  /** net / revenue, in [-inf, 1]. 0 when there is no revenue. */
  marginPct: number;
  /** expense totals per category, largest first. */
  byCategory: CategoryTotal[];
};

/** Roll revenue + a list of expenses into a P&L summary. */
export function plSummary(revenueCents: number, expenses: ExpenseLite[]): PnlSummary {
  const totals = new Map<string, number>();
  let expensesCents = 0;
  for (const e of expenses) {
    const amt = e.amountCents ?? 0;
    totals.set(e.category, (totals.get(e.category) ?? 0) + amt);
    expensesCents += amt;
  }
  const netCents = revenueCents - expensesCents;
  const byCategory = [...totals.entries()]
    .map(([category, amountCents]) => ({ category, amountCents }))
    .sort((a, b) => b.amountCents - a.amountCents);
  return {
    revenueCents,
    expensesCents,
    netCents,
    marginPct: revenueCents > 0 ? netCents / revenueCents : 0,
    byCategory,
  };
}

/** Normalize a recurring fixed cost to a monthly figure, for run-rate views. */
export function monthlyRunRateCents(amountCents: number, recurring?: "monthly" | "annual"): number {
  if (recurring === "monthly") return amountCents;
  if (recurring === "annual") return Math.round(amountCents / 12);
  return 0; // one-off expenses don't contribute to a recurring run rate
}
