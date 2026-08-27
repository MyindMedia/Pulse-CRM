/* Pure timezone math for the schedule picker, split out of schedule-picker.tsx
   the same way ghl-message.ts was split out of connect-button.tsx: a plain
   .ts file the suite can import directly, no component rendering required. */

const MINUTE = 60_000;
const FIVE_MINUTES = 5 * MINUTE;

function partsInZone(ts: number, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(ts))
      .map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(parts.hour),
    mm: Number(parts.minute),
    ss: Number(parts.second),
  };
}

/** How far local wall-clock time in `tz` is ahead of UTC, in minutes, at the
 *  instant `utcMs`. Negative west of Greenwich (e.g. -420 for America/
 *  Los_Angeles in summer). */
function offsetMinutesAt(utcMs: number, tz: string): number {
  const p = partsInZone(utcMs, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return (asUtc - utcMs) / MINUTE;
}

/**
 * The UTC instant (ms since epoch) for a wall-clock date + time in an IANA
 * zone, with no library dependency. Two passes: the first samples the zone's
 * offset at a naive guess (the wall-clock numbers read as if they were UTC),
 * the second re-samples at the corrected instant so a DST boundary crossed
 * by the correction itself does not leave the result an hour off.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = offsetMinutesAt(naive, tz);
  let candidate = naive - offset1 * MINUTE;
  const offset2 = offsetMinutesAt(candidate, tz);
  if (offset2 !== offset1) candidate = naive - offset2 * MINUTE;
  return candidate;
}

export type ScheduleSuggestion = { label: string; scheduledFor: number };

const TARGETS: { weekday: number; hour: number; label: string }[] = [
  { weekday: 2, hour: 18, label: "Tue 6:00 PM" },
  { weekday: 4, hour: 18, label: "Thu 6:00 PM" },
  { weekday: 6, hour: 10, label: "Sat 10:00 AM" },
];

/**
 * Next Tue 6pm, next Thu 6pm, next Sat 10am in the studio's own zone - the
 * three windows a studio owner reaches for most. "Next" includes today when
 * today is the target weekday and the slot is still at least five minutes
 * out (the backend's own minimum lead time, convex/marketing/posts.ts
 * validateInput); otherwise it rolls to next week rather than offering a
 * slot create()/update() would immediately reject.
 */
export function scheduleSuggestions(now: number, tz: string): ScheduleSuggestion[] {
  const today = partsInZone(now, tz);
  const todayWeekday = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
  return TARGETS.map(({ weekday, hour, label }) => {
    let deltaDays = (weekday - todayWeekday + 7) % 7;
    let scheduledFor = zonedTimeToUtc(today.y, today.m, today.d + deltaDays, hour, 0, tz);
    if (scheduledFor < now + FIVE_MINUTES) {
      deltaDays += 7;
      scheduledFor = zonedTimeToUtc(today.y, today.m, today.d + deltaDays, hour, 0, tz);
    }
    return { label, scheduledFor };
  });
}

/** "YYYY-MM-DDTHH:mm" for a `<input type="datetime-local">`, rendered in
 *  `tz` rather than the browser's own zone - the studio's schedule should
 *  read the same regardless of which device is editing it. */
export function toDatetimeLocalValue(ts: number, tz: string): string {
  const p = partsInZone(ts, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
}

/** Parse a `<input type="datetime-local">` string ("YYYY-MM-DDTHH:mm") back
 *  into a UTC instant, interpreted in `tz`. Returns null for an incomplete
 *  or malformed value (the input can be blank mid-edit). */
export function fromDatetimeLocalValue(value: string, tz: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match;
  return zonedTimeToUtc(Number(y), Number(m), Number(d), Number(hh), Number(mm), tz);
}
