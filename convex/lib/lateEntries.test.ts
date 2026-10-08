import { describe, expect, it } from "vitest";
import { booksFixtureGrid } from "../ledgerBooks.fixture";
import { parseBooksWorkbook, reconcilePlan } from "./booksImport";
import { type LedgerEntry, DAY_MS, parsePeriod } from "./ledgerMath";
import { buildStatements, lateEntryImpact, recomputeStatements, type ReportedStatements } from "./statements";
import {
  DEFAULT_LATE_REASON,
  checkLateDate,
  isPastPeriod,
  lateLedgerEntry,
  moneyDirection,
  planLateEntry,
  possibleDuplicates,
  previewWithEntry,
  reversalLines,
  type LateEntryInput,
} from "./lateEntries";

/* Late entries: the math, on the anonymized July books (openspec late-entries).
   Every figure is integer cents. The July fixture's own numbers:
   reported total expenses 2,413.80, recomputed 2,432.80 (software 72.99 in
   the journal against 53.99 on the statement: the 19.00 Vendor S4 podcast
   distribution charge on Jul 24 is IN the journal and missing from the
   reported statement). */

const JULY = parsePeriod("2026-07");
const AUG = parsePeriod("2026-08");
const NOW = Date.UTC(2026, 9, 9, 17, 30); // Oct 9, 2026
const BANK = {
  accountLabel: "Checking A", periodStart: JULY.start, periodEnd: JULY.end,
  beginningCents: 168_750, endingCents: 161_129, depositsCents: 244_500, withdrawalsCents: 250_521, feesCents: 1_600,
};
const plan = parseBooksWorkbook(booksFixtureGrid(), { period: "2026-07" });
const base = reconcilePlan(plan, [BANK]);
const accounts = base.accounts;
const opening = base.opening;
const IMPORTED_AT = Date.UTC(2026, 7, 5); // the workbook was imported Aug 5
const reported: ReportedStatements = { ...plan.reported, importedAt: IMPORTED_AT };
const acct = (key: string) => accounts.find((a) => a.key === key)!;

function late(input: Partial<LateEntryInput> & Pick<LateEntryInput, "accountId" | "amountCents">, id: string, enteredAt = NOW): LedgerEntry {
  const full: LateEntryInput = { kind: "expense", entryDate: Date.UTC(2026, 6, 24), counterparty: "Vendor T", paidFrom: "bank", ...input };
  const p = planLateEntry(full, accounts);
  return lateLedgerEntry(p, full.entryDate, { enteredAt, enteredBy: "Owner", kind: full.kind, counterparty: full.counterparty }, id);
}

const july = (entries: readonly LedgerEntry[]) =>
  buildStatements({ period: JULY, accounts, opening, entries, bank: [BANK], reported });

