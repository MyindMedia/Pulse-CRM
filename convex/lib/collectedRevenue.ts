import type { QueryCtx } from "../_generated/server";

/* ============================================================
   Money that came in, one definition for every screen.

   The same sources Reports > Financials (expenses.plReport) adds up:
   - invoices marked paid, by paidAt
   - booking payments (deposits, balances, pay-in-full; the payments
     ledger), by paidAt. A paid booking never also gets a paid invoice
     for the same money: the completion invoice only bills what is
     still owed (sessions.createCompletionInvoice).
   - package and membership collections (revenueEntries), by collectedAt
   - bank deposits explicitly marked as business income (USD, posted)
   The dashboard's revenue tile, its trend and the revenue chart read
   this, so they agree with the P&L instead of counting invoices only.
   ============================================================ */

export type RevenueSource = "invoice" | "booking_payment" | "package" | "membership" | "bank_income";
export type CollectedRow = { at: number; cents: number; source: RevenueSource };

/** Bank lines carry only a day (UTC midnight). Place them at noon UTC of that
 *  day so they land on the right local day for any studio time zone. */
const BANK_DAY_OFFSET = 12 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

/** Every collection in [from, to), each tagged with where it came from.
 *  Indexed range reads only. */
export async function collectedRevenueRows(
  ctx: QueryCtx,
  orgId: string,
  from: number,
  to: number,
): Promise<CollectedRow[]> {
  const [invoices, payments, entries, bank] = await Promise.all([
    ctx.db
      .query("invoices")
      .withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).gte("paidAt", from).lt("paidAt", to))
      .collect(),
    ctx.db
      .query("payments")
      .withIndex("by_org_paidAt", (q) => q.eq("orgId", orgId).gte("paidAt", from).lt("paidAt", to))
      .collect(),
    ctx.db
      .query("revenueEntries")
      .withIndex("by_org_collected", (q) => q.eq("orgId", orgId).gte("collectedAt", from).lt("collectedAt", to))
      .collect(),
    ctx.db
      .query("bankTransactions")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", from - DAY).lt("date", to))
      .collect(),
  ]);

  const out: CollectedRow[] = [];
  for (const i of invoices) {
    if (i.status === "paid" && i.paidAt !== undefined) out.push({ at: i.paidAt, cents: i.amountCents, source: "invoice" });
  }
  for (const p of payments) {
    if (p.status === "paid" && p.paidAt !== undefined) out.push({ at: p.paidAt, cents: p.amountCents, source: "booking_payment" });
  }
  for (const e of entries) {
    out.push({ at: e.collectedAt, cents: e.amountCents, source: e.sourceType });
  }
  for (const t of bank) {
    if (t.removed || t.pending || t.direction !== "in" || t.moneyInKind !== "income") continue;
    if (t.currency.toUpperCase() !== "USD") continue;
    // Today's line sits at "now" (the range end) until its noon has passed.
    const at = Math.min(t.date + BANK_DAY_OFFSET, to - 1);
    if (at >= from && t.date < to) out.push({ at, cents: t.amountCents, source: "bank_income" });
  }
  return out;
}

/** Sum of the rows collected in [from, to). */
export function sumCollected(rows: CollectedRow[], from: number, to: number): number {
  return rows.reduce((s, r) => (r.at >= from && r.at < to ? s + r.cents : s), 0);
}

