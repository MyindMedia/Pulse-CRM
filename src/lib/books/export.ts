/* CSV builders for each tab. Amounts come from the ledger API as cents and are
   written as plain decimals; nothing is recomputed here. */

import { formatCsvAmount, isoDayLabel, toCsv } from "./money";
import { statementRows, type StatementRow } from "./view";
import type { AccountRow, Check, JournalEntryRow, StatementKind, StatementsPayload } from "./types";

/** The workbook's journal columns, in its order. */
export const JOURNAL_HEADER = [
  "Date",
  "Description / Purpose",
  "Account",
  "Expense Category",
  "Payment Type",
  "Debit (-)",
  "Credit (+)",
  "Receipt (Yes/No)",
  "Late",
] as const;

/** The workbook's category column follows the account's type. */
export function categoryOf(account: Pick<AccountRow, "type"> | undefined): string {
  switch (account?.type) {
    case "revenue":
      return "Revenue";
    case "expense":
      return "Operating Expenses";
    case "asset":
      return "Asset";
    case "liability":
      return "Liability";
    case "equity":
      return "Equity";
    default:
      return "";
  }
}

export function receiptWord(r: JournalEntryRow["receiptStatus"]): string {
  return r === "yes" ? "Yes" : r === "no" ? "No" : "Pending";
}

/** The Late column: blank for an ordinary entry. */
export function lateWord(e: JournalEntryRow): string {
  if (!e.lateEntry) return "";
  const when = e.enteredAt ? ` (entered ${isoDayLabel(e.enteredAt)})` : "";
  if (e.reversalOf) return `Late reversal${when}`;
  if (e.reversedBy) return `Late, reversed${when}`;
  return `Late${when}`;
}

/** One row per entry line, first line carrying the date and description the
 *  way the workbook does. */
export function journalCsv(entries: readonly JournalEntryRow[], accounts: readonly AccountRow[]): string {
  const byId = new Map(accounts.map((a) => [a._id, a]));
  const rows: (string | number)[][] = [[...JOURNAL_HEADER]];
  for (const e of entries) {
    e.lines.forEach((l, i) => {
      const acc = byId.get(l.accountId);
      const first = i === 0;
      rows.push([
        first ? isoDayLabel(e.entryDate) : "",
        first ? e.memo : "",
        acc?.name ?? l.accountId,
        categoryOf(acc),
        first ? (e.paymentType?.raw ?? e.paymentType?.kind ?? "") : "",
        l.debitCents ? formatCsvAmount(l.debitCents) : "",
        l.creditCents ? formatCsvAmount(l.creditCents) : "",
        first ? receiptWord(e.receiptStatus) : "",
        first ? lateWord(e) : "",
      ]);
    });
  }
  return toCsv(rows);
}

export function statementCsv(kind: StatementKind, s: StatementsPayload): string {
  const rows: (string | number)[][] = [["Line", "Reported", "From your journal", "Difference"]];
  for (const r of statementRows(kind, s)) rows.push(statementCsvRow(r));
  return toCsv(rows);
}

function statementCsvRow(r: StatementRow): (string | number)[] {
  return [
    r.label + (r.derived ? " (derived)" : ""),
    r.reportedCents === null ? "" : formatCsvAmount(r.reportedCents),
    r.journalCents === null ? "" : formatCsvAmount(r.journalCents),
    r.differenceCents === 0 ? "" : formatCsvAmount(r.differenceCents),
  ];
}

export function checksCsv(checks: readonly Check[]): string {
  const rows: (string | number)[][] = [["Check", "Status", "Result", "Amount"]];
  for (const c of checks) {
    rows.push([c.code, c.status.toUpperCase(), c.message, c.amountCents === undefined ? "" : formatCsvAmount(c.amountCents)]);
  }
  return toCsv(rows);
}

export function summaryCsv(
  kpis: readonly { label: string; journalCents: number; reportedCents: number | null }[],
): string {
  const rows: (string | number)[][] = [["Measure", "Reported", "From your journal", "Difference"]];
  for (const k of kpis) {
    const diff = k.reportedCents === null ? null : k.journalCents - k.reportedCents;
    rows.push([
      k.label,
      k.reportedCents === null ? "" : formatCsvAmount(k.reportedCents),
      formatCsvAmount(k.journalCents),
      diff === null || diff === 0 ? "" : formatCsvAmount(diff),
    ]);
  }
  return toCsv(rows);
}

/** Save text as a file. Browser only. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
