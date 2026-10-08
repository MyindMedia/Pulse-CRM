/* ============================================================
   Financial statements from the ledger. Pure: no Convex imports.

   income statement   revenue and expenses for [start, end), by line
   balance sheet      balances at `end`, retained earnings DERIVED, and an
                      A = L + E check computed from account balances (no plug)
   cash flow          direct method; each non-cash line of a cash entry is
                      classified by its own account's cash flow line
   checks             what a careful bookkeeper would look at before signing
   variances          recomputed minus what the owner's books reported

   openspec/changes/ledger-books-statements
   ============================================================ */

import {
  type LedgerAccount,
  type LedgerEntry,
  type OpeningBalances,
  type Period,
  formatCents,
  isBalanced,
  isoDay,
  normalSign,
  postedOnly,
  signedActivity,
  signedBalances,
  entryTotalCents,
} from "./ledgerMath";

export type LineKind = "line" | "total";

export type StatementLine = {
  key: string;
  label: string;
  cents: number;
  kind: LineKind;
  section: string;
  /** Accounts that make up the line (recomputed statements only). */
  accountIds?: string[];
  /** True for a line the engine derives rather than reads from an account. */
  derived?: boolean;
};

/** A line as the owner's books reported it (stored in reportedStatements). */
export type ReportedLine = {
  key: string;
  label: string;
  cents: number;
  kind: LineKind;
  section: string;
  /** The spreadsheet formula, when the value was computed, e.g. "=SUM(E6:E10)". */
  formula?: string;
  /** Source cell, e.g. "B7". */
  cell?: string;
};

export type ImportWarning = {
  code: string;
  severity: "info" | "warn" | "error";
  message: string;
  sheet?: string;
  row?: number;
  cell?: string;
  raw?: string;
  normalized?: string;
};

export type ReportedStatements = {
  entityName: string;
  periodStart: number;
  periodEnd: number;
  balanceSheet: ReportedLine[];
  incomeStatement: ReportedLine[];
  cashFlow: ReportedLine[];
  warnings: ImportWarning[];
  /** When the workbook was imported: the moment the owner's checked figures
   *  were fixed. A late entry entered after this is a change since reported. */
  importedAt?: number;
};

// ── Labels ──────────────────────────────────────────────────

export const TOTAL_LABELS: Readonly<Record<string, string>> = {
  total_revenue: "Total Revenue",
  total_expenses: "Total Expenses",
  net_income: "Net Income (Loss)",
  total_current_assets: "Total Current Assets",
  total_noncurrent_assets: "Total Non-Current Assets",
  total_assets: "Total Assets",
  total_liabilities: "Total Liabilities",
  total_equity: "Total Equity",
  total_liabilities_and_equity: "Total Liabilities + Equity",
  net_operating: "Net Cash from Operating Activities",
  net_investing: "Net Cash from Investing Activities",
  net_financing: "Net Cash from Financing Activities",
  net_change: "Net Change in Cash",
  beginning_cash: "Beginning Cash Balance",
  ending_cash: "Ending Cash Balance",
};

/** Cash flow lines in the owner's order. Keys not listed sort after these. */
export const CASH_FLOW_LINES: readonly { key: string; label: string }[] = [
  { key: "operating.customer_receipts", label: "Cash received from customers" },
  { key: "operating.rent", label: "Rent payments" },
  { key: "operating.processing_fees", label: "Merchant processing fees" },
  { key: "operating.professional_services", label: "Professional services" },
  { key: "operating.insurance", label: "Insurance" },
  { key: "operating.internet", label: "Internet" },
  { key: "operating.advertising", label: "Advertising / Promotion" },
  { key: "operating.software", label: "Software and subscriptions" },
  { key: "operating.interest_and_card_fees", label: "Credit card interest and fees" },
  { key: "operating.bank_fees", label: "Bank service fees" },
  { key: "operating.prepaid_services", label: "Prepaid services" },
  { key: "operating.other", label: "Other operating" },
  { key: "investing.equipment", label: "Equipment, furniture and fixtures" },
  { key: "investing.security_deposit", label: "Security deposit" },
  { key: "investing.other", label: "Other investing" },
  { key: "financing.owner_contributions", label: "Owner contributions deposited" },
  { key: "financing.partner_deposits", label: "Partner investment deposits" },
  { key: "financing.owner_held_funds", label: "Business funds held by owner, deposited" },
  { key: "financing.owner_reimbursement", label: "Owner reimbursement of personal expenditure" },
  { key: "financing.owner_draws", label: "Owner draws" },
  { key: "financing.credit_card_payments", label: "Credit card payments" },
  { key: "financing.installment_payments", label: "Installment payments" },
  { key: "financing.other", label: "Other financing" },
];
const CF_LABEL = new Map(CASH_FLOW_LINES.map((l) => [l.key, l.label]));
const CF_ORDER = new Map(CASH_FLOW_LINES.map((l, i) => [l.key, i]));

function cfSection(key: string): "operating" | "investing" | "financing" | "unclassified" {
  const head = key.split(".")[0];
  return head === "operating" || head === "investing" || head === "financing" ? head : "unclassified";
}

