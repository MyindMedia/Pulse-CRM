"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { dayLabel, formatUsd } from "@/lib/books/money";
import { lateChanges, lateStatus } from "@/lib/books/view";
import type { LateSummary, StatementsPayload } from "@/lib/books/types";
import { Money, SignedMoney } from "./primitives";

/** "Changes since reported": the late entries added to this month after the
 *  workbook was checked, and every statement line they moved, split into what
 *  the late entries did and what was there before. Every figure is the
 *  engine's (lateEntryImpact). Used on the Checks tab and as the printed
 *  book's appendix. */
export function LateChanges({
  statements,
  onReverse,
  print = false,
}: {
  statements: StatementsPayload;
  /** Offered on a late entry that is not reversed yet, when the viewer may. */
  onReverse?: (e: LateSummary) => void;
  print?: boolean;
}) {
  const late = lateChanges(statements);
  if (!late) return null;
  const hasReported = statements.reported !== null;
  return (
    <section aria-labelledby="books-late" className="books-avoid-break space-y-3" data-testid="late-changes">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="books-late" className="font-grotesk text-base font-semibold text-bone">
          {print ? "Changes since reported" : "Late entries: changes since reported"}
        </h2>
        <Badge tone="info">{late.count} late {late.count === 1 ? "entry" : "entries"}</Badge>
      </div>
      <p className="rounded-lg border border-info/30 bg-info/5 px-3.5 py-2.5 text-sm leading-relaxed text-bone" data-testid="late-headline">
        {late.headline}
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:max-w-md">
        <div className="rounded-lg border border-graphite/60 bg-coal-2 p-3">
          <dt className="text-xs text-steel">Net income</dt>
          <dd className="mt-1 tabular-nums text-bone">
            {formatUsd(late.before.netIncomeCents)} <span className="text-steel">to</span> {formatUsd(late.after.netIncomeCents)}
          </dd>
        </div>
        <div className="rounded-lg border border-graphite/60 bg-coal-2 p-3">
          <dt className="text-xs text-steel">Cash at month end</dt>
          <dd className="mt-1 tabular-nums text-bone">
            {formatUsd(late.before.endingCashCents)} <span className="text-steel">to</span> {formatUsd(late.after.endingCashCents)}
          </dd>
        </div>
      </dl>

      <ul className="divide-y divide-graphite/50 rounded-xl border border-graphite/60 bg-coal-2">
        {late.entries.map((e) => (
          <li key={e.id} className="books-avoid-break grid gap-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4" data-testid="late-entry-row">
            <div className="min-w-0">
              <p className="text-sm text-bone">
                <Badge tone={e.reversalOf || e.reversedBy ? "neutral" : "info"} className="mr-2 align-middle">
                  {lateStatus(e)}
                </Badge>
                {e.memo}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-steel">
                Dated {dayLabel(e.entryDate)}
                {e.inPeriod ? "" : " (an earlier month, carried into this one)"} · entered {dayLabel(e.enteredAt)} by {e.enteredBy} ·{" "}
                {e.reason}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <Money cents={e.totalCents} usd className="text-sm text-bone" />
              {onReverse && !print && !e.reversalOf && !e.reversedBy && (
                <button
                  type="button"
                  onClick={() => onReverse(e)}
                  className="books-no-print inline-flex h-8 items-center rounded-md border border-graphite/70 px-3 text-xs text-bone hover:bg-coal-3 focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                >
                  Reverse
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {late.lines.length > 0 && (
        <div className="books-scroll relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="sr-only">Statement lines the late entries moved</caption>
            <thead>
              <tr className="text-xs text-steel">
                <th scope="col" className="py-2 text-left font-medium">Statement and line</th>
                <th scope="col" className="py-2 text-right font-medium">Reported</th>
                <th scope="col" className="py-2 text-right font-medium">Your journal now</th>
                <th scope="col" className="py-2 text-right font-medium">Late entries</th>
                {hasReported && <th scope="col" className="py-2 text-right font-medium">Before them</th>}
              </tr>
            </thead>
            <tbody>
              {late.lines.map((l) => (
                <tr key={`${l.statement}-${l.key}`} className="books-avoid-break border-t border-graphite/40" data-testid="late-line">
                  <th scope="row" className="py-2 text-left font-normal text-bone/90">
                    <span className={l.kind === "total" ? "block font-medium text-bone" : "block text-bone"}>{l.label}</span>
                    <span className="text-xs text-steel">{l.statementName}</span>
                  </th>
                  <td className="py-2 text-right">
                    {l.reportedCents === null ? <span className="text-xs text-steel">not in workbook</span> : <Money cents={l.reportedCents} />}
                  </td>
                  <td className="py-2 text-right"><Money cents={l.recomputedCents} /></td>
                  <td className="py-2 text-right text-info"><SignedMoney cents={l.lateEntryCents} /></td>
                  {hasReported && (
                    <td className="py-2 text-right text-steel">
                      {l.otherCents === null ? "" : l.otherCents === 0 ? "0.00" : <SignedMoney cents={l.otherCents} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-steel">
        The reported statements are kept exactly as they were checked. &quot;Late entries&quot; is what was added after; &quot;Before
        them&quot; is the difference that was already there.
      </p>
    </section>
  );
}
