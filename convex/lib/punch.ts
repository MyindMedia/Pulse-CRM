/* When a clock punch actually happened.
 *
 * The phone queues clock-ins as intents, so one made in a live room with no
 * signal reaches the server whenever the signal comes back. Stamping it with
 * the server's clock at that moment writes a shift nobody worked onto
 * somebody's pay - the device sends the moment the button was pressed instead.
 *
 * A client timestamp is still a client timestamp, so it is clamped:
 *
 *  - Never in the future. A phone with a wrong clock must not be able to open a
 *    shift that has not started, or park one in next week where no payroll run
 *    will ever pick it up.
 *  - Never more than 18 hours back. Past the longest plausible session, short of
 *    yesterday. A punch older than that is not a delayed send, it is stale
 *    debris, and the device quarantines those rather than sending them.
 *
 * Outside the window the server's own clock wins, which is exactly the
 * behaviour that shipped before any of this existed.
 */
export const MAX_BACKDATE_MS = 18 * 3_600_000;

export function punchedAt(at: number | undefined, now: number): number {
  if (at === undefined || !Number.isFinite(at)) return now;
  if (at > now) return now;
  if (at < now - MAX_BACKDATE_MS) return now;
  return at;
}
