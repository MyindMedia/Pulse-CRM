/* One place that turns integer cents into text. Components receive cents from
   the ledger API and call these helpers; they never do money arithmetic. */

const MINUS = "−"; // true minus sign, aligns with digits in tabular figures

function groupDigits(whole: number): string {
  return whole.toLocaleString("en-US");
}

/** 1305 cents as "1,305.00"; negatives keep a true minus: "−1,127.80". */
export function formatAmount(cents: number): string {
  const sign = cents < 0 ? MINUS : "";
  const abs = Math.abs(cents);
  return `${sign}${groupDigits(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Same with a dollar sign: "$1,305.00", "−$1,127.80". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? MINUS : "";
  return `${sign}$${formatAmount(Math.abs(cents))}`;
}

/** Plain decimal for CSV: "1305.00", "-1127.80". No separators. */
export function formatCsvAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "2026-07" as "July 2026". */
export function periodLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** UTC midnight ms as "Jul 1, 2026". */
export function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** UTC midnight ms as "2026-07-01" (CSV and ids). */
export function isoDayLabel(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** RFC 4180 cell: quote when needed, double the quotes. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
