/* ============================================================
   Free blocks in a room's day, for "fill the gap" deal texts.

   Busy time (sessions, room blocks, Google busy) is merged, sessions are
   padded by the room reset buffer, and what is left inside open hours is
   returned when it is at least `minMs` long. Pure: the cron reads the busy
   intervals and hands them in.
   ============================================================ */

export type Interval = { start: number; end: number };

/** Sessions need this much room reset time around them (roomStatus buffer). */
export const RESET_BUFFER_MS = 15 * 60_000;
/** A gap worth texting about. */
export const MIN_GAP_MS = 3 * 3_600_000;

export function freeBlocks(busy: Interval[], open: Interval, minMs: number = MIN_GAP_MS): Interval[] {
  const clipped = busy
    .map((b) => ({ start: Math.max(b.start, open.start), end: Math.min(b.end, open.end) }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
    else merged.push({ ...b });
  }
  const out: Interval[] = [];
  let cursor = open.start;
  for (const b of merged) {
    if (b.start - cursor >= minMs) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (open.end - cursor >= minMs) out.push({ start: cursor, end: open.end });
  return out;
}

/** Pad session intervals by the reset buffer; blocks and Google stay exact. */
export function padSessions(busy: Array<Interval & { kind: string }>, bufferMs: number = RESET_BUFFER_MS): Interval[] {
  return busy.map((b) => (b.kind === "session" ? { start: b.start - bufferMs, end: b.end + bufferMs } : b));
}

const GOOGLE_REVIEW_HOSTS = ["google.com", "g.page", "goo.gl", "maps.app.goo.gl", "search.google.com", "business.google.com"];

/** The studio's Google review link, cleaned, or an error to show the owner.
 *  Empty input clears the setting. */
export function cleanGoogleReviewUrl(raw: string): { url: string | null } | { error: string } {
  const s = raw.trim();
  if (!s) return { url: null };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "Paste the full link, starting with https://" };
  }
  if (u.protocol !== "https:") return { error: "The link must start with https://" };
  const host = u.hostname.toLowerCase();
  const ok = GOOGLE_REVIEW_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!ok) return { error: "Use the review link from your Google Business Profile (a google.com or g.page link)." };
  return { url: u.toString() };
}