function byOrder(a: LedgerAccount, b: LedgerAccount) {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** Group accounts into statement lines by their statementLine key, in chart
 *  order, with `value(account)` as each account's contribution. */
function groupLines(
  accounts: readonly LedgerAccount[],
  section: (a: LedgerAccount) => string,
  value: (a: LedgerAccount) => number,
): StatementLine[] {
  const out = new Map<string, StatementLine>();
  for (const a of [...accounts].sort(byOrder)) {
    const key = a.statementLine || `unmapped.${a.key}`;
    const line = out.get(key);
    if (line) {
      line.cents += value(a);
      line.accountIds!.push(a.id);
    } else {
      out.set(key, { key, label: a.name, cents: value(a), kind: "line", section: section(a), accountIds: [a.id] });
    }
  }
  return [...out.values()];
}

// ── Income statement ────────────────────────────────────────

export type IncomeStatement = {
  start: number;
  end: number;
  revenue: StatementLine[];
  expenses: StatementLine[];
  totalRevenueCents: number;
  totalExpensesCents: number;
  netIncomeCents: number;
  /** Flat list with totals, in reading order. */
  lines: StatementLine[];
};

export function incomeStatement(
  accounts: readonly LedgerAccount[],
  entries: readonly LedgerEntry[],
  start: number,
  end: number,
): IncomeStatement {
  const act = signedActivity(entries, start, end);
  const rev = accounts.filter((a) => a.type === "revenue");
  const exp = accounts.filter((a) => a.type === "expense");
  const revenue = groupLines(rev, () => "revenue", (a) => -(act.get(a.id) ?? 0));
  const expenses = groupLines(exp, () => "expenses", (a) => act.get(a.id) ?? 0);
  const totalRevenueCents = revenue.reduce((s, l) => s + l.cents, 0);
  const totalExpensesCents = expenses.reduce((s, l) => s + l.cents, 0);
  const netIncomeCents = totalRevenueCents - totalExpensesCents;
  const t = (key: string, cents: number, section: string): StatementLine =>
    ({ key, label: TOTAL_LABELS[key], cents, kind: "total", section });
  return {
    start, end, revenue, expenses, totalRevenueCents, totalExpensesCents, netIncomeCents,
    lines: [
      ...revenue, t("total_revenue", totalRevenueCents, "revenue"),
      ...expenses, t("total_expenses", totalExpensesCents, "expenses"),
      t("net_income", netIncomeCents, "net_income"),
    ],
  };
}

// ── Balance sheet ───────────────────────────────────────────

export type BalanceSheet = {
  /** Balances at the start of this day (exclusive end of the period). */
  asOf: number;
  currentAssets: StatementLine[];
  noncurrentAssets: StatementLine[];
  currentLiabilities: StatementLine[];
  longTermLiabilities: StatementLine[];
  equity: StatementLine[];
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  totalLiabilitiesAndEquityCents: number;
  retainedEarnings: {
    /** Balance of the retained earnings account(s), from opening balances. */
    openingCents: number;
    /** Income earned after the opening date but before this period. */
    priorUnclosedIncomeCents: number;
    /** This period's net income. */
    currentPeriodNetIncomeCents: number;
    totalCents: number;
  };
  /** A = L + E, from account balances. Never forced by a plug. */
  balanced: boolean;
  differenceCents: number;
  lines: StatementLine[];
};

export function balanceSheet(
  accounts: readonly LedgerAccount[],
  opening: OpeningBalances | null,
  entries: readonly LedgerEntry[],
  periodStart: number,
  end: number,
): BalanceSheet {
  const bal = signedBalances(accounts, opening, entries, end);
  const signed = (a: LedgerAccount) => bal.get(a.id) ?? 0;
  const assets = accounts.filter((a) => a.type === "asset");
  const liabilities = accounts.filter((a) => a.type === "liability");
  const ownerEquity = accounts.filter((a) => a.type === "equity" && a.subtype !== "retained_earnings");
  const reAccounts = accounts.filter((a) => a.type === "equity" && a.subtype === "retained_earnings");
  const income = accounts.filter((a) => a.type === "revenue" || a.type === "expense");

  const currentAssets = groupLines(assets.filter((a) => a.subtype !== "noncurrent_asset"), () => "current_assets", signed);
  const noncurrentAssets = groupLines(assets.filter((a) => a.subtype === "noncurrent_asset"), () => "noncurrent_assets", signed);
  const currentLiabilities = groupLines(liabilities.filter((a) => a.subtype !== "long_term_liability"), () => "current_liabilities", (a) => -signed(a));
  const longTermLiabilities = groupLines(liabilities.filter((a) => a.subtype === "long_term_liability"), () => "long_term_liabilities", (a) => -signed(a));
  const ownerLines = groupLines(ownerEquity, () => "equity", (a) => -signed(a));

  const reOpening = reAccounts.reduce((s, a) => s + -signed(a), 0);
  const incomeSinceOpening = income.reduce((s, a) => s + -signed(a), 0);
  const current = incomeStatement(accounts, entries, Math.max(periodStart, opening?.asOf ?? -Infinity), end).netIncomeCents;
  const retainedEarnings = {
    openingCents: reOpening,
    priorUnclosedIncomeCents: incomeSinceOpening - current,
    currentPeriodNetIncomeCents: current,
    totalCents: reOpening + incomeSinceOpening,
  };
  const reLine: StatementLine = {
    key: "equity.retained_earnings",
    label: reAccounts[0]?.name ?? "Retained Earnings",
    cents: retainedEarnings.totalCents,
    kind: "line",
    section: "equity",
    accountIds: reAccounts.map((a) => a.id),
    derived: true,
  };
  const equity = [...ownerLines, reLine];

  const sum = (ls: StatementLine[]) => ls.reduce((s, l) => s + l.cents, 0);
  const totalAssetsCents = sum(currentAssets) + sum(noncurrentAssets);
  const totalLiabilitiesCents = sum(currentLiabilities) + sum(longTermLiabilities);
  const totalEquityCents = sum(equity);
  const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents;
  const t = (key: string, cents: number, section: string): StatementLine =>
    ({ key, label: TOTAL_LABELS[key], cents, kind: "total", section });
  return {
    asOf: end,
    currentAssets, noncurrentAssets, currentLiabilities, longTermLiabilities, equity,
    totalAssetsCents, totalLiabilitiesCents, totalEquityCents, totalLiabilitiesAndEquityCents,
    retainedEarnings,
    balanced: totalAssetsCents === totalLiabilitiesAndEquityCents,
    differenceCents: totalAssetsCents - totalLiabilitiesAndEquityCents,
    lines: [
      ...currentAssets, t("total_current_assets", sum(currentAssets), "current_assets"),
      ...noncurrentAssets, t("total_noncurrent_assets", sum(noncurrentAssets), "noncurrent_assets"),
      t("total_assets", totalAssetsCents, "assets"),
      ...currentLiabilities, ...longTermLiabilities,
      t("total_liabilities", totalLiabilitiesCents, "liabilities"),
      ...equity, t("total_equity", totalEquityCents, "equity"),
      t("total_liabilities_and_equity", totalLiabilitiesAndEquityCents, "liabilities_and_equity"),
    ],
  };
}

// ── Cash flow (direct method) ───────────────────────────────

export type CashFlow = {
  start: number;
  end: number;
  operating: StatementLine[];
  investing: StatementLine[];
  financing: StatementLine[];
  /** Cash moved against accounts with no cash flow line. Also a failed check. */
  unclassified: StatementLine[];
  netOperatingCents: number;
  netInvestingCents: number;
  netFinancingCents: number;
  netUnclassifiedCents: number;
  netChangeCents: number;
  beginningCashCents: number;
  endingCashCents: number;
  /** Ending minus beginning cash from balances; equals netChangeCents when the ledger ties. */
  ledgerCashChangeCents: number;
  lines: StatementLine[];
};

export function cashFlow(
  accounts: readonly LedgerAccount[],
  opening: OpeningBalances | null,
  entries: readonly LedgerEntry[],
  start: number,
  end: number,
): CashFlow {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cashIds = new Set(accounts.filter((a) => a.isCash).map((a) => a.id));
  const flows = new Map<string, { cents: number; accountIds: Set<string>; label: string }>();
  const add = (key: string, label: string, cents: number, accountId: string) => {
    const f = flows.get(key) ?? { cents: 0, accountIds: new Set<string>(), label };
    f.cents += cents;
    f.accountIds.add(accountId);
    flows.set(key, f);
  };
  for (const e of postedOnly(entries)) {
    if (e.entryDate < start || e.entryDate >= end) continue;
    if (!e.lines.some((l) => cashIds.has(l.accountId))) continue;
    for (const l of e.lines) {
      if (cashIds.has(l.accountId)) continue;
      const amount = l.creditCents - l.debitCents; // cash effect of this counter line
      if (amount === 0) continue;
      const a = byId.get(l.accountId);
      const key = a
        ? (amount > 0 && a.cashFlowLineInflow) || a.cashFlowLine || `unclassified.${a.key}`
        : `unclassified.${l.accountId}`;
      const label = CF_LABEL.get(key) ?? a?.name ?? "Unknown account";
      add(key, label, amount, l.accountId);
    }
  }
  const all: StatementLine[] = [...flows.entries()]
    .map(([key, f]) => ({
      key, label: f.label, cents: f.cents, kind: "line" as const, section: cfSection(key), accountIds: [...f.accountIds],
    }))
    .sort((a, b) => (CF_ORDER.get(a.key) ?? 999) - (CF_ORDER.get(b.key) ?? 999) || a.key.localeCompare(b.key));
  const pick = (s: string) => all.filter((l) => l.section === s);
  const operating = pick("operating");
  const investing = pick("investing");
  const financing = pick("financing");
  const unclassified = pick("unclassified");
  const sum = (ls: StatementLine[]) => ls.reduce((s, l) => s + l.cents, 0);
  const netOperatingCents = sum(operating);
  const netInvestingCents = sum(investing);
  const netFinancingCents = sum(financing);
  const netUnclassifiedCents = sum(unclassified);
  const netChangeCents = netOperatingCents + netInvestingCents + netFinancingCents + netUnclassifiedCents;
  const cashAt = (ms: number) => {
    const b = signedBalances(accounts, opening, entries, ms);
    let s = 0;
    for (const id of cashIds) s += b.get(id) ?? 0;
    return s;
  };
  const beginningCashCents = cashAt(start);
  const endingCashCents = cashAt(end);
  const t = (key: string, cents: number, section: string): StatementLine =>
    ({ key, label: TOTAL_LABELS[key], cents, kind: "total", section });
  return {
    start, end, operating, investing, financing, unclassified,
    netOperatingCents, netInvestingCents, netFinancingCents, netUnclassifiedCents, netChangeCents,
    beginningCashCents, endingCashCents, ledgerCashChangeCents: endingCashCents - beginningCashCents,
    lines: [
      ...operating, t("net_operating", netOperatingCents, "operating"),
      ...investing, t("net_investing", netInvestingCents, "investing"),
      ...financing, t("net_financing", netFinancingCents, "financing"),
      ...unclassified,
      t("net_change", netChangeCents, "summary"),
      t("beginning_cash", beginningCashCents, "summary"),
      t("ending_cash", endingCashCents, "summary"),
    ],
  };
}

// ── Variances ───────────────────────────────────────────────

export type Variance = {
  statement: "incomeStatement" | "balanceSheet" | "cashFlow";
  key: string;
  label: string;
  kind: LineKind;
  reportedCents: number;
  recomputedCents: number;
  /** recomputed - reported */
  varianceCents: number;
  reportedMissing?: boolean;
  recomputedMissing?: boolean;
};

export type Variances = {
  incomeStatement: Variance[];
  balanceSheet: Variance[];
  cashFlow: Variance[];
};

function diffLines(
  statement: Variance["statement"],
  reported: readonly ReportedLine[],
  recomputed: readonly StatementLine[],
): Variance[] {
  const rep = new Map<string, ReportedLine>();
  for (const l of reported) if (!rep.has(l.key)) rep.set(l.key, l);
  const rec = new Map<string, StatementLine>();
  for (const l of recomputed) if (!rec.has(l.key)) rec.set(l.key, l);
  const keys = [...new Set([...rec.keys(), ...rep.keys()])];
  const out: Variance[] = [];
  for (const key of keys) {
    const r = rep.get(key);
    const c = rec.get(key);
    const reportedCents = r?.cents ?? 0;
    const recomputedCents = c?.cents ?? 0;
    if (reportedCents === recomputedCents) continue;
    // A subtotal the owner never reported is not a disagreement.
    if (!r && c?.kind === "total") continue;
    out.push({
      statement, key,
      label: r?.label ?? c?.label ?? key,
      kind: r?.kind ?? c?.kind ?? "line",
      reportedCents, recomputedCents, varianceCents: recomputedCents - reportedCents,
      ...(r ? {} : { reportedMissing: true }),
      ...(c ? {} : { recomputedMissing: true }),
    });
  }
  return out;
}

export function variances(
  reported: Pick<ReportedStatements, "incomeStatement" | "balanceSheet" | "cashFlow">,
  recomputed: { incomeStatement: IncomeStatement; balanceSheet: BalanceSheet; cashFlow: CashFlow },
): Variances {
  return {
    incomeStatement: diffLines("incomeStatement", reported.incomeStatement, recomputed.incomeStatement.lines),
    balanceSheet: diffLines("balanceSheet", reported.balanceSheet, recomputed.balanceSheet.lines),
    cashFlow: diffLines("cashFlow", reported.cashFlow, recomputed.cashFlow.lines),
  };
}

// ── Checks ──────────────────────────────────────────────────

export type CheckStatus = "pass" | "warn" | "fail";
export type Check = {
  code: string;
  status: CheckStatus;
  message: string;
  amountCents?: number;
  detail?: unknown;
};

export type BankStatementBalance = {
  accountLabel: string;
  ledgerAccountId?: string;
  periodStart: number;
  periodEnd: number;
  beginningCents: number;
  endingCents: number;
  depositsCents: number;
  withdrawalsCents: number;
  feesCents: number;
};

export type BankReconciliationRow = {
  accountLabel: string;
  ledgerAccountIds: string[];
  bankBeginningCents: number;
  bankEndingCents: number;
  bankNetChangeCents: number;
  /** beginning + deposits - withdrawals - fees - ending; 0 when the statement adds up. */
  bankArithmeticDiffCents: number;
  ledgerBeginningCents: number;
  ledgerEndingCents: number;
  ledgerNetChangeCents: number;
  beginningVarianceCents: number;
  endingVarianceCents: number;
  netChangeVarianceCents: number;
  /** Clearing accounts still holding money at period end: money the books
   *  received but the bank never saw, or saw under another line. */
  unclearedClearing: { accountId: string; name: string; cents: number }[];
  unclearedClearingTotalCents: number;
  /** ending variance not explained by uncleared clearing balances. */
  unexplainedCents: number;
};

export function bankReconciliation(
  accounts: readonly LedgerAccount[],
  opening: OpeningBalances | null,
  entries: readonly LedgerEntry[],
  bank: readonly BankStatementBalance[],
): BankReconciliationRow[] {
  return bank.map((b) => {
    const ids = b.ledgerAccountId
      ? [b.ledgerAccountId]
      : accounts.filter((a) => a.isCash).map((a) => a.id);
    const at = (ms: number) => {
      const bal = signedBalances(accounts, opening, entries, ms);
      return ids.reduce((s, id) => s + (bal.get(id) ?? 0), 0);
    };
    const ledgerBeginningCents = at(b.periodStart);
    const ledgerEndingCents = at(b.periodEnd);
    const endBal = signedBalances(accounts, opening, entries, b.periodEnd);
    const unclearedClearing = accounts
      .filter((a) => a.isClearing && (endBal.get(a.id) ?? 0) !== 0)
      .map((a) => ({ accountId: a.id, name: a.name, cents: normalSign(a) * (endBal.get(a.id) ?? 0) }));
    const unclearedClearingTotalCents = unclearedClearing.reduce((s, c) => s + c.cents, 0);
    const endingVarianceCents = ledgerEndingCents - b.endingCents;
    return {
      accountLabel: b.accountLabel,
      ledgerAccountIds: ids,
      bankBeginningCents: b.beginningCents,
      bankEndingCents: b.endingCents,
      bankNetChangeCents: b.endingCents - b.beginningCents,
      bankArithmeticDiffCents: b.beginningCents + b.depositsCents - b.withdrawalsCents - b.feesCents - b.endingCents,
      ledgerBeginningCents,
      ledgerEndingCents,
      ledgerNetChangeCents: ledgerEndingCents - ledgerBeginningCents,
      beginningVarianceCents: ledgerBeginningCents - b.beginningCents,
      endingVarianceCents,
      netChangeVarianceCents: (ledgerEndingCents - ledgerBeginningCents) - (b.endingCents - b.beginningCents),
      unclearedClearing,
      unclearedClearingTotalCents,
      unexplainedCents: endingVarianceCents + unclearedClearingTotalCents,
    };
  });
}

export type ChecksInput = {
  period: Period;
  accounts: readonly LedgerAccount[];
  opening: OpeningBalances | null;
  /** Every entry the API loaded: from the opening date to the period end,
   *  plus any entry the books filed under this period. */
  entries: readonly LedgerEntry[];
  bank: readonly BankStatementBalance[];
  reported: ReportedStatements | null;
  statements: { incomeStatement: IncomeStatement; balanceSheet: BalanceSheet; cashFlow: CashFlow };
  variances: Variances | null;
};

const STATEMENT_WARNING_CODES = new Set([
  "beginning_cash_label_date",
  "retained_earnings_plug",
  "hardcoded_statement_values",
  "formula_cache_mismatch",
  "unmapped_statement_label",
  "statement_heading_date",
]);

export function runChecks(input: ChecksInput): Check[] {
  const { period, accounts, opening, entries, bank, reported, statements } = input;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const inPeriod = entries.filter((e) => e.entryDate >= period.start && e.entryDate < period.end);
  const postedInPeriod = postedOnly(inPeriod);
  const checks: Check[] = [];
  const money = (c: number) => formatCents(c);

  // 1. Every posted entry balances.
  const unbalanced = postedOnly(entries).filter((e) => !isBalanced(e.lines));
  checks.push(unbalanced.length
    ? { code: "balanced_entries", status: "fail", message: `${unbalanced.length} posted entries do not balance.`, detail: unbalanced.map((e) => ({ id: e.id, date: isoDay(e.entryDate), memo: e.memo })) }
    : { code: "balanced_entries", status: "pass", message: `All ${postedInPeriod.length} posted entries in the period balance.` });

  // 2. Opening balances balance.
  if (opening) {
    let s = 0;
    for (const l of opening.lines) {
      const a = byId.get(l.accountId);
      if (a) s += normalSign(a) * l.cents;
    }
    checks.push(s === 0
      ? { code: "opening_balanced", status: "pass", message: `Opening balances at ${isoDay(opening.asOf)} balance.` }
      : { code: "opening_balanced", status: "fail", message: `Opening balances are off by ${money(s)}.`, amountCents: s });
  } else {
    checks.push({ code: "opening_balanced", status: "warn", message: "No opening balances. Balance sheet figures start from zero." });
  }

  // 3. A = L + E without a plug.
  const bs = statements.balanceSheet;
  checks.push(bs.balanced
    ? { code: "balance_sheet_balances", status: "pass", message: `Assets ${money(bs.totalAssetsCents)} = Liabilities ${money(bs.totalLiabilitiesCents)} + Equity ${money(bs.totalEquityCents)}, from account balances (no plug).` }
    : { code: "balance_sheet_balances", status: "fail", message: `Assets and liabilities plus equity differ by ${money(bs.differenceCents)}.`, amountCents: bs.differenceCents });

  // 4. Cash flow ties to the ledger's cash change.
  const cf = statements.cashFlow;
  const tie = cf.netChangeCents - cf.ledgerCashChangeCents;
  checks.push(tie === 0
    ? { code: "cash_flow_ties", status: "pass", message: `Cash flow net change ${money(cf.netChangeCents)} equals the ledger's cash change.` }
    : { code: "cash_flow_ties", status: "fail", message: `Cash flow net change differs from the ledger's cash change by ${money(tie)}.`, amountCents: tie });

  // 5. Cash per ledger vs the bank statement.
  const recon = bankReconciliation(accounts, opening, entries, bank.filter((b) => b.periodStart === period.start && b.periodEnd === period.end));
  if (!recon.length) {
    checks.push({ code: "cash_vs_bank", status: "warn", message: "No bank statement balance for this period, so cash is not reconciled." });
  }
  for (const r of recon) {
    const ok = r.endingVarianceCents === 0 && r.netChangeVarianceCents === 0 && r.beginningVarianceCents === 0;
    checks.push({
      code: "cash_vs_bank",
      status: ok ? "pass" : "fail",
      message: ok
        ? `Cash per ledger matches the ${r.accountLabel} statement: ${money(r.bankEndingCents)}.`
        : `Cash per ledger changed ${money(r.ledgerNetChangeCents)}; the ${r.accountLabel} statement changed ${money(r.bankNetChangeCents)}. Ending cash differs by ${money(r.endingVarianceCents)}.`,
      amountCents: r.endingVarianceCents,
      detail: r,
    });
  }

  // 6. Accounts that cannot be placed on a statement.
  const used = new Set<string>();
  for (const e of inPeriod) for (const l of e.lines) used.add(l.accountId);
  const unknown = [...used].filter((id) => !byId.has(id));
  const unmapped = [...used].map((id) => byId.get(id)).filter((a): a is LedgerAccount => !!a && (!a.statementLine || a.statementLine.startsWith("unmapped")));
  const cashIds = new Set(accounts.filter((a) => a.isCash).map((a) => a.id));
  const noCashLine = cf.unclassified.flatMap((l) => l.accountIds ?? []);
  const unclassifiedCount = unknown.length + unmapped.length + noCashLine.length;
  checks.push(unclassifiedCount
    ? { code: "unclassified_accounts", status: "fail", message: `${unclassifiedCount} accounts used this period have no statement or cash flow line.`, detail: { unknownAccountIds: unknown, noStatementLine: unmapped.map((a) => a.name), noCashFlowLine: noCashLine.map((id) => byId.get(id)?.name ?? id) } }
    : { code: "unclassified_accounts", status: "pass", message: "Every account used this period is classified." });

  // 7. Receipts the books say are missing.
  const noReceipt = postedInPeriod.filter((e) => e.receiptStatus === "no");
  checks.push(noReceipt.length
    ? { code: "receipts_missing", status: "warn", message: `${noReceipt.length} entries have no receipt.`, amountCents: noReceipt.reduce((s, e) => s + entryTotalCents(e.lines), 0), detail: noReceipt.map((e) => ({ id: e.id, date: isoDay(e.entryDate), memo: e.memo, cents: entryTotalCents(e.lines), sourceRef: e.sourceRef })) }
    : { code: "receipts_missing", status: "pass", message: "Every entry this period has a receipt or is pending one." });

  // 8. Clearing accounts (deposits in transit, funds held by the owner) left holding money.
  const endBal = signedBalances(accounts, opening, entries, period.end);
  const uncleared = accounts
    .filter((a) => a.isClearing && (endBal.get(a.id) ?? 0) !== 0)
    .map((a) => {
      const debits = postedInPeriod.flatMap((e) => e.lines.filter((l) => l.accountId === a.id && l.debitCents > 0).map((l) => ({ id: e.id, date: isoDay(e.entryDate), memo: e.memo, cents: l.debitCents, sourceRef: e.sourceRef })));
      const creditsCents = postedInPeriod.reduce((s, e) => s + e.lines.filter((l) => l.accountId === a.id).reduce((t, l) => t + l.creditCents, 0), 0);
      return { accountId: a.id, name: a.name, endingCents: normalSign(a) * (endBal.get(a.id) ?? 0), creditsCents, debits };
    });
  checks.push(uncleared.length
    ? { code: "clearing_not_cleared", status: "warn", message: uncleared.map((u) => `${u.name} still holds ${money(u.endingCents)} at period end`).join("; ") + ".", amountCents: uncleared.reduce((s, u) => s + u.endingCents, 0), detail: uncleared }
    : { code: "clearing_not_cleared", status: "pass", message: "Clearing accounts are empty at period end." });

  // 9. Negative cash at the end of any day.
  const startCash = [...cashIds].reduce((s, id) => s + (signedBalances(accounts, opening, entries, period.start).get(id) ?? 0), 0);
  const byDay = new Map<number, number>();
  for (const e of postedInPeriod) {
    const d = e.lines.filter((l) => cashIds.has(l.accountId)).reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    if (d) byDay.set(e.entryDate, (byDay.get(e.entryDate) ?? 0) + d);
  }
  let running = startCash;
  const negativeDays: { date: string; cents: number }[] = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    running += byDay.get(day)!;
    if (running < 0) negativeDays.push({ date: isoDay(day), cents: running });
  }
  checks.push(negativeDays.length
    ? { code: "negative_cash", status: "warn", message: `Cash per ledger is negative at the end of ${negativeDays.length} days.`, detail: negativeDays }
    : { code: "negative_cash", status: "pass", message: "Cash per ledger never goes negative this period." });

  // 10. Entries the books filed under this period but dated outside it (or the reverse).
  const outside = entries.filter((e) => e.status !== "void" && e.bookPeriod !== undefined
    && ((e.bookPeriod === period.key && (e.entryDate < period.start || e.entryDate >= period.end))
      || (e.bookPeriod !== period.key && e.entryDate >= period.start && e.entryDate < period.end)));
  checks.push(outside.length
    ? { code: "entries_outside_period", status: "warn", message: `${outside.length} entries are dated outside the period their books filed them under.`, detail: outside.map((e) => ({ id: e.id, date: isoDay(e.entryDate), bookPeriod: e.bookPeriod, memo: e.memo })) }
    : { code: "entries_outside_period", status: "pass", message: "Every entry is dated inside its period." });

  // 11. Possible duplicates: same date, amount and memo.
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of postedInPeriod) {
    const k = `${e.entryDate}|${entryTotalCents(e.lines)}|${e.memo.trim().toLowerCase().replace(/\s+/g, " ")}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const dupes = [...groups.values()].filter((g) => g.length > 1);
  checks.push(dupes.length
    ? { code: "duplicate_entries", status: "warn", message: `${dupes.length} groups of entries share a date, amount and description.`, detail: dupes.map((g) => g.map((e) => ({ id: e.id, date: isoDay(e.entryDate), memo: e.memo, cents: entryTotalCents(e.lines), sourceRef: e.sourceRef }))) }
    : { code: "duplicate_entries", status: "pass", message: "No duplicate entries." });

  // 12. What the importer noticed about the owner's own statements.
  if (reported) {
    const statementWarnings = reported.warnings.filter((w) => STATEMENT_WARNING_CODES.has(w.code));
    checks.push(statementWarnings.length
      ? { code: "reported_statement_warnings", status: "warn", message: statementWarnings.map((w) => w.message).join(" "), detail: statementWarnings }
      : { code: "reported_statement_warnings", status: "pass", message: "The reported statements raised no warnings." });
    const v = input.variances;
    if (v) {
      const lines = [...v.incomeStatement, ...v.balanceSheet, ...v.cashFlow].filter((x) => x.kind === "line");
      checks.push(lines.length
        ? { code: "reported_vs_recomputed", status: "warn", message: `${lines.length} reported lines differ from the ledger.`, detail: lines }
        : { code: "reported_vs_recomputed", status: "pass", message: "The reported statements match the ledger line for line." });
    }
  }
  return checks;
}

// ── Implied opening balances ────────────────────────────────

export type ImpliedOpening = {
  opening: OpeningBalances;
  warnings: ImportWarning[];
};

/** Opening balances implied by a reported CLOSING balance sheet: closing
 *  minus the period's activity, per account. Used when the books start
 *  mid-life and nobody has the prior balance sheet.
 *
 *  - Cash is anchored to the bank's beginning balance when one is given,
 *    so a gap between the journal and the bank stays visible.
 *  - A clearing account is never seeded negative (that would hide money the
 *    books say came in); it is seeded at zero and the gap reported.
 *  - Opening retained earnings is the balancing figure, and says so. */
export function impliedOpeningBalances(args: {
  accounts: readonly LedgerAccount[];
  entries: readonly LedgerEntry[];
  periodStart: number;
  periodEnd: number;
  reportedBalanceSheet: readonly ReportedLine[];
  cashAnchorCents?: number;
}): ImpliedOpening {
  const { accounts, entries, periodStart, periodEnd, reportedBalanceSheet, cashAnchorCents } = args;
  const warnings: ImportWarning[] = [];
  const act = signedActivity(entries, periodStart, periodEnd);
  const reported = new Map<string, number>();
  for (const l of reportedBalanceSheet) if (l.kind === "line" && !reported.has(l.key)) reported.set(l.key, l.cents);
  const claimed = new Set<string>();
  const openingSigned = new Map<string, number>();
  const bsAccounts = accounts
    .filter((a) => (a.type === "asset" || a.type === "liability" || a.type === "equity") && a.subtype !== "retained_earnings")
    .sort(byOrder);
  let anchored = false;
  for (const a of bsAccounts) {
    let displayed = 0;
    if (reported.has(a.statementLine) && !claimed.has(a.statementLine)) {
      displayed = reported.get(a.statementLine)!;
      claimed.add(a.statementLine);
    }
    const closingSigned = a.type === "asset" ? displayed : -displayed;
    let signed = closingSigned - (act.get(a.id) ?? 0);
    if (a.isCash && cashAnchorCents !== undefined && !anchored) {
      if (signed !== cashAnchorCents) {
        warnings.push({
          code: "opening_cash_anchored_to_bank",
          severity: "warn",
          message: `Opening ${a.name} set to the bank's beginning balance ${formatCents(cashAnchorCents)}. The reported closing cash less the journal's cash activity implies ${formatCents(signed)}; the ${formatCents(signed - cashAnchorCents)} gap stays visible in the bank check.`,
        });
      }
      signed = cashAnchorCents;
      anchored = true;
    }
    const normal = normalSign(a) * signed;
    if (a.isClearing && normal < 0) {
      warnings.push({
        code: "opening_clearing_not_negative",
        severity: "warn",
        message: `${a.name}: the reported closing ${formatCents(displayed)} less this period's ${formatCents(normalSign(a) * (act.get(a.id) ?? 0))} would need an opening of ${formatCents(normal)}. Seeded 0.00 instead, so the uncleared balance shows.`,
      });
      signed = 0;
    } else if (normal < 0) {
      warnings.push({
        code: "opening_negative_balance",
        severity: "info",
        message: `${a.name} opens at ${formatCents(normal)}, against its normal balance.`,
      });
    }
    if (signed !== 0) openingSigned.set(a.id, signed);
  }
  const re = accounts.find((a) => a.subtype === "retained_earnings");
  if (!re) throw new Error("The chart has no retained earnings account to balance the opening balances.");
  let total = 0;
  for (const s of openingSigned.values()) total += s;
  openingSigned.set(re.id, -total);
  warnings.push({
    code: "opening_retained_earnings_balancing",
    severity: "info",
    message: `Opening ${re.name} ${formatCents(total)} is the balancing figure of the implied opening balance sheet, not a number from the books.`,
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return {
    opening: {
      asOf: periodStart,
      lines: [...openingSigned.entries()]
        .filter(([, s]) => s !== 0)
        .map(([accountId, s]) => ({ accountId, cents: normalSign(byId.get(accountId)!) * s })),
    },
    warnings,
  };
}

/** The journal's own totals for [start, end): posted entries dated inside the
 *  month, every line summed. Debits equal credits when the books balance. */
export function journalTotals(entries: readonly LedgerEntry[], start: number, end: number) {
  let entryCount = 0;
  let debitCents = 0;
  let creditCents = 0;
  for (const e of postedOnly(entries)) {
    if (e.entryDate < start || e.entryDate >= end) continue;
    entryCount++;
    for (const l of e.lines) {
      debitCents += l.debitCents;
      creditCents += l.creditCents;
    }
  }
  return { entryCount, debitCents, creditCents };
}

// ── Late entries: what changed since the books were reported ─

export type RecomputedStatements = { incomeStatement: IncomeStatement; balanceSheet: BalanceSheet; cashFlow: CashFlow };

/** The three statements for one period. */
export function recomputeStatements(
  period: Period,
  accounts: readonly LedgerAccount[],
  opening: OpeningBalances | null,
  entries: readonly LedgerEntry[],
): RecomputedStatements {
  return {
    incomeStatement: incomeStatement(accounts, entries, period.start, period.end),
    balanceSheet: balanceSheet(accounts, opening, entries, period.start, period.end),
    cashFlow: cashFlow(accounts, opening, entries, period.start, period.end),
  };
}

/** The four figures an owner watches, plus retained earnings for the roll-forward. */
export type HeadlineFigures = {
  revenueCents: number;
  expensesCents: number;
  netIncomeCents: number;
  endingCashCents: number;
  retainedEarningsCents: number;
};

export function headlineFigures(r: RecomputedStatements): HeadlineFigures {
  return {
    revenueCents: r.incomeStatement.totalRevenueCents,
    expensesCents: r.incomeStatement.totalExpensesCents,
    netIncomeCents: r.incomeStatement.netIncomeCents,
    endingCashCents: r.cashFlow.endingCashCents,
    retainedEarningsCents: r.balanceSheet.retainedEarnings.totalCents,
  };
}

export type LateEntrySummary = {
  id: string;
  entryDate: number;
  enteredAt: number;
  enteredBy: string;
  reason: string;
  memo: string;
  totalCents: number;
  kind?: string;
  counterparty?: string;
  reversalOf?: string;
  reversedBy?: string;
  /** Dated inside this period. False for an earlier month's entry that only
   *  moves this period's opening cash and retained earnings. */
  inPeriod: boolean;
  /** This entry's own effect on the period's net income and ending cash. */
  netIncomeEffectCents: number;
  cashEffectCents: number;
};

export type LateLineEffect = {
  statement: "incomeStatement" | "balanceSheet" | "cashFlow";
  key: string;
  label: string;
  kind: LineKind;
  /** null when no workbook was imported, or the workbook has no such line. */
  reportedCents: number | null;
  recomputedCents: number;
  /** What the late entries moved: recomputed now minus recomputed without them. */
  lateEntryCents: number;
  /** recomputed minus reported, when there is a reported figure. Always equals
   *  lateEntryCents + otherCents, to the cent. */
  varianceCents: number | null;
  /** The part of the variance that was there before any late entry. */
  otherCents: number | null;
};

export type LateEntryImpact = {
  /** Late entries count from this moment (the workbook import); null with no workbook. */
  since: number | null;
  count: number;
  entries: LateEntrySummary[];
  /** The period recomputed without the late entries, and with them. */
  before: HeadlineFigures;
  after: HeadlineFigures;
  /** Every statement line the late entries moved, totals included, in reading order. */
  lines: LateLineEffect[];
  /** One sentence for the variance panel and the check. */
  headline: string;
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDay = (ms: number) => {
  const d = new Date(ms);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
const usd = (cents: number) => `${cents < 0 ? "-" : ""}$${formatCents(Math.abs(cents))}`;

/** Is this entry a late entry (or a late entry's reversal) that changed the
 *  period after `since`? Posted only: a draft or void moves nothing. */
export function countsAsLate(e: LedgerEntry, since: number | null): boolean {
  return e.status === "posted" && !!e.late && (since === null || e.late.enteredAt > since);
}

/** What late entries changed in a period, and how much of each variance they
 *  explain. Null when no late entry touches the period. Pure: the period is
 *  rebuilt without the late entries and the two results are compared line by
 *  line, so the split of a variance always adds up exactly. */
export function lateEntryImpact(args: {
  period: Period;
  accounts: readonly LedgerAccount[];
  opening: OpeningBalances | null;
  entries: readonly LedgerEntry[];
  reported: ReportedStatements | null;
  recomputed?: RecomputedStatements;
}): LateEntryImpact | null {
  const { period, accounts, opening, entries, reported } = args;
  const since = reported?.importedAt ?? null;
  const from = opening?.asOf ?? -Infinity;
  const late = entries.filter((e) => countsAsLate(e, since) && e.entryDate < period.end && e.entryDate >= from);
  if (late.length === 0) return null;
  const lateIds = new Set(late.map((e) => e.id));
  const after = args.recomputed ?? recomputeStatements(period, accounts, opening, entries);
  const before = recomputeStatements(period, accounts, opening, entries.filter((e) => !lateIds.has(e.id)));

  const lines: LateLineEffect[] = [];
  for (const statement of ["incomeStatement", "balanceSheet", "cashFlow"] as const) {
    const was = new Map(before[statement].lines.map((l) => [l.key, l.cents]));
    const rep = reported ? new Map(reported[statement].map((l) => [l.key, l.cents])) : null;
    const seen = new Set<string>();
    for (const l of after[statement].lines) {
      if (seen.has(l.key)) continue;
      seen.add(l.key);
      const lateEntryCents = l.cents - (was.get(l.key) ?? 0);
      if (lateEntryCents === 0) continue;
      const reportedCents = rep?.has(l.key) ? rep.get(l.key)! : null;
      lines.push({
        statement, key: l.key, label: l.label, kind: l.kind, reportedCents, recomputedCents: l.cents, lateEntryCents,
        varianceCents: reportedCents === null ? null : l.cents - reportedCents,
        otherCents: reportedCents === null ? null : l.cents - reportedCents - lateEntryCents,
      });
    }
    // A line only the "before" statements had (every late entry's account emptied).
    for (const l of before[statement].lines) {
      if (seen.has(l.key) || l.cents === 0) continue;
      seen.add(l.key);
      const reportedCents = rep?.has(l.key) ? rep.get(l.key)! : null;
      lines.push({
        statement, key: l.key, label: l.label, kind: l.kind, reportedCents, recomputedCents: 0, lateEntryCents: -l.cents,
        varianceCents: reportedCents === null ? null : -reportedCents,
        otherCents: reportedCents === null ? null : -reportedCents + l.cents,
      });
    }
  }

  const byId = new Map(accounts.map((a) => [a.id, a]));
  const summaries: LateEntrySummary[] = late
    .slice()
    .sort((a, b) => a.late!.enteredAt - b.late!.enteredAt || a.entryDate - b.entryDate)
    .map((e) => {
      const inPeriod = e.entryDate >= period.start;
      let ni = 0;
      let cash = 0;
      for (const l of e.lines) {
        const a = byId.get(l.accountId);
        if (inPeriod && (a?.type === "revenue" || a?.type === "expense")) ni += l.creditCents - l.debitCents;
        if (a?.isCash) cash += l.debitCents - l.creditCents;
      }
      return {
        id: e.id, entryDate: e.entryDate, enteredAt: e.late!.enteredAt, enteredBy: e.late!.enteredBy, reason: e.late!.reason,
        memo: e.memo, totalCents: entryTotalCents(e.lines),
        ...(e.late!.kind ? { kind: e.late!.kind } : {}),
        ...(e.late!.counterparty ? { counterparty: e.late!.counterparty } : {}),
        ...(e.late!.reversalOf ? { reversalOf: e.late!.reversalOf } : {}),
        ...(e.late!.reversedBy ? { reversedBy: e.late!.reversedBy } : {}),
        inPeriod, netIncomeEffectCents: ni, cashEffectCents: cash,
      };
    });

  const b = headlineFigures(before);
  const a = headlineFigures(after);
  return {
    since, count: late.length, entries: summaries, before: b, after: a, lines,
    headline: lateHeadline(summaries, lines, b, a, !!reported),
  };
}

/** "Recomputed net income differs from reported by $38.00: $19.00 from 1 late
 *  entry added Oct 9, $19.00 was there when the books were checked." */
function lateHeadline(entries: LateEntrySummary[], lines: LateLineEffect[], before: HeadlineFigures, after: HeadlineFigures, hasReported: boolean): string {
  const n = entries.length;
  const days = [...new Set(entries.map((e) => shortDay(e.enteredAt)))];
  const when = days.length === 1 ? `added ${days[0]}` : `added ${days[0]} to ${days[days.length - 1]}`;
  const what = `${n} late ${n === 1 ? "entry" : "entries"} ${when}`;
  const ni = lines.find((l) => l.statement === "incomeStatement" && l.key === "net_income");
  const cash = lines.find((l) => l.statement === "balanceSheet" && l.key === "asset.cash")
    ?? lines.find((l) => l.statement === "cashFlow" && l.key === "ending_cash");
  const pick = ni ?? cash ?? lines.find((l) => l.kind === "total") ?? lines[0];
  if (!pick) return `${what}. They cancel out: no figure moved.`;
  const name = pick === ni ? "net income" : pick === cash ? "ending cash" : pick.label.toLowerCase();
  if (hasReported && pick.varianceCents !== null && pick.otherCents !== null) {
    const v = Math.abs(pick.varianceCents);
    const o = Math.abs(pick.otherCents);
    if (v === 0) return `Recomputed ${name} now matches reported: ${what} closed a ${usd(o)} difference.`;
    if (o === 0) return `Recomputed ${name} differs from reported by ${usd(v)}: ${what}.`;
    if (v < o) return `Recomputed ${name} differs from reported by ${usd(v)}, down from ${usd(o)} before ${what}.`;
    return `Recomputed ${name} differs from reported by ${usd(v)}: ${usd(Math.abs(pick.lateEntryCents))} from ${what}, ${usd(o)} was there when the books were checked.`;
  }
  const from = pick === ni ? before.netIncomeCents : pick === cash ? before.endingCashCents : pick.recomputedCents - pick.lateEntryCents;
  const to = pick === ni ? after.netIncomeCents : pick === cash ? after.endingCashCents : pick.recomputedCents;
  return `${what} moved ${name} from ${usd(from)} to ${usd(to)}.`;
}

/** Everything the report needs, from one call. */
export function buildStatements(args: {
  period: Period;
  accounts: readonly LedgerAccount[];
  opening: OpeningBalances | null;
  entries: readonly LedgerEntry[];
  bank: readonly BankStatementBalance[];
  reported: ReportedStatements | null;
}) {
  const { period, accounts, opening, entries, bank, reported } = args;
  const recomputed = recomputeStatements(period, accounts, opening, entries);
  const v = reported ? variances(reported, recomputed) : null;
  const checks = runChecks({ period, accounts, opening, entries, bank, reported, statements: recomputed, variances: v });
  const lateEntries = lateEntryImpact({ period, accounts, opening, entries, reported, recomputed });
  if (lateEntries) {
    checks.push({
      code: "late_entries",
      // A late entry and its reversal cancel out: shown, nothing to review.
      status: lateEntries.lines.length ? "warn" : "pass",
      message: lateEntries.headline,
      amountCents: lateEntries.after.netIncomeCents - lateEntries.before.netIncomeCents,
      detail: { count: lateEntries.count, before: lateEntries.before, after: lateEntries.after },
    });
  }
  return { recomputed, variances: v, checks, lateEntries };
}

