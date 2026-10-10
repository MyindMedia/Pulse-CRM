import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

/* The Books report's data contract. Every shape here is what the Phase A
   ledger API returns; the UI never builds money figures of its own. */

export type StatementsPayload = FunctionReturnType<typeof api.ledger.statements>;
/** A chart account. `_id` is a string here so fixture and live rows share one type. */
export type AccountRow = Omit<FunctionReturnType<typeof api.ledger.accounts>[number], "_id"> & { _id: string };
export type BankRow = FunctionReturnType<typeof api.ledger.bankReconciliation>["rows"][number];
export type PeriodRow = FunctionReturnType<typeof api.ledger.periods>[number];
export type Check = StatementsPayload["checks"][number];
export type Variance = NonNullable<StatementsPayload["variances"]>["balanceSheet"][number];
/** What late entries changed since the workbook was imported (null when none). */
export type LateImpact = NonNullable<StatementsPayload["lateEntries"]>;
export type LateSummary = LateImpact["entries"][number];
export type LateLine = LateImpact["lines"][number];

/** One journal entry as ledger.journal returns it (the fields the report reads). */
export type JournalEntryRow = {
  _id: string;
  entryDate: number;
  memo: string;
  paymentType?: { kind: string; raw?: string; card?: string };
  receiptStatus: "yes" | "no" | "pending";
  status: "posted" | "draft" | "void";
  totalCents: number;
  lines: { accountId: string; debitCents: number; creditCents: number; memo?: string }[];
  /* Late entries (openspec late-entries): added to a month after it was
     reported, or the reversing entry that cancels one. */
  lateEntry?: boolean;
  enteredAt?: number;
  enteredBy?: string;
  reason?: string;
  counterparty?: string;
  reversalOf?: string;
  reversedBy?: string;
};

export type StatementKind = "balanceSheet" | "incomeStatement" | "cashFlow";
