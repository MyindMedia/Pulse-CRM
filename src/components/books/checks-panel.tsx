"use client";

import * as React from "react";
import type { BankRow, Check } from "@/lib/books/types";
import { lineDifferences } from "@/lib/books/view";
import { formatAmount, formatUsd } from "@/lib/books/money";
import { Money, Notice, SignedMoney, StatusBadge } from "./primitives";

/** What a person does next, per check. Plain words, no dashes. */
export const CHECK_ACTION: Record<string, string> = {
  balanced_entries: "Open the journal, find the entries that do not balance and correct the amounts.",
  opening_balanced: "Check the opening balances. They should equal assets less liabilities on the first day of the month.",
  balance_sheet_balances: "Find the account that is off. The Balance Sheet tab shows the difference.",
  cash_flow_ties: "Compare the cash flow lines with the journal's cash entries. One entry may be classified wrongly.",
  cash_vs_bank: "Compare each cash entry with the bank statement. If the gap is real, post a draft correcting entry.",
  unclassified_accounts: "Give the account a statement line in the chart of accounts.",
  receipts_missing: "Attach a receipt to each entry, or mark it Pending if the receipt is on its way.",
  clearing_not_cleared: "Match deposits in transit and owner-held funds to the bank or the owner's transfer, then clear them.",
  negative_cash: "Find the day cash went below zero. Check whether a payment was recorded before its deposit.",
  entries_outside_period: "Move the entry to the month it belongs to, or correct its date.",
  duplicate_entries: "Confirm each pair is two real transactions. Void the duplicate if it is not.",
  reported_statement_warnings: "Read the notes on the statement tabs. They describe the workbook, not the ledger.",
  reported_vs_recomputed: "Read the differences on each statement tab. Post a correcting entry for a real gap. Do not edit the workbook.",
};

const ORDER = { fail: 0, warn: 1, pass: 2 } as const;

