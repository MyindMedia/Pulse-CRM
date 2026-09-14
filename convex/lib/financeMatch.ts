/* ============================================================
   Finance matching: which receipt documents which dollar.

   Plain, deterministic scoring a person can check, never a model's
   guess, and never with bank data leaving Pulse. Three kinds of
   thing meet here: a receipt (what the paper says), an expense
   (what the books say) and a bank transaction (what the bank
   says). Any two can be scored.

   Score out of 100:
   - Amount: within a cent = 60. A card charge or expense up to 20%
     and $50 above the receipt = 35, flagged as a possible tip. Any
     other difference is not a candidate.
   - Dates: against a bank line, the bank may post the same day or up
     to a week later (one day earlier is tolerated for time zones):
     0 days = 25, 1 to 3 = 20, 4 to 7 = 10. Receipt against expense:
     either direction, same bands.
   - Vendor: token overlap after stripping store numbers and card
     noise. Close = 15, partial = 8.
   - Card last four on the receipt equals the account's mask = +10.

   A candidate links on its own only when it scores AUTO_THRESHOLD or
   more, beats the runner-up by MARGIN, and is not already matched.
   Anything at SUGGEST_THRESHOLD or more is offered to a person.
   ============================================================ */

export const AUTO_THRESHOLD = 85;
export const SUGGEST_THRESHOLD = 50;
export const MARGIN = 15;

const DAY_MS = 86_400_000;

export type MatchKind = "receipt" | "expense" | "transaction";

export type MatchSide = {
  kind: MatchKind;
  id: string;
  amountCents: number;
  /** UTC midnight of the day it happened. */
  dateMs: number;
  vendor?: string | null;
  /** Receipts: the card digits printed on the slip. */
  last4?: string | null;
  /** Bank transactions only. */
  direction?: "in" | "out";
  /** Bank transactions only: the account's last four digits. */
  accountMask?: string | null;
  /** Already linked to a counterpart of the other kind. */
  matched?: boolean;
};

export type Scored = { score: number; reasons: string[] };
export type Ranked<T extends MatchSide = MatchSide> = Scored & { candidate: T };

const NOISE = new Set([
  "pos", "debit", "credit", "card", "purchase", "checkcard", "check", "sq", "tst", "dd", "sp",
  "inc", "llc", "ltd", "co", "corp", "the", "store", "stores", "online", "payment", "pmt",
  "www", "com", "net", "recurring", "ach", "withdrawal", "visa", "mastercard", "mc", "amex",
  "sale", "transaction", "us", "usa", "ca", "and", "of",
]);

export function vendorTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !/\d/.test(t) && !NOISE.has(t));
}

/** 0..1 overlap of vendor names (Dice coefficient on cleaned tokens). */
export function vendorSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const ta = new Set(vendorTokens(a));
  const tb = new Set(vendorTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  // A short name fully contained in a longer bank descriptor is a strong
  // signal ("Sweetwater" in "SWEETWATER SOUND"), so measure against the
  // smaller side rather than punishing the bank's extra words.
  const containment = shared / Math.min(ta.size, tb.size);
  const dice = (2 * shared) / (ta.size + tb.size);
  return Math.round(Math.max(dice, containment * 0.8) * 100) / 100;
}

export function pairKey(aKind: MatchKind, aId: string, bKind: MatchKind, bId: string): string {
  const a = `${aKind}:${aId}`;
  const b = `${bKind}:${bId}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function dayNumber(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/** Score two items, or null when they cannot be the same spend. */
export function scorePair(a: MatchSide, b: MatchSide): Scored | null {
  if (a.kind === b.kind) return null;
  const bank = a.kind === "transaction" ? a : b.kind === "transaction" ? b : null;
  const other = bank === a ? b : a;
  if (bank && bank.direction !== "out") return null;

  const reasons: string[] = [];
  let score = 0;

  // The "paper" side is the receipt when there is one; the "paid" side is what
  // may carry a tip on top of it.
  const paper = a.kind === "receipt" ? a : b.kind === "receipt" ? b : null;
  const paid = paper ? (paper === a ? b : a) : null;

  const diff = Math.abs(a.amountCents - b.amountCents);
  if (diff <= 1) {
    score += 60;
    reasons.push("amount matches");
  } else if (
    paper && paid &&
    paid.amountCents > paper.amountCents &&
    paid.amountCents - paper.amountCents <= 5000 &&
    paid.amountCents <= Math.round(paper.amountCents * 1.2)
  ) {
    score += 35;
    reasons.push("amount is higher by a possible tip");
  } else {
    return null;
  }

  if (bank) {
    const d = dayNumber(bank.dateMs) - dayNumber(other.dateMs);
    if (d < -1 || d > 7) return null;
    if (d <= 0) { score += 25; reasons.push("same day"); }
    else if (d <= 3) { score += 20; reasons.push(`bank posted ${d} day${d === 1 ? "" : "s"} later`); }
    else { score += 10; reasons.push(`bank posted ${d} days later`); }
  } else {
    const d = Math.abs(dayNumber(a.dateMs) - dayNumber(b.dateMs));
    if (d > 7) return null;
    if (d === 0) { score += 25; reasons.push("same day"); }
    else if (d <= 3) { score += 20; reasons.push(`${d} day${d === 1 ? "" : "s"} apart`); }
    else { score += 10; reasons.push(`${d} days apart`); }
  }

  const sim = vendorSimilarity(a.vendor, b.vendor);
  if (sim >= 0.6) { score += 15; reasons.push("vendor matches"); }
  else if (sim >= 0.3) { score += 8; reasons.push("vendor partly matches"); }

  const last4 = paper?.last4;
  if (bank && last4 && bank.accountMask && last4 === bank.accountMask) {
    score += 10;
    reasons.push(`card ending ${last4}`);
  }

  return { score: Math.min(100, score), reasons };
}

/** Candidates worth showing, best first. Rejected pairs never come back. */
export function rankCandidates<T extends MatchSide>(
  subject: MatchSide,
  candidates: T[],
  rejected: ReadonlySet<string>,
): Ranked<T>[] {
  const out: Ranked<T>[] = [];
  for (const c of candidates) {
    if (rejected.has(pairKey(subject.kind, subject.id, c.kind, c.id))) continue;
    const s = scorePair(subject, c);
    if (s && s.score >= SUGGEST_THRESHOLD) out.push({ ...s, candidate: c });
  }
  return out.sort((x, y) => y.score - x.score);
}

/** The one candidate to link without asking, or null. */
export function autoLinkDecision<T extends MatchSide>(ranked: Ranked<T>[]): Ranked<T> | null {
  const top = ranked[0];
  if (!top || top.score < AUTO_THRESHOLD || top.candidate.matched) return null;
  const next = ranked[1];
  if (next && next.score > top.score - MARGIN) return null;
  return top;
}

/** UTC midnight for a YYYY-MM-DD string, or null when it is not a real date. */
export function dayFromIso(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
}
