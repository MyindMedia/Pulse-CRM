/* Per-studio timezone helpers. Convex functions run in UTC, so every
   human-facing time string composed server-side (device alerts, reminder
   emails, SMS) must format in the STUDIO's timezone - stored on the org
   (auto-set from a staff device's location, adjustable in Settings). */

export const DEFAULT_TZ = "America/New_York";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The timezone to format with for an org row (or null while unknown). */
export function orgTz(org: { timezone?: string } | null | undefined): string {
  if (org?.timezone && isValidTimezone(org.timezone)) return org.timezone;
  const env = process.env.STUDIO_TZ;
  if (env && isValidTimezone(env)) return env;
  return DEFAULT_TZ;
}

/** Minutes the zone is ahead of UTC at that moment (DST-aware). New York in
 *  winter is -300. */
export function utcOffsetMinutes(ts: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(ts);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(ts / 60_000) * 60_000) / 60_000);
}

/** The instant a calendar day starts (00:00) in the zone. `month` is 0-based,
 *  like Date. Checked twice so a day that starts near a DST change lands on
 *  the zone's real midnight. */
export function zonedMidnight(year: number, month: number, day: number, tz: string): number {
  const asUtc = Date.UTC(year, month, day);
  const first = asUtc - utcOffsetMinutes(asUtc, tz) * 60_000;
  return asUtc - utcOffsetMinutes(first, tz) * 60_000;
}

/** "2:30 PM" in the studio's zone. */
export function clockTime(ts: number, tz: string): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

/** "Wed, Jul 16, 2:30 PM" in the studio's zone. */
export function whenLabel(ts: number, tz: string): string {
  return new Date(ts).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

/** "Wed, Jul 16" in the studio's zone. */
export function dateLabel(ts: number, tz: string): string {
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: tz,
  });
}


/**
 * "YYYY-MM-DD" for a moment, in a studio's OWN timezone.
 *
 * Bucketing by UTC looks harmless until you remember that a session at 8pm
 * Pacific is 4am UTC the next day. Anything that asks "which days is this
 * studio busy" has to ask in the studio's local time, or a fully booked
 * Saturday reads as free and an artist gets sent to a room that is not there.
 */
export function localDayKey(ts: number, tz: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is the shape we want and is stable.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ts));
  } catch {
    // An invalid stored timezone must not take a public page down.
    return new Date(ts).toISOString().slice(0, 10);
  }
}

/**
 * "today" or "tomorrow" for a start time inside the next 24 hours, judged on
 * the studio's local calendar, not on the reminder window. A session booked
 * for later today must not be told it is tomorrow.
 */
export function dayWord(ts: number, now: number, tz: string): "today" | "tomorrow" {
  return localDayKey(ts, tz) === localDayKey(now, tz) ? "today" : "tomorrow";
}