describe("planLateEntry: balanced lines for every kind and paid-from", () => {
  const amount = 1_900;
  const lines = (input: Partial<LateEntryInput>) =>
    planLateEntry({ kind: "expense", entryDate: JULY.start, counterparty: "Vendor T", amountCents: amount, accountId: "software", paidFrom: "bank", ...input }, accounts).lines;

  it("expense from the bank debits the category and credits Bank / Cash", () => {
    expect(lines({})).toEqual([
      { accountId: "software", debitCents: 1_900, creditCents: 0 },
      { accountId: "bank_cash", debitCents: 0, creditCents: 1_900 },
    ]);
  });

  it("follows the workbook: card is a payable, owner money a contribution, unpaid a payable", () => {
    expect(lines({ paidFrom: "card" })[1].accountId).toBe("credit_card_payable");
    expect(lines({ paidFrom: "owner" })[1].accountId).toBe("owner_equity_capital");
    expect(lines({ paidFrom: "unpaid" })[1].accountId).toBe("accounts_payable");
    expect(lines({ paidFrom: "cash" })[1].accountId).toBe("bank_cash");
  });

  it("income debits where the money landed and credits revenue", () => {
    expect(lines({ kind: "income", accountId: "revenue_recording", paidFrom: "cash" })).toEqual([
      { accountId: "bank_cash", debitCents: 1_900, creditCents: 0 },
      { accountId: "revenue_recording", debitCents: 0, creditCents: 1_900 },
    ]);
    expect(lines({ kind: "income", accountId: "revenue_recording", paidFrom: "unpaid" })[0].accountId).toBe("accounts_receivable");
    expect(lines({ kind: "income", accountId: "revenue_recording", paidFrom: "owner" })[0].accountId).toBe("business_funds_held_by_owner");
  });

  it("a refund follows its category: to a customer is money out, from a vendor is money in", () => {
    expect(moneyDirection("refund", acct("revenue_recording"))).toBe("out");
    expect(lines({ kind: "refund", accountId: "revenue_recording" })).toEqual([
      { accountId: "revenue_recording", debitCents: 1_900, creditCents: 0 },
      { accountId: "bank_cash", debitCents: 0, creditCents: 1_900 },
    ]);
    expect(moneyDirection("refund", acct("software"))).toBe("in");
    expect(lines({ kind: "refund", accountId: "software", paidFrom: "card" })).toEqual([
      { accountId: "credit_card_payable", debitCents: 1_900, creditCents: 0 },
      { accountId: "software", debitCents: 0, creditCents: 1_900 },
    ]);
  });

  it("refuses what would misstate the books, in plain words", () => {
    const bad = (input: Partial<LateEntryInput>) => () => lines(input);
    expect(bad({ amountCents: 0 })).toThrow(/greater than zero/);
    expect(bad({ amountCents: -100 })).toThrow(/greater than zero/);
    expect(bad({ amountCents: 19.5 })).toThrow(/greater than zero/);
    expect(bad({ accountId: "nope" })).toThrow(/isn't in this studio's chart/);
    expect(bad({ accountId: "revenue_recording" })).toThrow(/not an expense account/);
    expect(bad({ kind: "income", accountId: "software" })).toThrow(/not an income account/);
    expect(bad({ kind: "refund", accountId: "bank_cash" })).toThrow(/cannot be refunded/);
    expect(bad({ kind: "income", accountId: "revenue_recording", paidFrom: "card" })).toThrow(/credit card/);
    expect(bad({ counterparty: "  " })).toThrow(/vendor or customer/);
    const noCard = accounts.filter((a) => a.key !== "credit_card_payable");
    expect(() => planLateEntry({ kind: "expense", entryDate: JULY.start, counterparty: "V", amountCents: 100, accountId: "software", paidFrom: "card" }, noCard)).toThrow(/no active credit card payable/);
  });

  it("defaults the reason and builds the memo from the vendor and memo", () => {
    const p = planLateEntry({ kind: "expense", entryDate: JULY.start, counterparty: " Vendor T ", amountCents: 100, accountId: "software", paidFrom: "bank", memo: "hosting" }, accounts);
    expect(p.reason).toBe(DEFAULT_LATE_REASON);
    expect(p.memo).toBe("Vendor T - hosting");
    expect(p.paymentType).toEqual({ kind: "bank_transfer", raw: "Bank Transfer" });
  });
});

describe("checkLateDate", () => {
  const ok = (entryDate: number, periodKey = "2026-07", openingDates = [JULY.start], now = NOW) =>
    checkLateDate({ periodKey, entryDate, now, openingDates });

  it("accepts any day inside an ended month, snapped to UTC midnight", () => {
    expect(ok(Date.UTC(2026, 6, 24, 15, 30)).day).toBe(Date.UTC(2026, 6, 24));
    expect(ok(JULY.start).day).toBe(JULY.start);
    expect(ok(JULY.end - 1).day).toBe(JULY.end - DAY_MS);
  });

  it("refuses a date outside the stated month, in the future, or in a month that has not ended", () => {
    expect(() => ok(AUG.start)).toThrow(/between Jul 1, 2026 and Jul 31, 2026/);
    expect(() => ok(JULY.start - 1)).toThrow(/between/);
    expect(() => ok(Date.UTC(2026, 9, 2), "2026-10")).toThrow(/months that have ended/);
    expect(() => ok(Date.UTC(2026, 8, 20), "2026-09", [JULY.start], Date.UTC(2026, 8, 10))).toThrow(/months that have ended/);
    expect(isPastPeriod("2026-09", NOW)).toBe(true);
    expect(isPastPeriod("2026-10", NOW)).toBe(false);
  });

  it("refuses a day before the books start, and before a later opening snapshot", () => {
    expect(() => ok(Date.UTC(2026, 5, 30), "2026-06")).toThrow(/books start on Jul 1, 2026/);
    expect(() => ok(Date.UTC(2026, 6, 24), "2026-07", [JULY.start, AUG.start])).toThrow(/Opening balances were set for Aug 1, 2026/);
    expect(() => ok("x" as unknown as number)).toThrow(/Choose a date/);
  });
});

