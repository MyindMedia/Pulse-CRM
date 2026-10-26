/** Integer cents in a statement's own currency. */
export function amount(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** "$1,204.10 + €12.00": every currency a total carries. */
export function amounts(totals: { currency: string; cents: number }[]): string {
  if (totals.length === 0) return amount(0);
  return totals.map((t) => amount(t.cents, t.currency)).join(" + ");
}

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Jul 2026 to Sep 2026", or one month, or a dash. */
export function period(start: number | null, end: number | null): string {
  if (!start) return "No period in file";
  const a = MONTH.format(start);
  const b = end ? MONTH.format(end) : a;
  return a === b ? a : `${a} to ${b}`;
}

export const SOURCE_LABEL: Record<string, string> = {
  distrokid: "DistroKid",
  tunecore: "TuneCore",
  cdbaby: "CD Baby",
  mapped: "Other (mapped)",
};
