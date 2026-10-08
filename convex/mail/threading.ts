/* Threading for inbound mail. Pure helpers; the database lookups live in
   convex/mail.ts (_ingest). Order of evidence:
   1. In-Reply-To, then References newest first, matching a stored message in
      the same mailbox.
   2. Same mailbox, same normalised subject, sender already a participant,
      active in the last 60 days.
   3. A new thread. */

export const SUBJECT_THREAD_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/** "Re: Fwd: RE: [ext] Hello  world" -> "hello world". */
export function normalizeSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").trim();
  for (;;) {
    const next = s.replace(/^(?:(?:re|fw|fwd|aw|sv|tr|antw|wg)(?:\[\d+\])?\s*:\s*|\[[^\]]{1,24}\]\s*)/i, "");
    if (next === s) break;
    s = next.trim();
  }
  return s.replace(/\s+/g, " ").toLowerCase().slice(0, 200);
}

/** Message ids out of a References / In-Reply-To header value. Keeps the angle brackets. */
export function parseMessageIds(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  const joined = Array.isArray(value) ? value.join(" ") : value;
  const ids = joined.match(/<[^<>\s]+>/g) ?? [];
  if (ids.length === 0 && /^[^\s<>]+@[^\s<>]+$/.test(joined.trim())) return [`<${joined.trim()}>`];
  return [...new Set(ids)];
}

/** Ids to look up, most specific first: In-Reply-To, then References newest first. */
export function lookupOrder(inReplyTo: string | undefined, references: string[]): string[] {
  const out: string[] = [];
  if (inReplyTo) out.push(inReplyTo);
  for (const id of [...references].reverse()) if (!out.includes(id)) out.push(id);
  return out.slice(0, 25);
}

export type ThreadCandidate = { id: string; participants: string[]; lastMessageAt: number; status: string };

/** Subject fallback: the most recent thread in the window whose participants include the sender. */
export function chooseBySubject(candidates: ThreadCandidate[], sender: string | null, now: number): string | null {
  if (!sender) return null;
  const hit = candidates
    .filter((c) => now - c.lastMessageAt <= SUBJECT_THREAD_WINDOW_MS && c.participants.includes(sender))
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt)[0];
  return hit?.id ?? null;
}

/** References for an outbound reply: the thread's chain plus the message we answer, latest last, capped. */
export function buildReferences(previous: string[], replyingTo: string | undefined): string[] {
  const chain = [...previous];
  if (replyingTo && !chain.includes(replyingTo)) chain.push(replyingTo);
  return chain.slice(-20);
}

/** "Re: " once, never "Re: Re: ". */
export function replySubject(subject: string): string {
  const s = subject.trim() || "(no subject)";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}