describe("July: the missing 19.00 software charge, checked against the fixture", () => {
  const before = july(base.entries);

  it("starts where the fixture says: expenses 2,432.80 recomputed, 2,413.80 reported, software +19.00", () => {
    expect(before.recomputed.incomeStatement.totalExpensesCents).toBe(243_280);
    expect(reported.incomeStatement.find((l) => l.key === "total_expenses")!.cents).toBe(241_380);
    expect(before.variances!.incomeStatement.find((v) => v.key === "expense.software_subscriptions")!.varianceCents).toBe(1_900);
    expect(before.lateEntries).toBeNull();
  });

  it("finds the charge already in the journal: adding it again would be a duplicate", () => {
    const dupes = possibleDuplicates(base.entries, { entryDate: Date.UTC(2026, 6, 24), totalCents: 1_900, categoryAccountId: "software", counterparty: "Vendor S4" });
    expect(dupes).toHaveLength(1);
    expect(dupes[0].memo).toBe("Vendor S4 podcast distribution subscription");
    expect(dupes[0].why).toBe("same amount, same day, same category");
  });

  it("if added anyway, the variance to reported GROWS to 38.00 and the split is exact", () => {
    const entry = late({ accountId: "software", amountCents: 1_900, counterparty: "Vendor S4", paidFrom: "card" }, "late-1");
    const after = july([...base.entries, entry]);
    expect(after.recomputed.incomeStatement.totalExpensesCents).toBe(245_180);
    const sw = after.variances!.incomeStatement.find((v) => v.key === "expense.software_subscriptions")!;
    expect(sw.varianceCents).toBe(3_800);
    const impact = after.lateEntries!;
    const line = impact.lines.find((l) => l.key === "expense.software_subscriptions")!;
    expect(line).toMatchObject({ lateEntryCents: 1_900, otherCents: 1_900, varianceCents: 3_800, reportedCents: 5_399, recomputedCents: 9_199 });
    for (const l of impact.lines) {
      if (l.varianceCents !== null) expect(l.lateEntryCents + l.otherCents!).toBe(l.varianceCents);
    }
    expect(impact.headline).toBe("Recomputed net income differs from reported by $38.00: $19.00 from 1 late entry added Oct 9, $19.00 was there when the books were checked.");
    // The late-entry check carries the headline.
    expect(after.checks.find((c) => c.code === "late_entries")).toMatchObject({ status: "warn", amountCents: -1_900, message: impact.headline });
  });

  it("where the statement left a charge out, a late entry makes the variance shrink to zero", () => {
    // The real gap, reproduced: a statement that lists a charge the journal
    // lacks. Take the fixture's statement as if Vendor S4 had been reported
    // (software 72.99) while the journal never got the row.
    const s4 = base.entries.find((e) => e.memo === "Vendor S4 podcast distribution subscription")!;
    const journal = base.entries.filter((e) => e !== s4);
    const fixed: ReportedStatements = {
      ...reported,
      incomeStatement: reported.incomeStatement.map((l) =>
        l.key === "expense.software_subscriptions" ? { ...l, cents: 7_299 }
          : l.key === "total_expenses" ? { ...l, cents: 243_280 }
            : l.key === "net_income" ? { ...l, cents: -112_780 } : l),
    };
    const run = (entries: readonly LedgerEntry[]) => buildStatements({ period: JULY, accounts, opening, entries, bank: [BANK], reported: fixed });
    const was = run(journal);
    expect(was.variances!.incomeStatement.find((v) => v.key === "expense.software_subscriptions")!.varianceCents).toBe(-1_900);
    const now = run([...journal, late({ accountId: "software", amountCents: 1_900, counterparty: "Vendor S4", paidFrom: "card" }, "late-s4")]);
    expect(now.recomputed.incomeStatement.totalExpensesCents).toBe(243_280);
    expect(now.variances!.incomeStatement).toEqual([]);
    expect(now.lateEntries!.headline).toBe("Recomputed net income now matches reported: 1 late entry added Oct 9 closed a $19.00 difference.");
    expect(now.lateEntries!.lines.find((l) => l.key === "net_income")).toMatchObject({ lateEntryCents: -1_900, otherCents: 1_900, varianceCents: 0 });
  });

  it("never changes the reported statements", () => {
    const copy = JSON.parse(JSON.stringify(reported));
    july([...base.entries, late({ accountId: "software", amountCents: 1_900 }, "l")]);
    expect(reported).toEqual(copy);
  });
});

