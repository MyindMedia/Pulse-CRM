"use client";

import * as React from "react";
import { buildFixture, FIXTURE_BRAND, FIXTURE_PERIOD } from "@/lib/books/fixture";
import { filterJournal, type JournalFilter } from "@/lib/books/view";
import type { JournalEntryRow } from "@/lib/books/types";
import { BooksReport, type BooksJournalState } from "./books-report";

const PAGE = 25;

/** The whole Books report from the anonymized July fixture, run through the
 *  real engine. Same components as the live page; only the data source and
 *  the filter/paging (done in the client here) differ. */
export function BooksPreview({ accent }: { accent?: string }) {
  const data = React.useMemo(() => buildFixture(), []);
  const [filter, setFilter] = React.useState<JournalFilter>({});
  const [shown, setShown] = React.useState(PAGE);

  const matching = React.useMemo(() => {
    const rows = filterJournal(data.entries, filter);
    // Newest first, as the ledger returns it.
    return [...rows].sort((a, b) => b.entryDate - a.entryDate);
  }, [data, filter]);

  const journal: BooksJournalState = {
    entries: matching.slice(0, shown) as JournalEntryRow[],
    totals: data.statements.journalTotals,
    filter,
    onFilterChange: (f) => {
      setFilter(f);
      setShown(PAGE);
    },
    hasMore: shown < matching.length,
    onLoadMore: () => setShown((n) => n + PAGE),
    loadingMore: false,
    allMatching: async () => matching,
  };

  return (
    <BooksReport
      brand={{ ...FIXTURE_BRAND, accentColor: accent ?? FIXTURE_BRAND.accentColor }}
      period={FIXTURE_PERIOD}
      periods={data.periods}
      onPeriodChange={() => {}}
      statements={data.statements}
      accounts={data.accounts}
      bank={data.bank}
      journal={journal}
    />
  );
}
