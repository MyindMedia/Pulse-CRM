"use client";

import * as React from "react";
import { periodLabel } from "@/lib/books/money";
import { lineDifferences, TABS } from "@/lib/books/view";
import type { AccountRow, BankRow, JournalEntryRow, StatementsPayload } from "@/lib/books/types";
import { BrandBar, type BooksBrand } from "./brand-bar";
import { ChecksPanel } from "./checks-panel";
import { JournalPanel } from "./journal-panel";
import { StatementPanel } from "./statement-panel";
import { SummaryPanel } from "./summary-panel";

/** The whole book for print: cover, contents, then the six sections in order,
 *  each on a new page. The brand header repeats on every page (thead) and the
 *  footer carries the page count (tfoot plus the @page counter). Hidden on
 *  screen; shown only while printing the full book. */
export function FullBook({
  brand,
  statements,
  bank,
  accounts,
  entries,
  totals,
}: {
  brand: BooksBrand;
  statements: StatementsPayload;
  bank: BankRow[] | undefined;
  accounts: AccountRow[] | undefined;
  entries: JournalEntryRow[];
  totals: { entryCount: number; debitCents: number; creditCents: number } | undefined;
}) {
  const period = statements.period.key;
  const entity = statements.entityName ?? statements.reported?.entityName ?? null;
  const sections: { id: string; title: string; body: React.ReactNode }[] = [
    { id: "summary", title: "Summary", body: <SummaryPanel statements={statements} bank={bank} onGo={() => {}} printAll /> },
    {
      id: "journal",
      title: "Journal",
      body: (
        <JournalPanel
          entries={entries}
          accounts={accounts}
          totals={totals}
          filter={{}}
          onFilterChange={() => {}}
          hasMore={false}
          onLoadMore={() => {}}
          loadingMore={false}
        />
      ),
    },
    { id: "balanceSheet", title: "Balance Sheet", body: <StatementPanel kind="balanceSheet" statements={statements} /> },
    { id: "incomeStatement", title: "Income Statement", body: <StatementPanel kind="incomeStatement" statements={statements} /> },
    { id: "cashFlow", title: "Cash Flow", body: <StatementPanel kind="cashFlow" statements={statements} /> },
    {
      id: "checks",
      title: "Checks",
      body: <ChecksPanel checks={statements.checks} bank={bank} differences={lineDifferences(statements)} />,
    },
  ];
  // The book carries the same six sections as the tabs, in the same order.
  const order = TABS.map((t) => t.id);
  const titles = sections.map((s) => s.id);
  if (order.join() !== titles.join()) throw new Error("Full book sections must match the tabs in order");

  return (
    <table className="books-frame books-fullbook">
      <thead className="books-frame-head">
        <tr>
          <th scope="col" className="books-frame-head pb-3 text-left font-normal">
            <BrandBar brand={brand} entityName={entity} period={period} section="Full book" />
          </th>
        </tr>
      </thead>
      <tfoot className="books-frame-foot">
        <tr>
          <td className="books-frame-foot">
            Prepared in Pulse · {brand.name} · Full book · {periodLabel(period)}
          </td>
        </tr>
      </tfoot>
      <tbody>
        <tr>
          <td>
            <section className="books-cover" aria-label="Cover">
              <p className="overline">Books · {periodLabel(period)}</p>
              <h1 className="mt-2 font-grotesk text-3xl font-semibold tracking-tight text-bone">{brand.name}</h1>
              {entity && <p className="mt-1 text-sm text-steel">{entity}</p>}
              <p className="mt-6 text-xs uppercase tracking-wider text-steel">Contents</p>
              <ol className="books-toc mt-2 space-y-1 text-sm text-bone">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <span className="tabular-nums text-steel">{i + 1}.</span> {s.title}
                  </li>
                ))}
              </ol>
            </section>

            {sections.map((s, i) => (
              <section key={s.id} id={`book-${s.id}`} className="books-section pt-4">
                <h2 className="mb-4 font-grotesk text-xl font-semibold text-bone">
                  <span className="tabular-nums text-steel">{i + 1}.</span> {s.title}
                </h2>
                {s.body}
              </section>
            ))}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
