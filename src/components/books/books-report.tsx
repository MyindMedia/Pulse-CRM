"use client";

import * as React from "react";
import { Printer, Download01, File05 } from "@untitledui/icons";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { brandStyle } from "@/lib/brand-theme";
import { cn } from "@/lib/utils";
import { periodLabel } from "@/lib/books/money";
import { checksCsv, downloadText, journalCsv, statementCsv, summaryCsv } from "@/lib/books/export";
import { kpis, lineDifferences, TABS, type Attention, type JournalFilter, type TabId } from "@/lib/books/view";
import type { AccountRow, BankRow, JournalEntryRow, PeriodRow, StatementsPayload } from "@/lib/books/types";
import { BOOKS_PRINT_CSS } from "./print-css";
import { BrandBar, PrintFrame, type BooksBrand } from "./brand-bar";
import { BooksErrorBoundary, Skeletonish } from "./primitives";
import { SummaryPanel } from "./summary-panel";
import { JournalPanel } from "./journal-panel";
import { StatementPanel } from "./statement-panel";
import { ChecksPanel } from "./checks-panel";
import { FullBook } from "./full-book";
import { AddMissedItemButton, LateEntrySheet, LateReverseSheet, type ReverseTarget } from "./late-entry-sheet";
import { isPastPeriod } from "@convex/lib/lateEntries";
import type { LateEntryApi } from "@/lib/books/late";

export type BooksJournalState = {
  entries: JournalEntryRow[] | undefined;
  totals: { entryCount: number; debitCents: number; creditCents: number } | undefined;
  filter: JournalFilter;
  onFilterChange: (f: JournalFilter) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  /** Every entry that matches the filter, for the CSV (may fetch pages). */
  allMatching: () => Promise<JournalEntryRow[]>;
};

export type BooksReportProps = {
  brand: BooksBrand;
  period: string;
  periods: PeriodRow[] | undefined;
  onPeriodChange: (period: string) => void;
  /** undefined while loading. */
  statements: StatementsPayload | undefined;
  accounts: AccountRow[] | undefined;
  bank: BankRow[] | undefined;
  journal: BooksJournalState;
  /** Late entries: add a missed item to an ended month, reverse one. Absent
   *  where the screen is read only. */
  late?: LateEntryApi;
};

const SECTION_NAME: Record<TabId, string> = {
  summary: "Summary",
  journal: "Journal",
  balanceSheet: "Balance Sheet",
  incomeStatement: "Income Statement",
  cashFlow: "Cash Flow",
  checks: "Checks",
};

