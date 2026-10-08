"use client";

import * as React from "react";
import { ChevronDown } from "@untitledui/icons";
import { cn } from "@/lib/utils";
import { explainDifference, STATEMENT_TITLE, statementRows, type StatementRow } from "@/lib/books/view";
import { formatAmount } from "@/lib/books/money";
import type { StatementKind, StatementsPayload } from "@/lib/books/types";
import { Notice, SignedMoney } from "./primitives";

const SECTION_LABEL: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
  operating: "Operating activities",
  investing: "Investing activities",
  financing: "Financing activities",
  unclassified: "Not classified",
};

/** One statement, the workbook's own labels and order. Reported beside the
 *  journal, then the difference. A nonzero difference is highlighted and
 *  expands to say why. */
export function StatementPanel({
  kind,
  statements,
  focusKey,
}: {
  kind: StatementKind;
  statements: StatementsPayload;
  focusKey?: string | null;
}) {
  const rows = statementRows(kind, statements);
  const hasReported = statements.reported !== null;
  const notes = (statements.reported?.warnings ?? []).filter((w) =>
    kind === "cashFlow" ? w.code === "beginning_cash_label_date" : kind === "balanceSheet" ? w.code === "retained_earnings_plug" : false,
  );
  const [open, setOpen] = React.useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-grotesk text-lg font-semibold text-bone">{STATEMENT_TITLE[kind]}</h2>
        <p className="text-xs text-steel">
          {hasReported ? `Workbook: ${statements.reported?.entityName ?? "imported"}` : "No workbook imported for this month"}
        </p>
      </div>

      {!hasReported && (
        <Notice title="Journal only">
          The owner&apos;s workbook was not imported for this month, so there is nothing to compare against. Figures are
          from the journal.
        </Notice>
      )}

      {notes.map((w) => (
        <Notice key={w.cell ?? w.message} tone="caution" title="From your workbook">
          {w.message}
        </Notice>
      ))}

      <div className="books-scroll relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[32rem] border-separate border-spacing-0 text-sm">
          <caption className="sr-only">{STATEMENT_TITLE[kind]}, reported beside your journal</caption>
          <thead className="books-table-head">
            <tr className="text-left text-xs text-steel">
              <th scope="col" className="books-sticky sticky left-0 z-[1] bg-coal-2 py-2 pr-3 font-medium">
                Line
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Reported</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">From your journal</th>
              <th scope="col" className="py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            <StatementRows rows={rows} kind={kind} open={open} setOpen={setOpen} focusKey={focusKey} />
          </tbody>
        </table>
      </div>
      <p className="text-xs text-steel">
        Difference is your journal minus the workbook. A highlighted difference opens to say why.
      </p>
    </div>
  );
}

function StatementRows({
  rows,
  kind,
  open,
  setOpen,
  focusKey,
}: {
  rows: StatementRow[];
  kind: StatementKind;
  open: string | null;
  setOpen: (k: string | null) => void;
  focusKey?: string | null;
}) {
  const out: React.ReactNode[] = [];
  let lastSection: string | null = null;
  for (const r of rows) {
    if (r.kind === "line" && r.section !== lastSection) {
      lastSection = r.section;
      const label = SECTION_LABEL[r.section];
      if (label) {
        out.push(
          <tr key={`sec-${r.section}-${r.key}`}>
            <th scope="rowgroup" colSpan={4} className="pb-1 pt-4 text-left text-[0.6875rem] font-medium uppercase tracking-wider text-steel">
              {label}
            </th>
          </tr>,
        );
      }
    }
    if (r.kind === "total") lastSection = null;
    const total = r.kind === "total";
    const flagged = r.differenceCents !== 0;
    const isOpen = open === r.key;
    const focused = focusKey === r.key;
    out.push(
      <tr
        key={r.key}
        id={`books-row-${kind}-${r.key}`}
        data-focus={focused ? "true" : undefined}
        className={cn(
          "books-avoid-break group/row",
          focused && "bg-gold/10",
        )}
      >
        <th
          scope="row"
          className={cn(
            "books-sticky sticky left-0 z-[1] border-b border-graphite/40 bg-coal-2 py-2 pr-3 text-left font-normal",
            total ? "font-semibold text-bone" : "pl-3 text-bone/90",
            focused && "bg-coal-2",
          )}
        >
          {r.label}
          {r.derived && <span className="ml-1.5 text-xs font-normal text-steel">(derived)</span>}
        </th>
        <td className={cn("border-b border-graphite/40 py-2 pr-3 text-right", total && "font-semibold")}>
          {r.reportedCents === null ? (
            <span className="text-xs text-steel" title="This line is not in the workbook">not in workbook</span>
          ) : (
            <span className="tabular-nums">{formatAmount(r.reportedCents)}</span>
          )}
        </td>
        <td className={cn("border-b border-graphite/40 py-2 pr-3 text-right tabular-nums", total && "font-semibold")}>
          {r.journalCents === null ? (
            <span className="text-xs text-steel">no journal entries</span>
          ) : (
            formatAmount(r.journalCents)
          )}
        </td>
        <td className="border-b border-graphite/40 py-1.5 text-right">
          {flagged ? (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={`books-why-${kind}-${r.key}`}
              onClick={() => setOpen(isOpen ? null : r.key)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-caution/40 bg-caution/10 px-2 py-1 text-caution tabular-nums",
                "hover:bg-caution/20 focus-visible:ring-2 focus-visible:ring-caution/40 focus-visible:outline-none",
                total && "font-semibold",
              )}
            >
              <SignedMoney cents={r.differenceCents} className="books-diff-flag" />
              <ChevronDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", isOpen && "rotate-180")} aria-hidden />
              <span className="sr-only">Why this differs</span>
            </button>
          ) : (
            <span className="tabular-nums text-steel">{r.reportedCents === null ? "" : "0.00"}</span>
          )}
        </td>
      </tr>,
    );
    if (flagged && isOpen) {
      out.push(
        <tr key={`${r.key}-why`} id={`books-why-${kind}-${r.key}`} className="books-expand-row">
          <td colSpan={4} className="pb-3 pl-3 pr-3 text-sm leading-relaxed text-steel">
            {explainDifference(r)}
          </td>
        </tr>,
      );
    }
  }
  return <>{out}</>;
}
