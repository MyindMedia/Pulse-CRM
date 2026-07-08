/* Pure pay-period math for the Payroll page. A studio is paid either monthly
   (calendar months) or biweekly (14-day windows aligned to an anchor date).
   Boundaries are computed in the caller's local timezone, matching how the
   rest of the finance UI frames "this month". Biweekly windows are plain
   14 x 24h spans, so a DST change shifts a boundary by an hour - fine for
   reporting, and it keeps the math dependency-free. */

export type PaySchedule = "monthly" | "biweekly";

export type PayPeriod = { start: number; end: number; label: string };

const DAY_MS = 86_400_000;
const PERIOD_MS = 14 * DAY_MS;

/** Local-midnight timestamp for a YYYY-MM-DD string; today when unset/invalid. */
export function anchorToLocalMidnight(anchorDate: string | null | undefined, now: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorDate ?? "");
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/** Most recent Monday (local), as YYYY-MM-DD - the default biweekly anchor. */
export function defaultAnchorDate(now: Date): string {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const mm = String(monday.getMonth() + 1).padStart(2, "0");
  const dd = String(monday.getDate()).padStart(2, "0");
  return `${monday.getFullYear()}-${mm}-${dd}`;
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The pay period containing `now`, shifted by `offset` whole periods. */
export function payPeriodFor(
  schedule: PaySchedule,
  anchorDate: string | null | undefined,
  now: Date = new Date(),
  offset = 0,
): PayPeriod {
  if (schedule === "monthly") {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1).getTime();
    return {
      start,
      end,
      label: new Date(start).toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  }
  const anchor = anchorToLocalMidnight(anchorDate, now);
  const idx = Math.floor((now.getTime() - anchor) / PERIOD_MS) + offset;
  const start = anchor + idx * PERIOD_MS;
  const end = start + PERIOD_MS;
  return { start, end, label: `${fmtDay(start)} to ${fmtDay(end - 1)}` };
}