export function BooksReport(props: BooksReportProps) {
  const { brand, period, periods, onPeriodChange, statements, accounts, bank, journal, late } = props;
  const [lateOpen, setLateOpen] = React.useState(false);
  const [reverseTarget, setReverseTarget] = React.useState<ReverseTarget | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const canAddLate = !!late?.canAdd && !!period && !!statements && isPastPeriod(period, late.now);
  const onReverse = late?.canAdd ? (e: ReverseTarget) => setReverseTarget(e) : undefined;
  const [tab, setTab] = React.useState<TabId>("summary");
  const [focus, setFocus] = React.useState<{ tab: TabId; id: string } | null>(null);
  const [exporting, setExporting] = React.useState(false);
  /** Set while the full book is printing: every journal row, rendered as the book. */
  const [fullRows, setFullRows] = React.useState<JournalEntryRow[] | null>(null);

  React.useEffect(() => {
    const done = () => setFullRows(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  /** Print the whole book: every journal row, all six sections in order. */
  async function printFullBook() {
    if (!statements) return;
    const rows = await journal.allMatching();
    setFullRows(rows);
    // Two frames so the book is in the DOM and styled before the print dialog.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    window.print();
  }

  const entity = statements?.entityName ?? statements?.reported?.entityName ?? null;
  const rootStyle = {
    ...(brandStyle(brand.accentColor) ?? {}),
    "--books-accent": "var(--color-gold)",
  } as React.CSSProperties;
  const slug = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "studio";

  // Bring the row a link pointed at into view after the tab opens.
  React.useEffect(() => {
    if (!focus || focus.tab !== tab) return;
    const el = document.getElementById(focus.id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [focus, tab]);

  const go = (a: Attention) => {
    if (a.tab === "journal") journal.onFilterChange(a.filter ?? {});
    setTab(a.tab);
    const id = a.rowKey
      ? a.tab === "journal"
        ? `books-entry-${a.rowKey}`
        : `books-row-${a.tab}-${a.rowKey}`
      : "";
    setFocus(id ? { tab: a.tab, id } : null);
  };

  async function exportCsv() {
    if (!statements) return;
    setExporting(true);
    try {
      let text: string;
      let name: string;
      if (tab === "journal") {
        const rows = await journal.allMatching();
        text = journalCsv(rows, accounts ?? []);
        name = "journal";
      } else if (tab === "checks") {
        text = checksCsv(statements.checks);
        name = "checks";
      } else if (tab === "summary") {
        text = summaryCsv(kpis(statements, bank));
        name = "summary";
      } else {
        text = statementCsv(tab, statements);
        name = tab === "balanceSheet" ? "balance-sheet" : tab === "incomeStatement" ? "income-statement" : "cash-flow";
      }
      downloadText(`${slug}-${name}-${period}.csv`, text);
    } finally {
      setExporting(false);
    }
  }

  const noPeriods = periods !== undefined && periods.length === 0;

  return (
    <div
      className="books-root grain relative space-y-6 text-bone"
      style={rootStyle}
      data-print-mode={fullRows ? "full" : undefined}
    >
      <style dangerouslySetInnerHTML={{ __html: BOOKS_PRINT_CSS }} />

      <div className="books-no-print flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="overline">Finance · Books</p>
          <h1 className="chrome-display text-[1.75rem] leading-[0.95] tracking-[-0.01em] text-bone sm:text-[2rem]">
            Books
          </h1>
          <p className="max-w-2xl text-sm text-steel">
            The owner&apos;s workbook, rebuilt from the journal. Reported and recomputed figures sit side by side.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs text-steel">Period</span>
            <select
              value={period}
              disabled={!periods || periods.length === 0}
              onChange={(e) => onPeriodChange(e.target.value)}
              className="h-9 min-w-[10rem] rounded-md border border-graphite/70 bg-coal px-2.5 text-sm text-bone focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none disabled:opacity-60"
            >
              {(periods ?? [{ period, hasReported: false, hasBank: false, hasEntries: false }]).map((p) => (
                <option key={p.period} value={p.period}>
                  {periodLabel(p.period)}
                </option>
              ))}
            </select>
          </label>
          {canAddLate && <AddMissedItemButton onClick={() => setLateOpen(true)} />}
          <Button variant="secondary" size="sm" onClick={() => window.print()} disabled={!statements}>
            <Printer className="size-4" aria-hidden />
            Print this tab
          </Button>
          <Button variant="secondary" size="sm" onClick={printFullBook} disabled={!statements}>
            <Printer className="size-4" aria-hidden />
            Print full book
          </Button>
          <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!statements || exporting}>
            <Download01 className="size-4" aria-hidden />
            {exporting ? "Preparing" : "Download CSV"}
          </Button>
        </div>
      </div>

      <div className="books-no-print">
        <BrandBar brand={brand} entityName={entity} period={period} />
      </div>

      {notice && (
        <p role="status" className="books-no-print rounded-lg border border-positive/30 bg-positive/5 px-3.5 py-2.5 text-sm text-bone" data-testid="books-notice">
          {notice}
          <button type="button" onClick={() => setNotice(null)} className="ml-3 text-xs text-steel underline underline-offset-4">
            Dismiss
          </button>
        </p>
      )}

      {noPeriods ? (
        <EmptyState
          icon={File05}
          title="No books yet"
          description="Once the studio's workbook is imported, its months appear here."
        />
      ) : (
        <BooksErrorBoundary>
          <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="books-tabwrap space-y-5">
            <div className="books-no-print -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <TabsList aria-label="Books sections" className="min-w-max">
                {TABS.map((t) => (
                  <TabsTrigger key={t.id} value={t.id}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="summary">
              {statements ? (
                <PrintFrame brand={brand} entityName={entity} period={period} section={SECTION_NAME.summary}>
                  <SummaryPanel statements={statements} bank={bank} onGo={go} />
                </PrintFrame>
              ) : (
                <Skeletonish rows={8} />
              )}
            </TabsContent>

            <TabsContent value="journal">
              <PrintFrame brand={brand} entityName={entity} period={period} section={SECTION_NAME.journal}>
                <JournalPanel
                  entries={journal.entries}
                  accounts={accounts}
                  totals={journal.totals}
                  filter={journal.filter}
                  onFilterChange={journal.onFilterChange}
                  hasMore={journal.hasMore}
                  onLoadMore={journal.onLoadMore}
                  loadingMore={journal.loadingMore}
                  focusEntryId={focus?.tab === "journal" ? focus.id.replace("books-entry-", "") : null}
                  onReverse={onReverse ? (e) => onReverse({ id: e._id, memo: e.memo, entryDate: e.entryDate, totalCents: e.totalCents }) : undefined}
                />
              </PrintFrame>
            </TabsContent>

            {(["balanceSheet", "incomeStatement", "cashFlow"] as const).map((k) => (
              <TabsContent key={k} value={k}>
                <PrintFrame brand={brand} entityName={entity} period={period} section={SECTION_NAME[k]}>
                  {statements ? (
                    <StatementPanel
                      kind={k}
                      statements={statements}
                      focusKey={focus?.tab === k ? focus.id.replace(`books-row-${k}-`, "") : null}
                    />
                  ) : (
                    <Skeletonish />
                  )}
                </PrintFrame>
              </TabsContent>
            ))}

            <TabsContent value="checks">
              <PrintFrame brand={brand} entityName={entity} period={period} section={SECTION_NAME.checks}>
                {statements ? (
                  <ChecksPanel checks={statements.checks} bank={bank} differences={lineDifferences(statements)} statements={statements} onReverse={onReverse} />
                ) : (
                  <Skeletonish />
                )}
              </PrintFrame>
            </TabsContent>
          </Tabs>
        </BooksErrorBoundary>
      )}
      {fullRows && statements && (
        <FullBook
          brand={brand}
          statements={statements}
          bank={bank}
          accounts={accounts}
          entries={fullRows}
          totals={journal.totals}
        />
      )}
      {late && period && (
        <>
          <LateEntrySheet
            open={lateOpen}
            onOpenChange={setLateOpen}
            period={period}
            accounts={accounts ?? []}
            api={late}
            brandStyle={rootStyle}
            onDone={setNotice}
          />
          <LateReverseSheet
            entry={reverseTarget}
            onOpenChange={(o) => !o && setReverseTarget(null)}
            api={late}
            brandStyle={rootStyle}
            onDone={setNotice}
          />
        </>
      )}
      <span className={cn("sr-only")} aria-live="polite">
        {exporting ? "Preparing CSV" : ""}
      </span>
    </div>
  );
}
