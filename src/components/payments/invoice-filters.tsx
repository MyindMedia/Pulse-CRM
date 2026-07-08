"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InvoiceFilters, InvoicePeriod } from "@/lib/invoice-filter";

/**
 * The Payments toolbar: free-text search (invoice number, client, session,
 * line items), a category select derived from the live rows, and an
 * issued-date period select with a custom from/to range. Pure controlled
 * component - filtering itself lives in src/lib/invoice-filter.ts.
 */
export function InvoiceFiltersBar({
  value,
  onChange,
  categories,
}: {
  value: InvoiceFilters;
  onChange: (next: InvoiceFilters) => void;
  categories: string[];
}) {
  const set = (patch: Partial<InvoiceFilters>) => onChange({ ...value, ...patch });

  // <input type="date"> works in local YYYY-MM-DD; convert to day-aligned ms.
  const toDateInput = (ms: number | null | undefined) => {
    if (!ms) return "";
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const fromDateInput = (v: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="relative w-full sm:w-80">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel/70" />
        <Input
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
          placeholder="Search invoice #, client, session, line item…"
          className="pl-9 pr-9"
          aria-label="Search invoices"
        />
        {value.search && (
          <button
            type="button"
            onClick={() => set({ search: "" })}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded-sm text-steel/70 transition-colors hover:bg-coal-3 hover:text-bone"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="w-[11.5rem]">
        <Select value={value.category} onValueChange={(v) => set({ category: v })}>
          <SelectTrigger aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-[10.5rem]">
        <Select
          value={value.period}
          onValueChange={(v) => set({ period: v as InvoicePeriod })}
        >
          <SelectTrigger aria-label="Filter by period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="last_month">Last month</SelectItem>
            <SelectItem value="quarter">This quarter</SelectItem>
            <SelectItem value="year">This year</SelectItem>
            <SelectItem value="custom">Custom range…</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.period === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={toDateInput(value.fromMs)}
            onChange={(e) => set({ fromMs: fromDateInput(e.target.value) })}
            aria-label="From date"
            className="w-[9.5rem]"
          />
          <span className="text-xs text-steel/70">to</span>
          <Input
            type="date"
            value={toDateInput(value.toMs ? value.toMs - 86_400_000 : null)}
            onChange={(e) => {
              const start = fromDateInput(e.target.value);
              // Store the EXCLUSIVE end (start of the next day) so the picked
              // day is fully included.
              set({ toMs: start === null ? null : start + 86_400_000 });
            }}
            aria-label="To date"
            className="w-[9.5rem]"
          />
        </div>
      )}
    </div>
  );
}
