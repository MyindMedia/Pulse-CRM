"use client";

import * as React from "react";
import { ChevronDown, SearchLg } from "@untitledui/icons";
import { PAYMENT_KINDS } from "@convex/lib/booksImport";
import { cn } from "@/lib/utils";
import { dayLabel, formatAmount } from "@/lib/books/money";
import { categoryOf, receiptWord } from "@/lib/books/export";
import type { AccountRow, JournalEntryRow } from "@/lib/books/types";
import type { JournalFilter } from "@/lib/books/view";
import { Badge } from "@/components/ui/badge";
import { Money, ReceiptBadge } from "./primitives";

const PAYMENT_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer",
  bank_charge: "Bank charge",
  credit_card: "Credit card",
  owner_personal_funds: "Owner personal funds",
  zelle: "Zelle",
  cashapp_or_cash: "CashApp or cash",
  cash: "Cash",
  apple_pay: "Apple Pay",
  non_cash_adjustment: "Non-cash adjustment",
  other: "Other",
};

const SELECT =
  "h-9 rounded-md border border-graphite/70 bg-coal px-2.5 text-sm text-bone focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none";

/** The journal, one row per transaction, its two lines expandable. The totals
 *  row is the posted total for the month from the ledger, not a sum of rows
 *  on screen, so it does not change with the filters. */
