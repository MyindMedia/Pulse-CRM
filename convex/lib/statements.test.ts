import { describe, it, expect } from "vitest";
import {
  type LedgerAccount,
  type LedgerEntry,
  assertBalancedLines,
  entryContentHash,
  formatCents,
  parsePeriod,
  toCents,
  trialBalance,
} from "./ledgerMath";
import { balanceSheet, buildStatements, cashFlow, impliedOpeningBalances, incomeStatement } from "./statements";
import {
  chartToLedgerAccounts,
  DEFAULT_STUDIO_CHART,
  evaluateFormula,
  normalizePaymentType,
  parseBooksWorkbook,
  reconcilePlan,
} from "./booksImport";
import { booksFixtureGrid } from "../ledgerBooks.fixture";

const JULY = parsePeriod("2026-07");
const day = (d: number) => Date.UTC(2026, 6, d);
const BANK = {
  accountLabel: "Checking A",
  periodStart: JULY.start,
  periodEnd: JULY.end,
  beginningCents: 168_750,
  endingCents: 161_129,
  depositsCents: 244_500,
  withdrawalsCents: 250_521,
  feesCents: 1_600,
};

describe("ledger math", () => {
  it("turns spreadsheet floats into exact cents", () => {
    expect(toCents(2413.7999999999997)).toBe(241_380);
    expect(toCents(-76.21000000000001)).toBe(-7_621);
    expect(toCents("1,611.29")).toBe(161_129);
    expect(formatCents(-70_621)).toBe("-706.21");
    expect(formatCents(2_350_953)).toBe("23,509.53");
  });

  it("parses a month into a half-open UTC range", () => {
    expect(JULY).toEqual({ key: "2026-07", start: Date.UTC(2026, 6, 1), end: Date.UTC(2026, 7, 1) });
    expect(() => parsePeriod("2026-13")).toThrow();
    expect(() => parsePeriod("July")).toThrow();
  });

  it("enforces one balanced-entry rule", () => {
    const ok = [{ accountId: "a", debitCents: 100, creditCents: 0 }, { accountId: "b", debitCents: 0, creditCents: 100 }];
    expect(assertBalancedLines(ok)).toBe(100);
    expect(() => assertBalancedLines([ok[0]])).toThrow(/two lines/);
    expect(() => assertBalancedLines([ok[0], { ...ok[1], creditCents: 99 }])).toThrow(/must equal/);
    expect(() => assertBalancedLines([{ ...ok[0], debitCents: 10.5 }, ok[1]])).toThrow(/whole cents/);
    expect(() => assertBalancedLines([{ ...ok[0], creditCents: 100 }, ok[1]])).toThrow(/both/);
    expect(() => assertBalancedLines([{ ...ok[0], debitCents: -100 }, { ...ok[1], creditCents: -100 }])).toThrow(/negative/);
    expect(() => assertBalancedLines([{ ...ok[0], debitCents: 0 }, { ...ok[1], creditCents: 0 }])).toThrow(/no amount/);
  });

  it("hashes entry content stably and separates identical twins", () => {
    const e = { entryDate: day(1), memo: "Rent ", lines: [{ accountKey: "rent", debitCents: 1, creditCents: 0 }, { accountKey: "bank_cash", debitCents: 0, creditCents: 1 }] };
    expect(entryContentHash(e)).toBe(entryContentHash({ ...e, memo: "rent" }));
    expect(entryContentHash(e)).not.toBe(entryContentHash({ ...e, occurrence: 1 }));
    expect(entryContentHash(e)).not.toBe(entryContentHash({ ...e, entryDate: day(2) }));
  });

  it("reads payment type variants into one kind and keeps the raw text", () => {
    expect(normalizePaymentType("CashApp/Cash")).toMatchObject({ kind: "cashapp_or_cash", canonical: "CashApp / Cash" });
    expect(normalizePaymentType("Credit Card – [Card E]")).toMatchObject({ kind: "credit_card", card: "Card E", canonical: "Credit Card - [Card E]" });
    expect(normalizePaymentType("Processor A")).toMatchObject({ kind: "other", raw: "Processor A" });
  });
});