describe("late income, expense and refund move exactly their amount", () => {
  const cases: [string, Partial<LateEntryInput> & Pick<LateEntryInput, "accountId" | "amountCents">, { ni: number; cash: number }][] = [
    ["expense from bank", { accountId: "rent", amountCents: 12_345 }, { ni: -12_345, cash: -12_345 }],
    ["expense on a card (accrual: no cash yet)", { accountId: "rent", amountCents: 12_345, paidFrom: "card" }, { ni: -12_345, cash: 0 }],
    ["expense not paid yet", { accountId: "internet", amountCents: 7_500, paidFrom: "unpaid" }, { ni: -7_500, cash: 0 }],
    ["income into the bank", { kind: "income", accountId: "revenue_recording", amountCents: 20_000 }, { ni: 20_000, cash: 20_000 }],
    ["income invoiced, not received", { kind: "income", accountId: "revenue_consultation", amountCents: 5_000, paidFrom: "unpaid" }, { ni: 5_000, cash: 0 }],
    ["refund to a customer", { kind: "refund", accountId: "revenue_recording", amountCents: 2_500 }, { ni: -2_500, cash: -2_500 }],
    ["refund from a vendor", { kind: "refund", accountId: "software", amountCents: 1_200 }, { ni: 1_200, cash: 1_200 }],
  ];
  for (const [name, input, want] of cases) {
    it(name, () => {
      const b = july(base.entries).recomputed;
      const a = july([...base.entries, late(input, `l-${name}`)]);
      expect(a.recomputed.incomeStatement.netIncomeCents - b.incomeStatement.netIncomeCents).toBe(want.ni);
      expect(a.recomputed.cashFlow.endingCashCents - b.cashFlow.endingCashCents).toBe(want.cash);
      expect(a.recomputed.balanceSheet.balanced).toBe(true);
      expect(a.checks.find((c) => c.code === "cash_flow_ties")!.status).toBe("pass");
      expect(a.lateEntries!.after.netIncomeCents - a.lateEntries!.before.netIncomeCents).toBe(want.ni);
      expect(a.lateEntries!.entries[0]).toMatchObject({ netIncomeEffectCents: want.ni, cashEffectCents: want.cash, inPeriod: true });
    });
  }
});

describe("roll-forward: a late July entry moves August's opening by exactly its amount", () => {
  // August books: rent paid from the bank, a session paid in cash.
  const aug: LedgerEntry[] = [
    { id: "aug-rent", entryDate: Date.UTC(2026, 7, 2), memo: "August rent", status: "posted", receiptStatus: "yes", lines: [{ accountId: "rent", debitCents: 150_000, creditCents: 0 }, { accountId: "bank_cash", debitCents: 0, creditCents: 150_000 }] },
    { id: "aug-session", entryDate: Date.UTC(2026, 7, 9), memo: "Client A session", status: "posted", receiptStatus: "yes", lines: [{ accountId: "bank_cash", debitCents: 20_000, creditCents: 0 }, { accountId: "revenue_recording", debitCents: 0, creditCents: 20_000 }] },
  ];
  const august = (entries: readonly LedgerEntry[]) => recomputeStatements(AUG, accounts, opening, entries);
  const line = (r: ReturnType<typeof august>, key: string) => r.balanceSheet.lines.find((l) => l.key === key)?.cents ?? 0;
  const was = august([...base.entries, ...aug]);

  it("paid from the bank: August opening cash and retained earnings both drop by 19.00", () => {
    const now = august([...base.entries, ...aug, late({ accountId: "software", amountCents: 1_900 }, "l-bank")]);
    expect(now.cashFlow.beginningCashCents - was.cashFlow.beginningCashCents).toBe(-1_900);
    expect(now.cashFlow.endingCashCents - was.cashFlow.endingCashCents).toBe(-1_900);
    expect(now.balanceSheet.retainedEarnings.priorUnclosedIncomeCents - was.balanceSheet.retainedEarnings.priorUnclosedIncomeCents).toBe(-1_900);
    expect(now.balanceSheet.retainedEarnings.totalCents - was.balanceSheet.retainedEarnings.totalCents).toBe(-1_900);
    // August's own income statement does not move: the expense belongs to July.
    expect(now.incomeStatement.netIncomeCents).toBe(was.incomeStatement.netIncomeCents);
    expect(now.incomeStatement.netIncomeCents).toBe(20_000 - 150_000);
    expect(now.cashFlow.netChangeCents).toBe(was.cashFlow.netChangeCents);
    expect(now.balanceSheet.balanced).toBe(true);
  });

  it("on a card (accrual): cash does not move, the card payable rises and retained earnings drops", () => {
    const now = august([...base.entries, ...aug, late({ accountId: "software", amountCents: 1_900, paidFrom: "card" }, "l-card")]);
    expect(now.cashFlow.beginningCashCents).toBe(was.cashFlow.beginningCashCents);
    expect(line(now, "liability.credit_card_payable") - line(was, "liability.credit_card_payable")).toBe(1_900);
    expect(now.balanceSheet.retainedEarnings.totalCents - was.balanceSheet.retainedEarnings.totalCents).toBe(-1_900);
    expect(now.balanceSheet.balanced).toBe(true);
  });

  it("shows on August as a change since reported, through the opening", () => {
    const augReported: ReportedStatements = { ...reported, periodStart: AUG.start, periodEnd: AUG.end, importedAt: Date.UTC(2026, 8, 3) };
    const impact = lateEntryImpact({ period: AUG, accounts, opening, entries: [...base.entries, ...aug, late({ accountId: "software", amountCents: 1_900 }, "l-aug")], reported: augReported })!;
    expect(impact.entries[0]).toMatchObject({ inPeriod: false, netIncomeEffectCents: 0, cashEffectCents: -1_900 });
    expect(impact.lines.some((l) => l.statement === "incomeStatement")).toBe(false);
    expect(impact.lines.find((l) => l.key === "beginning_cash")!.lateEntryCents).toBe(-1_900);
    expect(impact.lines.find((l) => l.key === "equity.retained_earnings")!.lateEntryCents).toBe(-1_900);
  });

  it("a late entry entered before the workbook was imported is part of what was reported", () => {
    const early = late({ accountId: "software", amountCents: 1_900 }, "l-early", IMPORTED_AT - DAY_MS);
    expect(july([...base.entries, early]).lateEntries).toBeNull();
  });
});

