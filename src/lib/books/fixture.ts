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
import { bankReconciliation, journalTotals } from "@convex/lib/statements";
import { entryTotalCents, parsePeriod } from "@convex/lib/ledgerMath";
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

export function buildFixture(): FixtureData {
  const period = parsePeriod(FIXTURE_PERIOD);
  const plan = parseBooksWorkbook(booksFixtureGrid(), { period: FIXTURE_PERIOD });
  const recon = reconcilePlan(plan, [BANK]);
  const engineEntries = planToLedgerEntries(plan);
  const engineAccounts = chartToLedgerAccounts(plan.chart);

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

  const opening = recon.opening
    ? { asOf: recon.opening.asOf, source: "implied_from_reported_close", note: null as string | null }
    : null;
  const statements: StatementsPayload = {
    period: { key: period.key, start: period.start, end: period.end },
    entityName: plan.entityName,
    opening: opening ? { ...opening, source: opening.source } : null,
    reported: {
      ...plan.reported,
      importBatchId: plan.importBatchId,
      importedAt: period.start,
    },
    recomputed: recon.recomputed,
    variances: recon.variances,
    checks: recon.checks,
    journalTotals: journalTotals(engineEntries, period.start, period.end),
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