describe("statements engine (small ledger)", () => {
  const accounts: LedgerAccount[] = chartToLedgerAccounts(DEFAULT_STUDIO_CHART);
  const E = (id: string, d: number, lines: [string, number, number][], extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
    id, entryDate: day(d), memo: id, status: "posted", receiptStatus: "yes",
    lines: lines.map(([accountId, debitCents, creditCents]) => ({ accountId, debitCents, creditCents })),
    ...extra,
  });
  const entries: LedgerEntry[] = [
    E("sale", 2, [["bank_cash", 10_000, 0], ["revenue_recording", 0, 10_000]]),
    E("rent", 3, [["rent", 6_000, 0], ["bank_cash", 0, 6_000]]),
    E("card", 4, [["software", 1_000, 0], ["credit_card_payable", 0, 1_000]]),
    E("owner", 5, [["bank_cash", 5_000, 0], ["owner_equity_capital", 0, 5_000]]),
    E("draft", 6, [["rent", 999, 0], ["bank_cash", 0, 999]], { status: "draft" }),
    E("void", 6, [["rent", 777, 0], ["bank_cash", 0, 777]], { status: "void" }),
    E("dit", 7, [["deposits_in_transit", 2_000, 0], ["revenue_podcast", 0, 2_000]], { receiptStatus: "no" }),
  ];
  const opening = { asOf: JULY.start, lines: [{ accountId: "bank_cash", cents: 1_000 }, { accountId: "retained_earnings", cents: 1_000 }] };

  it("ignores drafts and voids and groups by statement line", () => {
    const is = incomeStatement(accounts, entries, JULY.start, JULY.end);
    expect(is.totalRevenueCents).toBe(12_000);
    expect(is.totalExpensesCents).toBe(7_000);
    expect(is.netIncomeCents).toBe(5_000);
    expect(is.expenses.find((l) => l.key === "expense.rent")?.cents).toBe(6_000);
  });

  it("balances A = L + E from account balances, with retained earnings derived", () => {
    const bs = balanceSheet(accounts, opening, entries, JULY.start, JULY.end);
    expect(bs.totalAssetsCents).toBe(1_000 + 10_000 - 6_000 + 5_000 + 2_000);
    expect(bs.totalLiabilitiesCents).toBe(1_000);
    expect(bs.retainedEarnings).toEqual({ openingCents: 1_000, priorUnclosedIncomeCents: 0, currentPeriodNetIncomeCents: 5_000, totalCents: 6_000 });
    expect(bs.balanced).toBe(true);
    expect(bs.differenceCents).toBe(0);
  });

  it("does not hide an unbalanced opening: the check fails instead of plugging", () => {
    const bad = { asOf: JULY.start, lines: [{ accountId: "bank_cash", cents: 1_000 }] };
    const bs = balanceSheet(accounts, bad, entries, JULY.start, JULY.end);
    expect(bs.balanced).toBe(false);
    expect(bs.differenceCents).toBe(1_000);
    const { checks } = buildStatements({ period: JULY, accounts, opening: bad, entries, bank: [], reported: null });
    expect(checks.find((c) => c.code === "opening_balanced")?.status).toBe("fail");
    expect(checks.find((c) => c.code === "balance_sheet_balances")?.status).toBe("fail");
  });

  it("classifies direct cash flow by counter-account and ties to the cash change", () => {
    const cf = cashFlow(accounts, opening, entries, JULY.start, JULY.end);
    expect(cf.operating.map((l) => [l.key, l.cents])).toEqual([["operating.customer_receipts", 10_000], ["operating.rent", -6_000]]);
    expect(cf.financing.map((l) => [l.key, l.cents])).toEqual([["financing.owner_contributions", 5_000]]);
    expect(cf.beginningCashCents).toBe(1_000);
    expect(cf.endingCashCents).toBe(10_000);
    expect(cf.netChangeCents).toBe(cf.ledgerCashChangeCents);
  });

  it("flags missing receipts, uncleared clearing accounts, duplicates and out-of-period entries", () => {
    const dupes = [...entries, E("sale", 2, [["bank_cash", 10_000, 0], ["revenue_recording", 0, 10_000]]), E("aug", 40, [["rent", 1, 0], ["bank_cash", 0, 1]], { bookPeriod: "2026-07" })];
    const { checks } = buildStatements({ period: JULY, accounts, opening, entries: dupes, bank: [], reported: null });
    const status = Object.fromEntries(checks.map((c) => [c.code, c.status]));
    expect(status).toMatchObject({
      balanced_entries: "pass",
      receipts_missing: "warn",
      clearing_not_cleared: "warn",
      duplicate_entries: "warn",
      entries_outside_period: "warn",
      cash_vs_bank: "warn",
    });
  });

  it("produces a trial balance whose debits equal credits", () => {
    const tb = trialBalance(accounts, opening, entries, JULY.end);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
  });
});

