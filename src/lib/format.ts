/** Currency - Pulse stores money as integer cents. */
export function money(cents: number, opts?: { compact?: boolean }) {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: opts?.compact ? "compact" : "standard",
    maximumFractionDigits: opts?.compact ? 1 : dollars % 1 === 0 ? 0 : 2,
  }).format(dollars);
}

export function compactNumber(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function percent(n: number, digits = 0) {
  return `${(n * 100).toFixed(digits)}%`;
}

const DAY = 86_400_000;

/** Human relative time - "2h ago", "in 3d", "just now". */
export function relativeTime(ts: number) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return fmt.format(Math.round(diff / 60_000), "minute");
  if (abs < DAY) return fmt.format(Math.round(diff / 3_600_000), "hour");
  if (abs < DAY * 30) return fmt.format(Math.round(diff / DAY), "day");
  if (abs < DAY * 365) return fmt.format(Math.round(diff / (DAY * 30)), "month");
  return fmt.format(Math.round(diff / (DAY * 365)), "year");
}

export function shortDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function longDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

export function timeOfDay(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Session duration in human form. */
export function duration(startTs: number, endTs: number) {
  const mins = Math.round((endTs - startTs) / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

/** Musical key display, e.g. "F# Minor". */
export function musicalKey(key?: string, mode?: string) {
  if (!key) return "-";
  return `${key}${mode ? ` ${mode}` : ""}`;
}