describe("reversal: a mistaken late entry is cancelled, both stay visible", () => {
  it("returns the month to exactly the prior totals, line for line", () => {
    const entry = late({ accountId: "software", amountCents: 1_900 }, "late-x");
    const rev: LedgerEntry = {
      ...entry, id: "late-x-rev", memo: `Reversal of late entry: ${entry.memo}`,
      lines: reversalLines(entry.lines),
      late: { ...entry.late!, reason: "Entered twice", reversalOf: "late-x" },
    };
    const was = july(base.entries);
    const now = july([...base.entries, { ...entry, late: { ...entry.late!, reversedBy: "late-x-rev" } }, rev]);
    // Every line and total, to the cent. (Cash flow keeps a 0.00 software
    // line: cash did move out and back in that month.)
    const figures = (r: typeof was.recomputed) =>
      Object.fromEntries((["incomeStatement", "balanceSheet", "cashFlow"] as const).flatMap((k) =>
        r[k].lines.filter((l) => l.cents !== 0).map((l) => [`${k}.${l.key}`, l.cents])));
    expect(figures(now.recomputed)).toEqual(figures(was.recomputed));
    expect(Object.keys(figures(was.recomputed)).length).toBeGreaterThan(40);
    expect(now.recomputed.cashFlow.lines.find((l) => l.key === "operating.software")!.cents).toBe(0);
    expect(now.variances).toEqual(was.variances);
    expect(now.lateEntries!.count).toBe(2);
    expect(now.lateEntries!.lines).toEqual([]);
    expect(now.lateEntries!.headline).toBe("2 late entries added Oct 9. They cancel out: no figure moved.");
    expect(now.checks.find((c) => c.code === "late_entries")!.status).toBe("pass");
    // A reversed pair is not offered as a duplicate of a new item.
    expect(possibleDuplicates([entry, rev].map((e, i) => (i === 0 ? { ...e, late: { ...e.late!, reversedBy: "late-x-rev" } } : e)), { entryDate: entry.entryDate, totalCents: 1_900, categoryAccountId: "software", counterparty: "Vendor T" })).toEqual([]);
  });
});

describe("previewWithEntry", () => {
  it("gives the same before and after as the statements", () => {
    const entry = late({ accountId: "rent", amountCents: 5_000 }, "p");
    const p = previewWithEntry({ period: JULY, accounts, opening, entries: base.entries, add: entry });
    expect(p.before.netIncomeCents).toBe(-112_780);
    expect(p.after.netIncomeCents).toBe(-117_780);
    expect(p.before.endingCashCents).toBe(98_129);
    expect(p.after.endingCashCents).toBe(93_129);
    expect(p.after.retainedEarningsCents - p.before.retainedEarningsCents).toBe(-5_000);
  });
});
