/* ============================================================
   Digest schedule decision - pure + unit-tested (no ctx, no db).

   The daily-digest sweep rides automation.tick's ~15-minute cadence.
   Each tick asks: "is this org's digest due right now?" The answer
   honors agentPolicies.digestHourLocal (the hour the owner picked in
   the Agent settings UI) instead of the old drifting ~20h cadence.

   TIMEZONE: the caller (agent._maybeStartDigest) passes the studio's
   offset from orgs.timezone, so the hour is the studio's own. A studio
   with no zone on file passes no offset and the hour is read against UTC.
   ============================================================ */

export const DIGEST_MIN_GAP_MS = 20 * 60 * 60 * 1000; // 20h: one digest per day, tolerant of tick jitter

export type DigestScheduleInput = {
  /** Current time, epoch ms. */
  now: number;
  /** agentPolicies.digestHourLocal (0-23). Out-of-range values are wrapped mod 24. */
  digestHourLocal: number;
  /** Epoch ms of the last digest start, if any. */
  lastDigestAt?: number;
  /** Org-local offset from UTC in minutes (from the studio's time zone). */
  utcOffsetMinutes?: number;
  /** Minimum gap between digests. Defaults to 20h. */
  minGapMs?: number;
};

/** Normalize an hour setting to 0-23 (wraps, floors, tolerates junk). */
export function normalizeDigestHour(hour: number): number {
  if (!Number.isFinite(hour)) return 8; // the DEFAULT_POLICY morning brief hour
  const h = Math.floor(hour) % 24;
  return h < 0 ? h + 24 : h;
}

/** The org-local hour (0-23) for a timestamp. UTC unless an offset is given. */
export function orgLocalHour(now: number, utcOffsetMinutes = 0): number {
  return new Date(now + utcOffsetMinutes * 60_000).getUTCHours();
}

/**
 * Should the digest run fire on this tick? True only when BOTH:
 *  1. the org-local hour matches the configured digestHourLocal, and
 *  2. the last digest is at least `minGapMs` (20h) old - so the ~4 ticks
 *     inside the configured hour produce exactly one run per day.
 * Pure so it's directly unit-testable.
 */
export function isDigestDue({
  now,
  digestHourLocal,
  lastDigestAt,
  utcOffsetMinutes = 0,
  minGapMs = DIGEST_MIN_GAP_MS,
}: DigestScheduleInput): boolean {
  if (orgLocalHour(now, utcOffsetMinutes) !== normalizeDigestHour(digestHourLocal)) return false;
  if (lastDigestAt !== undefined && now - lastDigestAt < minGapMs) return false;
  return true;
}
