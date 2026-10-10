/* The Books screen's contract for late entries (openspec/changes/late-entries).
   The live page fills it from the ledger API; the dev preview fills it from
   the same pure engine run on the fixture. Every figure is the engine's. */

import type { HeadlineFigures } from "@convex/lib/statements";
import type { LateEntryKind, PaidFrom } from "@convex/lib/lateEntries";

export type LateFormInput = {
  kind: LateEntryKind;
  entryDate: number;
  counterparty: string;
  amountCents: number;
  accountId: string;
  paidFrom: PaidFrom;
  memo?: string;
  reason?: string;
};

export type LateDuplicate = { id: string; entryDate: number; memo: string; totalCents: number; why: string };

export type LatePreviewResult =
  | {
      ok: true;
      memo: string;
      reason: string;
      totalCents: number;
      lines: { accountName: string; debitCents: number; creditCents: number }[];
      before: HeadlineFigures;
      after: HeadlineFigures;
      hasReported: boolean;
      duplicates: LateDuplicate[];
    }
  | { ok: false; error: string };

export type LateReversalPreview =
  | { ok: true; memo: string; totalCents: number; before: HeadlineFigures; after: HeadlineFigures }
  | { ok: false; error: string };

export type LateSuggestion = {
  _id: string;
  title: string;
  rationale: string;
  payload: {
    lateKind: LateEntryKind;
    entryDate: number;
    counterparty: string;
    amountCents: number;
    accountKey?: string;
    paidFrom?: PaidFrom;
    memo?: string;
    reason: string;
    receiptId?: string;
  };
};

export type LateEntryApi = {
  /** The viewer may change a past month (studio owner, agency owner or admin). */
  canAdd: boolean;
  /** Now, for which months count as ended and the latest date allowed. */
  now: number;
  preview: (period: string, input: LateFormInput) => Promise<LatePreviewResult>;
  submit: (
    period: string,
    input: LateFormInput,
    opts: { file: File | null; receiptId?: string; allowDuplicate: boolean; proposalId?: string },
  ) => Promise<{ before: HeadlineFigures; after: HeadlineFigures }>;
  reversePreview: (id: string) => Promise<LateReversalPreview>;
  reverse: (id: string, reason: string) => Promise<{ before: HeadlineFigures; after: HeadlineFigures }>;
  /** Open Accounting agent suggestions for the period. */
  suggestions: LateSuggestion[];
};

/** "19", "19.00", "$1,234.5" to integer cents. null when it is not a
 *  positive amount with at most two decimals. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/** "2026-07-24" to UTC midnight ms; null when not a date. */
export function parseDayInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(ms);
  return back.getUTCDate() === Number(m[3]) && back.getUTCMonth() === Number(m[2]) - 1 ? ms : null;
}

export function dayInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The date the form starts on: the last day of the month, or today when the
 *  month is still running (it never is for a late entry, but be safe). */
export function defaultLateDay(period: { start: number; end: number }, now: number): number {
  const last = period.end - 86_400_000;
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  return Math.max(period.start, Math.min(last, today));
}
