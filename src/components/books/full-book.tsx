"use client";

import * as React from "react";
import { formatUsd, periodLabel, periodRangeLabel } from "@/lib/books/money";
import { kpis } from "@/lib/books/view";
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

  const figures = kpis(statements, bank);
  const byId = (id: string) => figures.find((f) => f.id === id)!;
  const bankEnding = bank?.[0]?.bankEndingCents ?? null;
  const cover = {
    revenue: byId("revenue").journalCents,
    expenses: byId("expenses").journalCents,
    net: byId("net").journalCents,
    cash: bankEnding ?? byId("cash").journalCents,
  };
  const range = periodRangeLabel(statements.period.start, statements.period.end);

  return (
    <div className="books-fullbook">
      <section
        className="books-cover-page"
        aria-label="Cover"
        style={{ paddingTop: "0.5in" }}
      >
        <div className="books-cover-top">
          {brand.logoUrl ? (
            <span className="books-logo-chip books-print-keep inline-flex items-center rounded-lg bg-obsidian px-4 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt={`${brand.name} logo`} className="h-14 w-auto max-w-72 object-contain object-left" />
            </span>
          ) : (
            <span aria-hidden className="grid size-16 place-items-center rounded-lg bg-gold font-grotesk text-2xl font-semibold text-gold-ink">
              {brand.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <p className="mt-14 text-sm uppercase tracking-[0.18em]">Books for {periodLabel(period)}</p>
          <h1 className="mt-2 font-grotesk text-5xl font-semibold leading-none tracking-tight">{brand.name}</h1>
          {entity && <p className="mt-3 text-base">{entity}</p>}
          <p className="mt-2 text-sm">{range}</p>
        </div>

        <div
          className="books-accent-band books-print-keep mt-8 h-2 w-full rounded-full"
          style={{ background: "var(--color-gold)" }}
          aria-hidden
        />

        <dl className="books-cover-figures mt-12 grid grid-cols-2 gap-x-10 gap-y-8">
          <CoverFigure label="Revenue" value={formatUsd(cover.revenue)} />
          <CoverFigure label="Expenses" value={formatUsd(cover.expenses)} />
          <CoverFigure label="Net income" value={formatUsd(cover.net)} />
          <CoverFigure label="Cash per bank" value={formatUsd(cover.cash)} />
        </dl>

        <div className="mt-16">
          <p className="text-xs uppercase tracking-[0.18em]">Contents</p>
          <ol className="books-toc mt-3 space-y-2 text-base">
            {sections.map((s, i) => (
              <li key={s.id}>
                <span className="tabular-nums">{i + 1}.</span> {s.title}
              </li>
            ))}
          </ol>
        </div>

        <div aria-hidden style={{ height: "2.1in" }} />
        <p className="books-cover-foot border-t border-[#d4d4d4] pt-3 text-xs">Prepared in Pulse</p>
      </section>

      <table className="books-frame books-fullbook-table">
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
    </div>
  );
}

function CoverFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="books-avoid-break border-t border-[#d4d4d4] pt-3">
      <dt className="text-xs uppercase tracking-[0.12em]">{label}</dt>
      <dd className="mt-1 font-grotesk text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

