/* The anonymized July fixture, run through the real engine (Phase A), in the
   exact shape the Convex queries return. Used by the preview route and the
   tests. Built from code, never from the owner's workbook. */

import { booksFixtureGrid } from "@convex/ledgerBooks.fixture";
import {
  chartToLedgerAccounts,
  parseBooksWorkbook,
  planToLedgerEntries,
  reconcilePlan,
} from "@convex/lib/booksImport";
import { bankReconciliation, buildStatements, journalTotals } from "@convex/lib/statements";
import { type LedgerEntry, entryTotalCents, parsePeriod } from "@convex/lib/ledgerMath";
import type { AccountRow, BankRow, JournalEntryRow, PeriodRow, StatementsPayload } from "./types";

export const FIXTURE_PERIOD = "2026-07";

/** Anonymized bank summary for the July checking account. */
const BANK = {
  accountLabel: "Checking A",
  periodStart: parsePeriod(FIXTURE_PERIOD).start,
  periodEnd: parsePeriod(FIXTURE_PERIOD).end,
  beginningCents: 168_750,
  endingCents: 161_129,
  depositsCents: 244_500,
  withdrawalsCents: 250_521,
  feesCents: 1_600,
};

/** When the anonymized workbook was imported and checked: Aug 5, 2026. Late
 *  entries count as changes after this moment. */
export const FIXTURE_IMPORTED_AT = Date.UTC(2026, 7, 5, 12);

export const FIXTURE_BRAND = {
  name: "Sample Studio",
  logoUrl: "/preview/books-sample-logo.svg",
  accentColor: "#fdb913",
};

export type FixtureData = {
  periods: PeriodRow[];
  statements: StatementsPayload;
  accounts: AccountRow[];
  entries: JournalEntryRow[];
  bank: BankRow[];
};

/** The engine's inputs for the fixture month, for the dev preview's late
 *  entry form (same accounts, opening and entries the report is built from). */
export function fixtureEngine() {
  const period = parsePeriod(FIXTURE_PERIOD);
  const plan = parseBooksWorkbook(booksFixtureGrid(), { period: FIXTURE_PERIOD });
  const base = reconcilePlan(plan, [BANK]);
  return { period, accounts: chartToLedgerAccounts(plan.chart), opening: base.opening, entries: planToLedgerEntries(plan) };
}

/** A late entry in the preview: the engine entry plus what the journal row
 *  shows (a receipt attached in the preview is marked, never uploaded). */
export type FixtureLateEntry = LedgerEntry & { receipt?: boolean };

/** The July fixture through the real engine. `late` adds late entries (and
 *  reversals) exactly as the ledger would hold them, for the dev preview. */
export function buildFixture(late: readonly FixtureLateEntry[] = []): FixtureData {
  const period = parsePeriod(FIXTURE_PERIOD);
  const plan = parseBooksWorkbook(booksFixtureGrid(), { period: FIXTURE_PERIOD });
  const base = reconcilePlan(plan, [BANK]);
  const engineAccounts = chartToLedgerAccounts(plan.chart);
  const lateEngine: LedgerEntry[] = late.map(({ receipt, ...e }) => ({ ...e, receiptStatus: receipt ? "yes" : e.receiptStatus }));
  const engineEntries = [...planToLedgerEntries(plan), ...lateEngine];
  const reported = { ...plan.reported, importedAt: FIXTURE_IMPORTED_AT };
  const recon = { ...buildStatements({ period, accounts: engineAccounts, opening: base.opening, entries: engineEntries, bank: [BANK], reported }), opening: base.opening };

  const accounts: AccountRow[] = plan.chart.map((a) => ({
    _id: a.key, key: a.key, name: a.name, type: a.type, subtype: a.subtype, statementLine: a.statementLine,
    sortOrder: a.sortOrder, normalBalance: a.normalBalance, isCash: a.isCash ?? false, isClearing: a.isClearing ?? false,
    cashFlowLine: a.cashFlowLine ?? null, cashFlowLineInflow: a.cashFlowLineInflow ?? null, active: true,
  })) as AccountRow[];

  const entries: JournalEntryRow[] = plan.entries.map((e, i) => ({
    _id: e.contentHash,
    entryDate: e.entryDate,
    memo: e.memo,
    paymentType: { kind: e.paymentType.kind, ...(e.paymentType.raw ? { raw: e.paymentType.raw } : {}) },
    receiptStatus: e.receiptStatus,
    status: "posted",
    totalCents: entryTotalCents(engineEntries[i].lines),
    lines: e.lines.map((l) => ({
      accountId: l.accountKey,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      ...(l.memo ? { memo: l.memo } : {}),
    })),
  }));
  for (const e of lateEngine) {
    entries.push({
      _id: e.id,
      entryDate: e.entryDate,
      memo: e.memo,
      ...(e.paymentKind ? { paymentType: { kind: e.paymentKind } } : {}),
      receiptStatus: e.receiptStatus,
      status: e.status,
      totalCents: entryTotalCents(e.lines),
      lines: e.lines.map((l) => ({ ...l })),
      lateEntry: true,
      enteredAt: e.late!.enteredAt,
      enteredBy: e.late!.enteredBy,
      reason: e.late!.reason,
      ...(e.late!.counterparty ? { counterparty: e.late!.counterparty } : {}),
      ...(e.late!.reversalOf ? { reversalOf: e.late!.reversalOf } : {}),
      ...(e.late!.reversedBy ? { reversedBy: e.late!.reversedBy } : {}),
    });
  }

  const opening = recon.opening
    ? { asOf: recon.opening.asOf, source: "implied_from_reported_close", note: null as string | null }
    : null;
  const statements: StatementsPayload = {
    period: { key: period.key, start: period.start, end: period.end },
    entityName: plan.entityName,
    opening: opening ? { ...opening, source: opening.source } : null,
    reported: {
      ...reported,
      importBatchId: plan.importBatchId,
      importedAt: FIXTURE_IMPORTED_AT,
    },
    recomputed: recon.recomputed,
    variances: recon.variances,
    checks: recon.checks,
    journalTotals: journalTotals(engineEntries, period.start, period.end),
    lateEntries: recon.lateEntries,
  } as StatementsPayload;

  const bank = bankReconciliation(engineAccounts, recon.opening, engineEntries, [BANK]) as BankRow[];

  return {
    periods: [{ period: FIXTURE_PERIOD, hasReported: true, hasBank: true, hasEntries: true }],
    statements,
    accounts,
    entries,
    bank,
  };
}