describe("July books (anonymized fixture)", () => {
  const plan = parseBooksWorkbook(booksFixtureGrid(), { period: "2026-07" });
  const recon = reconcilePlan(plan, [BANK]);
  const is = recon.recomputed.incomeStatement;
  const bs = recon.recomputed.balanceSheet;
  const cf = recon.recomputed.cashFlow;
  const line = (ls: { key: string; cents: number }[], key: string) => ls.find((l) => l.key === key)?.cents;

  it("reads 96 lines into 48 balanced entries totalling 5,880.80", () => {
    expect(plan.stats).toEqual({ lines: 96, entries: 48, totalDebitCents: 588_080, totalCreditCents: 588_080 });
    expect(plan.entries.every((e) => e.lines.length === 2)).toBe(true);
    expect(new Set(plan.entries.map((e) => e.contentHash)).size).toBe(48);
  });

  it("recomputes revenue 1,305.00 and expenses 2,432.80 (software 72.99, not 53.99)", () => {
    expect(is.totalRevenueCents).toBe(130_500);
    expect(line(is.revenue, "revenue.recording_session")).toBe(117_500);
    expect(line(is.revenue, "revenue.podcast_studio")).toBe(8_000);
    expect(line(is.revenue, "revenue.other_audio_services")).toBe(5_000);
    expect(is.totalExpensesCents).toBe(243_280);
    expect(line(is.expenses, "expense.software_subscriptions")).toBe(7_299);
    expect(line(is.expenses, "expense.rent")).toBe(150_000);
    expect(line(is.expenses, "expense.credit_card_interest_fees")).toBe(44_544);
    expect(line(is.expenses, "expense.advertising_promotion")).toBe(17_316);
    expect(line(is.expenses, "expense.insurance")).toBe(9_236);
    expect(line(is.expenses, "expense.internet")).toBe(7_500);
    expect(line(is.expenses, "expense.merchant_processing")).toBe(5_785);
    expect(line(is.expenses, "expense.bank_service_charges")).toBe(1_600);
    expect(is.netIncomeCents).toBe(-112_780);
  });

  it("treats the 50.00 accounts payable debit as a liability payment, not an expense", () => {
    const ap = recon.entries.find((e) => e.lines.some((l) => l.accountId === "accounts_payable"))!;
    expect(ap.lines.find((l) => l.accountId === "accounts_payable")?.debitCents).toBe(5_000);
    expect(is.expenses.some((l) => l.accountIds?.includes("accounts_payable"))).toBe(false);
    expect(line(cf.operating, "operating.professional_services")).toBe(-5_000);
  });

  it("moves Bank / Cash by -706.21 while the bank moved -76.21", () => {
    expect(cf.ledgerCashChangeCents).toBe(-70_621);
    expect(cf.netChangeCents).toBe(-70_621);
    expect(cf.beginningCashCents).toBe(168_750);
    expect(cf.endingCashCents).toBe(98_129);
    const bank = recon.checks.find((c) => c.code === "cash_vs_bank")!;
    expect(bank.status).toBe("fail");
    expect(bank.amountCents).toBe(-63_000);
  });

  it("balances without a plug and derives retained earnings", () => {
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssetsCents).toBe(2_918_356);
    expect(bs.totalLiabilitiesCents).toBe(3_669_360);
    expect(bs.retainedEarnings.currentPeriodNetIncomeCents).toBe(-112_780);
    expect(bs.retainedEarnings.totalCents).toBe(-3_568_759);
  });

  it("shows the reported statements' variances exactly", () => {
    const v = recon.variances!;
    expect(v.incomeStatement.map((x) => [x.key, x.varianceCents])).toEqual([
      ["expense.software_subscriptions", 1_900],
      ["total_expenses", 1_900],
      ["net_income", -1_900],
    ]);
    expect(Object.fromEntries(v.balanceSheet.map((x) => [x.key, x.varianceCents]))).toEqual({
      "asset.cash": -63_000,
      "asset.deposits_in_transit": 45_500,
      "asset.business_funds_held_by_owner": 25_000,
      total_assets: 7_500,
      "equity.retained_earnings": 7_500,
      total_equity: 7_500,
      total_liabilities_and_equity: 7_500,
    });
    expect(Object.fromEntries(v.cashFlow.map((x) => [x.key, x.varianceCents]))).toEqual({
      "operating.customer_receipts": -33_600,
      "operating.processing_fees": -300,
      net_operating: -33_900,
      "financing.owner_draws": -4_100,
      net_financing: -29_100,
      net_change: -63_000,
      ending_cash: -63_000,
      "financing.partner_deposits": -25_000,
    });
  });

  it("keeps the reported numbers exactly as the workbook had them", () => {
    const r = plan.reported;
    const get = (ls: { key: string; cents: number }[], k: string) => ls.find((l) => l.key === k)?.cents;
    expect(get(r.incomeStatement, "total_revenue")).toBe(130_500);
    expect(get(r.incomeStatement, "expense.software_subscriptions")).toBe(5_399);
    expect(get(r.incomeStatement, "total_expenses")).toBe(241_380);
    expect(get(r.incomeStatement, "net_income")).toBe(-110_880);
    expect(get(r.balanceSheet, "total_assets")).toBe(2_910_856);
    expect(get(r.balanceSheet, "total_liabilities")).toBe(3_669_360);
    expect(get(r.balanceSheet, "equity.retained_earnings")).toBe(-3_576_259);
    expect(get(r.balanceSheet, "total_equity")).toBe(-758_504);
    expect(get(r.cashFlow, "net_operating")).toBe(-22_721);
    expect(get(r.cashFlow, "net_financing")).toBe(15_100);
    expect(get(r.cashFlow, "beginning_cash")).toBe(168_750);
    expect(get(r.cashFlow, "ending_cash")).toBe(161_129);
  });

  it("reports every normalization and anomaly with its row", () => {
    const codes = (code: string) => plan.warnings.filter((w) => w.code === code);
    expect(codes("receipt_no").map((w) => w.row)).toEqual([3, 67]);
    expect(codes("text_date_normalized")).toEqual([expect.objectContaining({ row: 77, raw: "7//27/26", normalized: "2026-07-27" })]);
    expect(codes("payment_type_mismatch").map((w) => w.row)).toEqual([65]);
    expect(codes("payment_type_variant").map((w) => w.row)).toEqual([45, 46, 69, 70]);
    expect(codes("account_name_variant").map((w) => w.row)).toContain(4);
    expect(codes("account_name_variant").find((w) => w.row === 59)).toMatchObject({ raw: "Credit card Interest & Fees Expense", normalized: "Credit Card Interest & Fees Expense" });
    expect(codes("category_variant").map((w) => w.row)).toEqual([15, 56, 70, 74, 80, 86, 97]);
    expect(codes("category_missing").map((w) => w.row)).toEqual([96]);
    expect(codes("beginning_cash_label_date")).toHaveLength(1);
    expect(codes("retained_earnings_plug")[0]).toMatchObject({ cell: "B29", raw: "=B16-B25-B28" });
    expect(plan.warnings.filter((w) => w.severity === "error")).toEqual([]);
  });

  it("implies opening balances without hiding the cash gap", () => {
    const codes = recon.openingWarnings.map((w) => w.code);
    expect(codes).toContain("opening_cash_anchored_to_bank");
    expect(codes.filter((c) => c === "opening_clearing_not_negative")).toHaveLength(2);
    const opening = new Map(recon.opening.lines.map((l) => [l.accountId, l.cents]));
    expect(opening.get("bank_cash")).toBe(168_750);
    expect(opening.get("retained_earnings")).toBe(-3_455_979);
    expect(opening.get("deposits_in_transit")).toBeUndefined();
    const again = impliedOpeningBalances({
      accounts: recon.accounts, entries: recon.entries, periodStart: JULY.start, periodEnd: JULY.end,
      reportedBalanceSheet: plan.reported.balanceSheet,
    });
    expect(new Map(again.opening.lines.map((l) => [l.accountId, l.cents])).get("bank_cash")).toBe(231_750);
  });

  it("evaluates the statement tab's own formulas", () => {
    const sheet = booksFixtureGrid().sheets[1];
    expect(toCents(evaluateFormula(sheet, "=SUM(E14:E25)")!)).toBe(241_380);
    expect(toCents(evaluateFormula(sheet, "=B16-B25-B28")!)).toBe(-3_576_259);
    expect(evaluateFormula(sheet, "=VLOOKUP(A1,B2,3)")).toBeNull();
  });
});
