"use client";

import * as React from "react";
import { buildFixture, fixtureEngine, FIXTURE_BRAND, FIXTURE_PERIOD, type FixtureLateEntry } from "@/lib/books/fixture";
import { filterJournal, type JournalFilter } from "@/lib/books/view";
import type { JournalEntryRow } from "@/lib/books/types";
import type { LateEntryApi, LateFormInput } from "@/lib/books/late";
import {
  checkLateDate,
  lateLedgerEntry,
  planLateEntry,
  possibleDuplicates,
  previewWithEntry,
  reversalLines,
} from "@convex/lib/lateEntries";
import { LedgerValidationError, type LedgerEntry } from "@convex/lib/ledgerMath";
import { BooksReport, type BooksJournalState } from "./books-report";

const PAGE = 25;

/** The whole Books report from the anonymized July fixture, run through the
 *  real engine. Same components as the live page; only the data source and
 *  the filter/paging (done in the client here) differ. Late entries added
 *  here live in memory and go through the same pure engine the ledger uses
 *  (lib/lateEntries.ts); a receipt is marked attached, never uploaded. */
export function BooksPreview({ accent }: { accent?: string }) {
  const [late, setLate] = React.useState<FixtureLateEntry[]>([]);
  const data = React.useMemo(() => buildFixture(late), [late]);
  const [filter, setFilter] = React.useState<JournalFilter>({});
  const [shown, setShown] = React.useState(PAGE);

  const matching = React.useMemo(() => {
    const rows = filterJournal(data.entries, filter);
    // Newest first, as the ledger returns it.
    return [...rows].sort((a, b) => b.entryDate - a.entryDate);
  }, [data, filter]);

  const lateApi = useFixtureLateApi(late, setLate);

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
      late={lateApi}
    />
  );
}

function useFixtureLateApi(late: FixtureLateEntry[], setLate: React.Dispatch<React.SetStateAction<FixtureLateEntry[]>>): LateEntryApi {
  const engine = React.useMemo(() => fixtureEngine(), []);
  const [now] = React.useState(() => Date.now());
  return React.useMemo(() => {
    const entries = (): LedgerEntry[] => [...engine.entries, ...late];
    const prepare = (input: LateFormInput) => {
      const { day, period } = checkLateDate({ periodKey: FIXTURE_PERIOD, entryDate: input.entryDate, now, openingDates: [engine.opening.asOf] });
      const plan = planLateEntry({ ...input, entryDate: day }, engine.accounts);
      return { day, period, plan };
    };
    return {
      canAdd: true,
      now,
      preview: async (_p, input) => {
        try {
          const { day, period, plan } = prepare(input);
          const all = entries();
          const { before, after } = previewWithEntry({ period, accounts: engine.accounts, opening: engine.opening, entries: all, add: lateLedgerEntry(plan, day, { enteredAt: now, enteredBy: "Preview" }) });
          const names = new Map(engine.accounts.map((a) => [a.id, a.name]));
          return {
            ok: true as const, memo: plan.memo, reason: plan.reason, totalCents: plan.totalCents,
            lines: plan.lines.map((l) => ({ accountName: names.get(l.accountId) ?? l.accountId, debitCents: l.debitCents, creditCents: l.creditCents })),
            before, after, hasReported: true,
            duplicates: possibleDuplicates(all, { entryDate: day, totalCents: plan.totalCents, categoryAccountId: plan.category.id, counterparty: input.counterparty }),
          };
        } catch (e) {
          if (e instanceof LedgerValidationError) return { ok: false as const, error: e.message };
          throw e;
        }
      },
      submit: async (_p, input, opts) => {
        const { day, period, plan } = prepare(input);
        const all = entries();
        if (!opts.allowDuplicate && possibleDuplicates(all, { entryDate: day, totalCents: plan.totalCents, categoryAccountId: plan.category.id, counterparty: input.counterparty }).length) {
          throw new Error("This may already be in the books. Confirm it is a different charge to add it anyway.");
        }
        const id = `late-${late.length + 1}`;
        const entry: FixtureLateEntry = {
          ...lateLedgerEntry(plan, day, { enteredAt: Date.now(), enteredBy: "Preview owner", kind: input.kind, counterparty: input.counterparty.trim() }, id),
          receipt: !!opts.file,
        };
        const { before, after } = previewWithEntry({ period, accounts: engine.accounts, opening: engine.opening, entries: all, add: entry });
        setLate((xs) => [...xs, entry]);
        return { before, after };
      },
      reversePreview: async (id) => {
        const e = late.find((x) => x.id === id);
        if (!e || e.late?.reversalOf || e.late?.reversedBy) return { ok: false as const, error: "Only a late entry that has not been reversed can be reversed." };
        const { before, after } = previewWithEntry({ period: engine.period, accounts: engine.accounts, opening: engine.opening, entries: entries(), add: { ...e, id: "rev", lines: reversalLines(e.lines) } });
        return { ok: true as const, memo: e.memo, totalCents: e.lines.reduce((s, l) => s + l.debitCents, 0), before, after };
      },
      reverse: async (id, reason) => {
        const e = late.find((x) => x.id === id);
        if (!e || e.late?.reversalOf || e.late?.reversedBy) throw new Error("Only a late entry that has not been reversed can be reversed.");
        const revId = `${id}-reversal`;
        const rev: FixtureLateEntry = {
          id: revId, entryDate: e.entryDate, memo: `Reversal of late entry: ${e.memo}`, status: "posted", receiptStatus: e.receiptStatus,
          lines: reversalLines(e.lines),
          late: { enteredAt: Date.now(), enteredBy: "Preview owner", reason, reversalOf: id, ...(e.late?.counterparty ? { counterparty: e.late.counterparty } : {}) },
        };
        const { before, after } = previewWithEntry({ period: engine.period, accounts: engine.accounts, opening: engine.opening, entries: entries(), add: rev });
        setLate((xs) => [...xs.map((x) => (x.id === id ? { ...x, late: { ...x.late!, reversedBy: revId } } : x)), rev]);
        return { before, after };
      },
      suggestions: [],
    };
  }, [engine, late, setLate, now]);
}