export function JournalPanel({
  entries,
  accounts,
  totals,
  filter,
  onFilterChange,
  hasMore,
  onLoadMore,
  loadingMore,
  focusEntryId,
  onReverse,
}: {
  entries: JournalEntryRow[] | undefined;
  accounts: AccountRow[] | undefined;
  totals: { entryCount: number; debitCents: number; creditCents: number } | undefined;
  filter: JournalFilter;
  onFilterChange: (f: JournalFilter) => void;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  focusEntryId?: string | null;
  /** Offered on a late entry not yet reversed, when the viewer may. */
  onReverse?: (e: JournalEntryRow) => void;
}) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const byId = React.useMemo(() => new Map((accounts ?? []).map((a) => [a._id, a])), [accounts]);
  const accountName = (id: string) => byId.get(id)?.name ?? id;
  const hasFilter = Boolean(filter.text || filter.accountId || filter.paymentKind || filter.receiptStatus);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <form
        role="search"
        aria-label="Filter journal"
        onSubmit={(e) => e.preventDefault()}
        className="books-no-print grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]"
      >
        <label className="relative block">
          <span className="sr-only">Search description, memo or payment type</span>
          <SearchLg className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" aria-hidden />
          <input
            type="search"
            value={filter.text ?? ""}
            onChange={(e) => onFilterChange({ ...filter, text: e.target.value })}
            placeholder="Search description or payment"
            className="h-9 w-full rounded-md border border-graphite/70 bg-coal pl-8 pr-2.5 text-sm text-bone placeholder:text-steel focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
          />
        </label>
        <label className="block">
          <span className="sr-only">Account</span>
          <select
            className={cn(SELECT, "w-full")}
            value={filter.accountId ?? ""}
            onChange={(e) => onFilterChange({ ...filter, accountId: e.target.value || undefined })}
          >
            <option value="">All accounts</option>
            {(accounts ?? []).map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Payment type</span>
          <select
            className={cn(SELECT, "w-full")}
            value={filter.paymentKind ?? ""}
            onChange={(e) => onFilterChange({ ...filter, paymentKind: e.target.value || undefined })}
          >
            <option value="">All payment types</option>
            {PAYMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {PAYMENT_LABEL[k] ?? k}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Receipt</span>
          <select
            className={cn(SELECT, "w-full")}
            value={filter.receiptStatus ?? ""}
            onChange={(e) =>
              onFilterChange({ ...filter, receiptStatus: (e.target.value || undefined) as JournalFilter["receiptStatus"] })
            }
          >
            <option value="">Any receipt</option>
            <option value="yes">Receipt: Yes</option>
            <option value="no">Receipt: No</option>
            <option value="pending">Receipt: Pending</option>
          </select>
        </label>
      </form>

      {entries === undefined ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading journal">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-coal-3/70 motion-reduce:animate-none" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-graphite/70 p-8 text-center">
          <p className="font-medium text-bone">{hasFilter ? "No entries match these filters." : "No journal entries this month."}</p>
          {hasFilter && (
            <button
              type="button"
              onClick={() => onFilterChange({})}
              className="mt-3 text-sm text-gold-bright underline underline-offset-4"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="books-scroll relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
            <caption className="sr-only">Journal entries for the month, newest first</caption>
            <thead className="books-table-head">
              <tr className="text-left text-xs text-steel">
                <th scope="col" className="w-8 py-2" aria-label="Expand" />
                <th scope="col" className="py-2 pr-3 font-medium">Date</th>
                <th scope="col" className="books-sticky sticky left-0 z-[1] bg-coal py-2 pr-3 font-medium">Description</th>
                <th scope="col" className="py-2 pr-3 font-medium">Account</th>
                <th scope="col" className="py-2 pr-3 font-medium">Category</th>
                <th scope="col" className="py-2 pr-3 font-medium">Payment type</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Debit</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Credit</th>
                <th scope="col" className="py-2 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const isOpen = open.has(e._id);
                const first = e.lines[0];
                const debitLine = e.lines.find((l) => l.debitCents > 0);
                const creditLine = e.lines.find((l) => l.creditCents > 0);
                const category = categoryOf(debitLine ? byId.get(debitLine.accountId) : undefined);
                return (
                  <React.Fragment key={e._id}>
                    <tr
                      id={`books-entry-${e._id}`}
                      className={cn("books-avoid-break align-top", focusEntryId === e._id && "bg-gold/10")}
                    >
                      <td className="border-b border-graphite/40 py-2 pr-1">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={`books-lines-${e._id}`}
                          aria-label={`${isOpen ? "Hide" : "Show"} lines for ${e.memo}`}
                          onClick={() => toggle(e._id)}
                          className="books-no-print grid size-7 place-items-center rounded-md text-steel hover:bg-coal-3 hover:text-bone focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:outline-none"
                        >
                          <ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", isOpen && "rotate-180")} aria-hidden />
                        </button>
                      </td>
                      <td className="whitespace-nowrap border-b border-graphite/40 py-2 pr-3 text-bone/90">
                        {dayLabel(e.entryDate)}
                      </td>
                      <td className="books-sticky sticky left-0 z-[1] min-w-[14rem] max-w-[20rem] border-b border-graphite/40 bg-coal py-2 pr-3 text-bone">
                        {e.memo}
                        {e.lateEntry && (
                          <Badge tone={e.reversalOf || e.reversedBy ? "neutral" : "info"} className="ml-1.5 align-middle text-[0.625rem]" data-testid="late-marker">
                            {e.reversalOf ? "late reversal" : e.reversedBy ? "late, reversed" : "late"}
                          </Badge>
                        )}
                      </td>
                      <td className="border-b border-graphite/40 py-2 pr-3 text-bone/90">
                        <span className="block">{debitLine ? accountName(debitLine.accountId) : accountName(first.accountId)}</span>
                        {creditLine && <span className="block text-xs text-steel">to {accountName(creditLine.accountId)}</span>}
                      </td>
                      <td className="border-b border-graphite/40 py-2 pr-3 text-steel">{category}</td>
                      <td className="border-b border-graphite/40 py-2 pr-3 text-steel">
                        {e.paymentType?.raw ?? PAYMENT_LABEL[e.paymentType?.kind ?? ""] ?? e.paymentType?.kind ?? ""}
                      </td>
                      <td className="border-b border-graphite/40 py-2 pr-3 text-right">
                        <Money cents={e.totalCents} />
                      </td>
                      <td className="border-b border-graphite/40 py-2 pr-3" />
                      <td className="border-b border-graphite/40 py-2">
                        <ReceiptBadge status={e.receiptStatus} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr id={`books-lines-${e._id}`} className="books-expand-row bg-coal-3/30">
                        <td />
                        <td colSpan={8} className="pb-3 pt-1">
                          <table className="w-full text-xs">
                            <caption className="sr-only">Lines for {e.memo}</caption>
                            <thead>
                              <tr className="text-left text-steel">
                                <th scope="col" className="py-1 font-medium">Account</th>
                                <th scope="col" className="py-1 font-medium">Line memo</th>
                                <th scope="col" className="py-1 text-right font-medium">Debit</th>
                                <th scope="col" className="py-1 text-right font-medium">Credit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {e.lines.map((l, i) => (
                                <tr key={`${e._id}-${i}`}>
                                  <td className="py-1 text-bone/90">{accountName(l.accountId)}</td>
                                  <td className="py-1 text-steel">{l.memo ?? ""}</td>
                                  <td className="py-1 text-right">{l.debitCents ? formatAmount(l.debitCents) : ""}</td>
                                  <td className="py-1 text-right">{l.creditCents ? formatAmount(l.creditCents) : ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-1.5 text-xs text-steel">
                            Receipt: {receiptWord(e.receiptStatus)}
                            {e.status !== "posted" ? ` · ${e.status}` : ""}
                          </p>
                          {e.lateEntry && (
                            <p className="mt-1 text-xs text-steel">
                              {e.reversalOf ? "Reverses a late entry. " : "Late entry. "}
                              Entered {e.enteredAt ? dayLabel(e.enteredAt) : ""}{e.enteredBy ? ` by ${e.enteredBy}` : ""}. Reason: {e.reason ?? ""}
                              {onReverse && !e.reversalOf && !e.reversedBy && e.status === "posted" && (
                                <button
                                  type="button"
                                  onClick={() => onReverse(e)}
                                  className="books-no-print ml-2 rounded-md border border-graphite/70 px-2 py-0.5 text-xs text-bone hover:bg-coal-3"
                                >
                                  Reverse
                                </button>
                              )}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-semibold text-bone">
                <th scope="row" colSpan={6} className="pt-3 text-left font-semibold">
                  Posted total for the month
                  {totals && <span className="ml-2 text-xs font-normal text-steel">{totals.entryCount} entries</span>}
                </th>
                <td className="pt-3 text-right">{totals ? <Money cents={totals.debitCents} /> : ""}</td>
                <td className="pt-3 text-right">{totals ? <Money cents={totals.creditCents} /> : ""}</td>
                <td className="pt-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-steel">
        <p>
          Showing {entries?.length ?? 0} entries{hasFilter ? " that match your filters" : ""}. The total is for the whole
          month and does not change with filters.
        </p>
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="books-no-print inline-flex h-9 items-center rounded-md border border-graphite/70 px-3 text-sm text-bone hover:bg-coal-3 disabled:opacity-60"
          >
            {loadingMore ? "Loading" : "Load more"}
          </button>
        )}
      </div>
    </div>
  );
}
