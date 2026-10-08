"use client";

import * as React from "react";
import { useConvex, usePaginatedQuery, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { BooksReport, type BooksJournalState } from "./books-report";
import type { JournalEntryRow } from "@/lib/books/types";
import type { JournalFilter } from "@/lib/books/view";

type ServerFilter = NonNullable<FunctionArgs<typeof api.ledger.journal>["filter"]>;

/** The client filter mapped to the ledger's filter argument. Empty values are
 *  dropped so an unset filter never matches nothing. */
function toServerFilter(f: JournalFilter): ServerFilter {
  const out: ServerFilter = {};
  if (f.text?.trim()) out.text = f.text.trim();
  if (f.accountId) out.accountId = f.accountId as Id<"ledgerAccounts">;
  if (f.paymentKind) out.paymentKind = f.paymentKind as ServerFilter["paymentKind"];
  if (f.receiptStatus) out.receiptStatus = f.receiptStatus;
  return out;
}

/** The live Books report: every number comes from the ledger queries. */
export function BooksLive() {
  const convex = useConvex();
  const org = useQuery(api.orgs.current);
  const periods = useQuery(api.ledger.periods, {});
  const [chosen, setChosen] = React.useState<string | null>(null);
  const period = chosen ?? periods?.[0]?.period ?? null;
  const [filter, setFilter] = React.useState<JournalFilter>({});

  const statements = useQuery(api.ledger.statements, period ? { period } : "skip");
  const accounts = useQuery(api.ledger.accounts, {});
  const bank = useQuery(api.ledger.bankReconciliation, period ? { period } : "skip");
  const serverFilter = toServerFilter(filter);
  const journal = usePaginatedQuery(
    api.ledger.journal,
    period ? { period, filter: serverFilter } : "skip",
    { initialNumItems: 25 },
  );

  const journalState: BooksJournalState = {
    entries: period ? (journal.results as JournalEntryRow[]) : [],
    totals: statements?.journalTotals,
    filter,
    onFilterChange: setFilter,
    hasMore: journal.status === "CanLoadMore",
    onLoadMore: () => journal.loadMore(50),
    loadingMore: journal.status === "LoadingMore",
    allMatching: async () => {
      if (!period) return [];
      const rows: JournalEntryRow[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 200; guard++) {
        const page = (await convex.query(api.ledger.journal, {
          period,
          filter: serverFilter,
          paginationOpts: { numItems: 200, cursor },
        })) as { page: unknown[]; isDone: boolean; continueCursor: string };
        rows.push(...(page.page as JournalEntryRow[]));
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      return rows;
    },
  };

  if (org === undefined || periods === undefined) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading books">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <BooksReport
      brand={{
        name: org?.name ?? "Pulse Studio",
        logoUrl: org?.logoUrl ?? null,
        accentColor: org?.accentColor ?? null,
      }}
      period={period ?? ""}
      periods={periods}
      onPeriodChange={(p) => {
        setChosen(p);
        setFilter({});
      }}
      statements={period ? statements : undefined}
      accounts={accounts}
      bank={period ? bank?.rows : undefined}
      journal={journalState}
    />
  );
}
