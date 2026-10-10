"use client";

import * as React from "react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionArgs } from "convex/server";
import { api } from "@convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";
import { BooksReport, type BooksJournalState } from "./books-report";
import type { JournalEntryRow } from "@/lib/books/types";
import type { JournalFilter } from "@/lib/books/view";
import type { LateEntryApi, LateFormInput, LateSuggestion } from "@/lib/books/late";
import { useR2Upload, r2NotConfigured } from "@/lib/use-r2-upload";

/** Late entries on the live ledger. A receipt goes straight to the studio's
 *  private R2 bucket (presigned PUT, then confirm), then receipts.attach makes
 *  the receipts row that holds only the R2 key and metadata. No Convex storage. */
function useLiveLateApi(period: string | null): LateEntryApi | undefined {
  const convex = useConvex();
  const access = useQuery(api.ledger.lateEntryAccess, {});
  const suggestions = useQuery(api.ledger.lateEntrySuggestions, period && access?.canAdd ? { period } : "skip");
  const add = useMutation(api.ledger.addLateEntry);
  const reverse = useMutation(api.ledger.reverseLateEntry);
  const attach = useMutation(api.receipts.attach);
  const uploadToR2 = useR2Upload();
  return React.useMemo(() => {
    if (!access) return undefined;
    const toArgs = (input: LateFormInput) => ({ ...input, accountId: input.accountId as Id<"ledgerAccounts"> });
    return {
      canAdd: access.canAdd,
      now: access.today,
      preview: (p, input) => convex.query(api.ledger.lateEntryPreview, { period: p, input: toArgs(input) }),
      submit: async (p, input, opts) => {
        let receiptId = opts.receiptId as Id<"receipts"> | undefined;
        if (opts.file) {
          let mediaId: Id<"mediaFiles">;
          try {
            mediaId = await uploadToR2(opts.file, "receipt");
          } catch (err) {
            if (r2NotConfigured(err)) throw new Error("Receipt storage is not set up for this studio yet. Add the item without the receipt and attach it later.");
            throw err;
          }
          const out = await attach({ storageId: mediaId, fileName: opts.file.name });
          if (!out.ok) throw new Error(out.message);
          receiptId = out.receiptId;
        }
        const res = await add({
          period: p,
          input: toArgs(input),
          confirmPastMonth: true,
          ...(opts.allowDuplicate ? { allowDuplicate: true } : {}),
          ...(receiptId ? { receiptId } : {}),
          ...(opts.proposalId ? { proposalId: opts.proposalId as Id<"opsActions"> } : {}),
        });
        return { before: res.before, after: res.after };
      },
      reversePreview: (id) => convex.query(api.ledger.lateReversalPreview, { id: id as Id<"journalEntries"> }),
      reverse: async (id, reason) => {
        const res = await reverse({ id: id as Id<"journalEntries">, reason, confirmPastMonth: true });
        return { before: res.before, after: res.after };
      },
      suggestions: (suggestions ?? []).map((s) => ({ ...s, _id: String(s._id), payload: { ...s.payload, ...(s.payload.receiptId ? { receiptId: String(s.payload.receiptId) } : {}) } })) as LateSuggestion[],
    } satisfies LateEntryApi;
  }, [access, suggestions, convex, add, reverse, attach, uploadToR2]);
}

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

  const late = useLiveLateApi(period);

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
      late={late}
    />
  );
}
