/* Pure client-side filtering for the Payments page. The invoice list is
   already fully loaded (the page filters + counts client-side so the status
   control can show live numbers), so search/category/period narrowing happens
   here - one tested function, no extra queries. */

export type InvoicePeriod = "all" | "month" | "last_month" | "quarter" | "year" | "custom";

export type InvoiceFilters = {
  /** Free text - every whitespace-separated token must match somewhere. */
  search: string;
  /** A derived category label, or "all". */
  category: string;
  period: InvoicePeriod;
  /** Custom range bounds (ms, already day-aligned by the caller). */
  fromMs?: number | null;
  toMs?: number | null;
};

export type FilterableInvoice = {
  number: string;
  artistName: string;
  sessionTitle?: string | null;
  category: string;
  lineItems: { label: string }[];
  _creationTime: number;
};

export const DEFAULT_INVOICE_FILTERS: InvoiceFilters = {
  search: "",
  category: "all",
  period: "all",
  fromMs: null,
  toMs: null,
};

/** Calendar bounds for a named period (local time), or null for "all". */
export function periodBounds(period: InvoicePeriod, now: Date): { start: number; end: number } | null {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (period === "month") return { start: new Date(y, m, 1).getTime(), end: new Date(y, m + 1, 1).getTime() };
  if (period === "last_month") return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() };
  if (period === "quarter") {
    const q = Math.floor(m / 3) * 3;
    return { start: new Date(y, q, 1).getTime(), end: new Date(y, q + 3, 1).getTime() };
  }
  if (period === "year") return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() };
  return null;
}

function haystack(inv: FilterableInvoice): string {
  return [
    inv.number,
    inv.artistName,
    inv.sessionTitle ?? "",
    inv.category,
    ...inv.lineItems.map((l) => l.label),
  ]
    .join(" ")
    .toLowerCase();
}

/** Apply search + category + period to an invoice list (issue-date based). */
export function filterInvoices<T extends FilterableInvoice>(
  rows: T[],
  f: InvoiceFilters,
  now: Date = new Date(),
): T[] {
  const tokens = f.search.toLowerCase().split(/\s+/).filter(Boolean);

  let start: number | null = null;
  let end: number | null = null;
  if (f.period === "custom") {
    start = f.fromMs ?? null;
    end = f.toMs ?? null;
  } else {
    const b = periodBounds(f.period, now);
    if (b) {
      start = b.start;
      end = b.end;
    }
  }

  return rows.filter((inv) => {
    if (f.category !== "all" && inv.category !== f.category) return false;
    if (start !== null && inv._creationTime < start) return false;
    if (end !== null && inv._creationTime >= end) return false;
    if (tokens.length > 0) {
      const hay = haystack(inv);
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}
