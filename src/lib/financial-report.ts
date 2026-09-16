import { EXPENSE_CATEGORY_LABEL, EXPENSE_TAX_GROUP } from "@convex/lib/financeCategories";

export type FinancialRange = "month" | "last" | "quarter" | "year" | "custom";

export type FinancialBounds = {
  start: number;
  end: number;
  bankStart: number;
  bankEnd: number;
  startLabel: string;
  endLabel: string;
};

function dateInput(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const ms = new Date(year, month - 1, day).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function utcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function financialBounds(
  range: FinancialRange,
  anchor: Date,
  customStart: string,
  customEnd: string,
): FinancialBounds | null {
  let start: number;
  let end: number;
  let bankStart: number;
  let bankEnd: number;

  if (range === "custom") {
    const first = localDate(customStart);
    const last = localDate(customEnd);
    const firstUtc = utcDate(customStart);
    const lastUtc = utcDate(customEnd);
    if (first === null || last === null || firstUtc === null || lastUtc === null || first > last) return null;
    start = first;
    end = new Date(new Date(last).getFullYear(), new Date(last).getMonth(), new Date(last).getDate() + 1).getTime();
    bankStart = firstUtc;
    bankEnd = lastUtc + 86_400_000;
  } else {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    if (range === "last") {
      start = new Date(year, month - 1, 1).getTime();
      end = new Date(year, month, 1).getTime();
    } else if (range === "quarter") {
      const quarterStart = Math.floor(month / 3) * 3;
      start = new Date(year, quarterStart, 1).getTime();
      end = new Date(year, quarterStart + 3, 1).getTime();
    } else if (range === "year") {
      start = new Date(year, 0, 1).getTime();
      end = new Date(year + 1, 0, 1).getTime();
    } else {
      start = new Date(year, month, 1).getTime();
      end = new Date(year, month + 1, 1).getTime();
    }
    const first = new Date(start);
    const lastExclusive = new Date(end);
    bankStart = Date.UTC(first.getFullYear(), first.getMonth(), first.getDate());
    bankEnd = Date.UTC(lastExclusive.getFullYear(), lastExclusive.getMonth(), lastExclusive.getDate());
  }

  return {
    start,
    end,
    bankStart,
    bankEnd,
    startLabel: dateInput(start),
    endLabel: dateInput(end - 1),
  };
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

type Summary = {
  revenueCents: number;
  revenueFromPaymentsCents: number;
  revenueFromInvoicesCents: number;
  revenueFromBankCents: number;
  revenueFromPackagesCents: number;
  revenueFromMembershipsCents: number;
  expensesCents: number;
  netCents: number;
  marginPct: number;
  bank: {
    cashInCents: number; cashOutCents: number; cashNetCents: number;
    cashOnHandCents: number; cardOwedCents: number;
    foreignCurrencyRows: number; foreignCurrencyAccounts: number;
  };
  reconciliation: { unmatchedOutflows: number; unmatchedInflows: number; receiptsUnmatched: number; receiptsNeedingReview: number; expensesWithoutReceipt: number };
  byTaxCategory: Array<{ taxCategory: string; amountCents: number }>;
  byIncomeCategory: Array<{ category: string; amountCents: number }>;
  stripe: {
    grossSalesCents: number; feesCents: number; refundsCents: number; disputesCents: number;
    adjustmentsCents: number; clearingNetCents: number; payoutsCents: number; unmatchedPayouts: number;
    foreignCurrencyEntries: number; foreignCurrencyPayouts: number;
  };
};

export function pnlSummaryCsv(report: Summary, bounds: FinancialBounds): string {
  return csv([
    ["Pulse P&L summary", `${bounds.startLabel} through ${bounds.endLabel}`],
    ["Metric", "Amount (USD)"],
    ["Collected revenue", (report.revenueCents / 100).toFixed(2)],
    ["Booking payments", (report.revenueFromPaymentsCents / 100).toFixed(2)],
    ["Paid invoices", (report.revenueFromInvoicesCents / 100).toFixed(2)],
    ["Prepaid packages", (report.revenueFromPackagesCents / 100).toFixed(2)],
    ["Memberships", (report.revenueFromMembershipsCents / 100).toFixed(2)],
    ["Classified bank income", (report.revenueFromBankCents / 100).toFixed(2)],
    ["Operating expenses", (report.expensesCents / 100).toFixed(2)],
    ["Net profit", (report.netCents / 100).toFixed(2)],
    ["Margin", `${(report.marginPct * 100).toFixed(1)}%`],
    ["Bank money in (cash movement only)", (report.bank.cashInCents / 100).toFixed(2)],
    ["Bank money out (cash movement only)", (report.bank.cashOutCents / 100).toFixed(2)],
    ["Net bank movement", (report.bank.cashNetCents / 100).toFixed(2)],
    ["Cash on hand", (report.bank.cashOnHandCents / 100).toFixed(2)],
    ["Credit card balances", (report.bank.cardOwedCents / 100).toFixed(2)],
    ["Foreign-currency bank rows excluded from USD totals", report.bank.foreignCurrencyRows],
    ["Foreign-currency accounts excluded from USD totals", report.bank.foreignCurrencyAccounts],
    ["Unmatched bank outflows", report.reconciliation.unmatchedOutflows],
    ["Unclassified bank inflows", report.reconciliation.unmatchedInflows],
    ["Unmatched receipts", report.reconciliation.receiptsUnmatched],
    ["Receipts needing review", report.reconciliation.receiptsNeedingReview],
    ["Expenses without documentation", report.reconciliation.expensesWithoutReceipt],
    [],
    ["Stripe clearing", "Amount (USD)"],
    ["Gross card sales", (report.stripe.grossSalesCents / 100).toFixed(2)],
    ["Processing fees", (report.stripe.feesCents / 100).toFixed(2)],
    ["Refunds", (report.stripe.refundsCents / 100).toFixed(2)],
    ["Disputes", (report.stripe.disputesCents / 100).toFixed(2)],
    ["Clearing net", (report.stripe.clearingNetCents / 100).toFixed(2)],
    ["Payouts deposited", (report.stripe.payoutsCents / 100).toFixed(2)],
    ["Payouts needing review", report.stripe.unmatchedPayouts],
    ["Foreign-currency Stripe rows excluded from USD summary", report.stripe.foreignCurrencyEntries],
    ["Foreign-currency Stripe payouts excluded from USD summary", report.stripe.foreignCurrencyPayouts],
    [],
    ["Income category", "Amount (USD)"],
    ...report.byIncomeCategory.map((group) => [group.category, (group.amountCents / 100).toFixed(2)]),
    [],
    ["Tax report group", "Amount (USD)"],
    ...report.byTaxCategory.map((group) => [group.taxCategory, (group.amountCents / 100).toFixed(2)]),
  ]);
}

type StripeSettlement = {
  entries: Array<{
    balanceTransactionId: string; payoutProviderId: string | null; type: string; reportingCategory: string | null;
    grossCents: number; feeCents: number; netCents: number; currency: string; occurredAt: number; description: string | null;
  }>;
  payouts: Array<{
    stripePayoutId: string; amountCents: number; currency: string; status: string; arrivalDate: number | null;
    reconciliationStatus: string; bankTransactionId: unknown | null; lastError: string | null;
  }>;
  truncated: boolean;
};

export function stripeSettlementCsv(report: StripeSettlement): string {
  return csv([
    ...(report.truncated ? [["WARNING", "Export is limited to 5,000 Stripe rows. Narrow the report period for a complete file."]] : []),
    ["Stripe balance activity"],
    ["Occurred", "Balance transaction", "Payout", "Type", "Reporting category", "Gross", "Fee", "Net", "Currency", "Description"],
    ...report.entries.map((entry) => [
      new Date(entry.occurredAt).toISOString(), entry.balanceTransactionId, entry.payoutProviderId ?? "",
      entry.type, entry.reportingCategory ?? "", (entry.grossCents / 100).toFixed(2),
      (entry.feeCents / 100).toFixed(2), (entry.netCents / 100).toFixed(2), entry.currency, entry.description ?? "",
    ]),
    [],
    ["Stripe payouts"],
    ["Arrival date", "Payout", "Amount", "Currency", "Status", "Reconciliation", "Bank matched", "Review note"],
    ...report.payouts.map((payout) => [
      payout.arrivalDate ? dateInput(payout.arrivalDate) : "", payout.stripePayoutId,
      (payout.amountCents / 100).toFixed(2), payout.currency, payout.status, payout.reconciliationStatus,
      payout.bankTransactionId ? "yes" : "no", payout.lastError ?? "",
    ]),
  ]);
}

type BankExportRow = {
  date: number;
  name: string;
  merchantName: string | null;
  amountCents: number;
  currency: string;
  direction: "in" | "out";
  category: string | null;
  moneyInKind: string | null;
  incomeCategory: string | null;
  excluded: boolean;
  pending: boolean;
  expense: { _id: unknown } | null;
  receipt: { _id: unknown } | null;
  account: { name: string; mask: string | null } | null;
};

export function bankReconciliationCsv(rows: BankExportRow[], truncated: boolean): string {
  return csv([
    ...(truncated ? [["WARNING", "Export is limited to 1,000 bank rows. Narrow the report period for a complete file."]] : []),
    ["Date", "Account", "Description", "Direction", "Amount", "Currency", "Classification", "Income category", "Expense matched", "Receipt matched", "Pending", "Review status"],
    ...rows.map((row) => [
      dateInput(row.date),
      row.account ? `${row.account.name}${row.account.mask ? ` ••${row.account.mask}` : ""}` : "",
      row.merchantName ?? row.name,
      row.direction,
      (row.amountCents / 100).toFixed(2),
      row.currency,
      row.direction === "in" ? row.moneyInKind ?? "" : row.category ?? "",
      row.incomeCategory ?? "",
      row.expense ? "yes" : "no",
      row.receipt ? "yes" : "no",
      row.pending ? "yes" : "no",
      row.pending ? "pending" : row.direction === "in" ? row.moneyInKind ? "reviewed" : "needs attention" : row.excluded || row.expense ? "reviewed" : "needs attention",
    ]),
  ]);
}

type ExpenseDetail = {
  date: number;
  vendor?: string;
  description?: string;
  category: string;
  amountCents: number;
  source?: "manual" | "receipt" | "bank";
  receiptId?: unknown;
  receiptDocId?: unknown;
  bankTransactionId?: unknown;
  notes?: string;
};

export function expenseDetailCsv(expenses: ExpenseDetail[]): string {
  return csv([
    ["Date", "Vendor", "Category", "Tax report group", "Description", "Amount (USD)", "Source", "Receipt", "Bank matched", "Notes"],
    ...expenses.map((expense) => [
      dateInput(expense.date),
      expense.vendor ?? "",
      EXPENSE_CATEGORY_LABEL.get(expense.category) ?? expense.category,
      EXPENSE_TAX_GROUP.get(expense.category) ?? "Accountant review",
      expense.description ?? "",
      (expense.amountCents / 100).toFixed(2),
      expense.source ?? "manual",
      expense.receiptId || expense.receiptDocId ? "yes" : "no",
      expense.bankTransactionId ? "yes" : "no",
      expense.notes ?? "",
    ]),
  ]);
}