export function ChecksPanel({
  checks,
  bank,
  differences = [],
}: {
  checks: Check[];
  bank: BankRow[] | undefined;
  differences?: ReturnType<typeof lineDifferences>;
}) {
  const sorted = [...checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;

  return (
    <div className="space-y-6">
      <p className="text-sm text-steel">
        {counts.fail} failing, {counts.warn} to review, {counts.pass} passing.
      </p>
      <ul className="divide-y divide-graphite/50 rounded-xl border border-graphite/60 bg-coal-2">
        {sorted.map((c) => (
          <li key={c.code} className="books-avoid-break grid gap-2 px-4 py-3 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-4">
            <div className="flex items-start gap-2 sm:block">
              <StatusBadge status={c.status} />
            </div>
            <div className="min-w-0">
              <p className="text-sm leading-relaxed text-bone">
                {c.message}
                {c.amountCents !== undefined && (
                  <span className="ml-1.5 whitespace-nowrap tabular-nums text-steel">({formatUsd(Math.abs(c.amountCents))})</span>
                )}
              </p>
              {c.status !== "pass" && (
                <p className="mt-1 text-sm text-steel">
                  <span className="text-bone/80">Next: </span>
                  {CHECK_ACTION[c.code] ?? "Review the entries behind this check."}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <section aria-labelledby="books-diffs" className="books-avoid-break space-y-3">
        <h2 id="books-diffs" className="font-grotesk text-base font-semibold text-bone">
          Statement differences
        </h2>
        {differences.length === 0 ? (
          <p className="text-sm text-steel">Every reported line matches the journal.</p>
        ) : (
          <div className="books-scroll relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[32rem] text-sm">
              <caption className="sr-only">Lines that differ between the workbook and the journal</caption>
              <thead>
                <tr className="text-xs text-steel">
                  <th scope="col" className="py-2 text-left font-medium">Statement and line</th>
                  <th scope="col" className="py-2 text-right font-medium">Reported</th>
                  <th scope="col" className="py-2 text-right font-medium">Your journal</th>
                  <th scope="col" className="py-2 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((d) => (
                  <tr key={`${d.tab}-${d.key}`} className="books-avoid-break border-t border-graphite/40">
                    <th scope="row" className="py-2 text-left font-normal text-bone/90">
                      <span className="block text-bone">{d.label}</span>
                      <span className="text-xs text-steel">{d.statement}</span>
                    </th>
                    <td className="py-2 text-right">{d.reportedCents === null ? <span className="text-xs text-steel">not in workbook</span> : <Money cents={d.reportedCents} />}</td>
                    <td className="py-2 text-right">{d.journalCents === null ? <span className="text-xs text-steel">no entries</span> : <Money cents={d.journalCents} />}</td>
                    <td className="py-2 text-right text-caution"><SignedMoney cents={d.differenceCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="books-bank" className="space-y-3">
        <h2 id="books-bank" className="font-grotesk text-base font-semibold text-bone">
          Bank reconciliation
        </h2>
        {!bank || bank.length === 0 ? (
          <Notice>No bank statement balance was imported for this month.</Notice>
        ) : (
          bank.map((row) => (
            <div key={row.accountLabel} className="books-avoid-break space-y-3">
              <div className="books-scroll relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[30rem] text-sm">
                  <caption className="text-left text-sm font-medium text-bone">{row.accountLabel}</caption>
                  <thead>
                    <tr className="text-xs text-steel">
                      <th scope="col" className="py-2 text-left font-medium"> </th>
                      <th scope="col" className="py-2 text-right font-medium">Bank</th>
                      <th scope="col" className="py-2 text-right font-medium">Your books</th>
                      <th scope="col" className="py-2 text-right font-medium">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-graphite/40">
                      <th scope="row" className="py-2 text-left font-normal text-bone/90">Beginning balance</th>
                      <td className="py-2 text-right"><Money cents={row.bankBeginningCents} /></td>
                      <td className="py-2 text-right"><Money cents={row.ledgerBeginningCents} /></td>
                      <td className="py-2 text-right"><Money cents={row.beginningVarianceCents} /></td>
                    </tr>
                    <tr className="border-t border-graphite/40">
                      <th scope="row" className="py-2 text-left font-normal text-bone/90">Net change</th>
                      <td className="py-2 text-right"><Money cents={row.bankNetChangeCents} /></td>
                      <td className="py-2 text-right"><Money cents={row.ledgerNetChangeCents} /></td>
                      <td className="py-2 text-right"><Money cents={row.netChangeVarianceCents} /></td>
                    </tr>
                    <tr className="border-t border-graphite/40 font-semibold">
                      <th scope="row" className="py-2 text-left">Ending balance</th>
                      <td className="py-2 text-right"><Money cents={row.bankEndingCents} /></td>
                      <td className="py-2 text-right"><Money cents={row.ledgerEndingCents} /></td>
                      <td className="py-2 text-right"><Money cents={row.endingVarianceCents} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {row.unclearedClearing.length > 0 && (
                <div className="space-y-1.5 text-sm">
                  <p className="text-steel">Still in clearing accounts at month end:</p>
                  <ul className="space-y-1">
                    {row.unclearedClearing.map((c) => (
                      <li key={c.accountId} className="flex justify-between gap-3">
                        <span className="text-bone/90">{c.name}</span>
                        <span className="tabular-nums text-bone">{formatUsd(c.cents)}</span>
                      </li>
                    ))}
                    <li className="flex justify-between gap-3 border-t border-graphite/40 pt-1 font-medium">
                      <span className="text-bone">Total</span>
                      <span className="tabular-nums text-bone">{formatUsd(row.unclearedClearingTotalCents)}</span>
                    </li>
                  </ul>
                </div>
              )}
              <p className="text-sm text-steel">
                {row.unexplainedCents === 0
                  ? "Everything in the gap is explained by clearing accounts."
                  : `${formatAmount(Math.abs(row.unexplainedCents))} of the gap is not explained by clearing accounts.`}
              </p>
            </div>
          ))
        )}
        <p className="text-xs text-steel">Difference is your books minus the bank.</p>
      </section>
    </div>
  );
}
