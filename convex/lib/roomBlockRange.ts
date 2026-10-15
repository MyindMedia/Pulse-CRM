/* Date math for room blocks, all in the STUDIO's timezone.

   A block is a whole-local-day range:
   - day:   startDate .. endDate inclusive, whole local days
   - week:  the Sunday-anchored weeks containing startDate .. endDate
   - month: the calendar months containing startDate .. endDate
   Dates come in as "YYYY-MM-DD" (the studio's local calendar date), so the
   client's own browser zone never changes what gets blocked. */

const HOUR = 3_600_000;

export type BlockGranularity = "day" | "week" | "month";

function parseYmd(s: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) throw new Error(`Bad date "${s}", expected YYYY-MM-DD`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new Error(`Bad date "${s}"`);
  }
  return { y, m, d };
}

/** Offset (ms) of `tz` from UTC at instant `ts`. */
function tzOffsetMs(ts: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** The instant of local midnight at the start of y-m-d (m is 1-based) in tz.
 *  Day overflow is normalized by Date.UTC, so d=32 means "next month's 1st". */
export function localMidnight(y: number, m: number, d: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - tzOffsetMs(naive, tz);
  // One refinement handles the DST edge when the offset differs at the guess.
  guess = naive - tzOffsetMs(guess, tz);
  return guess;
}

/** Resolve a block's [startTime, endTime) from its granularity and dates. */
export function blockRange(
  granularity: BlockGranularity,
  startDate: string,
  endDate: string,
  tz: string,
): { startTime: number; endTime: number } {
  const s = parseYmd(startDate);
  const e = parseYmd(endDate);
  if (Date.UTC(e.y, e.m - 1, e.d) < Date.UTC(s.y, s.m - 1, s.d)) {
    throw new Error("The end date is before the start date.");
  }
  if (granularity === "day") {
    return {
      startTime: localMidnight(s.y, s.m, s.d, tz),
      endTime: localMidnight(e.y, e.m, e.d + 1, tz),
    };
  }
  if (granularity === "week") {
    const sDow = new Date(Date.UTC(s.y, s.m - 1, s.d)).getUTCDay();
    const eDow = new Date(Date.UTC(e.y, e.m - 1, e.d)).getUTCDay();
    return {
      startTime: localMidnight(s.y, s.m, s.d - sDow, tz),
      endTime: localMidnight(e.y, e.m, e.d - eDow + 7, tz),
    };
  }
  return {
    startTime: localMidnight(s.y, s.m, 1, tz),
    endTime: localMidnight(e.y, e.m + 1, 1, tz),
  };
}

/** Bookable hours in a range. Studios have no stored open hours, so a block
 *  is valued on every elapsed hour (24 per local day, 23 or 25 across DST). */
export function blockHours(startTime: number, endTime: number): number {
  return Math.max(0, (endTime - startTime) / HOUR);
}

export function blockValueCents(hourlyRateCents: number, startTime: number, endTime: number): number {
  return Math.round(blockHours(startTime, endTime) * hourlyRateCents);
}
