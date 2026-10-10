/* ============================================================
   Late entries: a missed invoice or receipt added to a past month.

   Pure, no Convex imports, so the server, the dev preview and the
   tests build exactly the same lines and the same before/after.

   A late entry is an ordinary balanced journal entry dated inside
   the old month, flagged with when it was really entered, by whom
   and why. It never edits what the owner's workbook reported: the
   reported statements stay as they were checked and the variance
   panel explains the difference. A mistake is cancelled by a
   reversing entry on the same date, never deleted.

   openspec/changes/late-entries
   ============================================================ */

import {
  type EntryLine,
  type LateEntryKind,
  type LedgerAccount,
  type LedgerEntry,
  type OpeningBalances,
  type Period,
  DAY_MS,
  LedgerValidationError,
  assertBalancedLines,
  entryTotalCents,
  isCents,
  parsePeriod,
  toDay,
} from "./ledgerMath";
import { headlineFigures, recomputeStatements, type HeadlineFigures } from "./statements";

export type { LateEntryKind } from "./ledgerMath";

export const LATE_KINDS: readonly { id: LateEntryKind; label: string }[] = [
  { id: "expense", label: "Expense" },
  { id: "income", label: "Income" },
  { id: "refund", label: "Refund" },
];

export type PaidFrom = "bank" | "cash" | "card" | "owner" | "unpaid";

export const PAID_FROM: readonly PaidFrom[] = ["bank", "cash", "card", "owner", "unpaid"];

/** Words for the form, by which way the money moved. */
export const PAID_FROM_LABEL: Readonly<Record<"in" | "out", Record<PaidFrom, string>>> = {
  out: { bank: "Bank account", cash: "Cash", card: "Credit card", owner: "Owner paid personally", unpaid: "Not paid yet (owed)" },
  in: { bank: "Bank account", cash: "Cash", card: "Back onto the credit card", owner: "Owner received it", unpaid: "Not received yet (owed to us)" },
};

export const DEFAULT_LATE_REASON = "Missed invoice/receipt";

/** Upper bound on one late entry: $100 million. A typo guard, not a policy. */
export const MAX_LATE_CENTS = 10_000_000_000;

/** The account each paid-from choice posts against, by chart key, the way the
 *  studio's own workbook records it: cash and bank share Bank / Cash, a card
 *  is a liability until paid (accrual), owner money is a contribution going
 *  out and funds held by the owner coming in, and "not paid yet" is a payable
 *  or a receivable. */
const SOURCE_KEY: Readonly<Record<"in" | "out", Record<PaidFrom, string>>> = {
  out: { bank: "bank_cash", cash: "bank_cash", card: "credit_card_payable", owner: "owner_equity_capital", unpaid: "accounts_payable" },
  in: { bank: "bank_cash", cash: "bank_cash", card: "credit_card_payable", owner: "business_funds_held_by_owner", unpaid: "accounts_receivable" },
};

const PAYMENT: Readonly<Record<PaidFrom, { kind: string; raw: string } | null>> = {
  bank: { kind: "bank_transfer", raw: "Bank Transfer" },
  cash: { kind: "cash", raw: "Cash" },
  card: { kind: "credit_card", raw: "Credit Card" },
  owner: { kind: "owner_personal_funds", raw: "Owner Personal Funds" },
  unpaid: null,
};

export type LateEntryInput = {
  kind: LateEntryKind;
  /** Any time on the day; snapped to UTC midnight. */
  entryDate: number;
  /** Vendor (expense, refund from a vendor) or customer (income, refund to a customer). */
  counterparty: string;
  amountCents: number;
  /** The category: an expense or revenue account. */
  accountId: string;
  paidFrom: PaidFrom;
  memo?: string;
  reason?: string;
};

export type LateAccount = Pick<LedgerAccount, "id" | "key" | "name" | "type"> & { active?: boolean };

/** Which way the money moved. A refund follows its category: refunding a
 *  customer (a revenue account) is money out, a vendor refunding us (an
 *  expense account) is money in. */
export function moneyDirection(kind: LateEntryKind, category: Pick<LedgerAccount, "type">): "in" | "out" {
  if (kind === "expense") return "out";
  if (kind === "income") return "in";
  return category.type === "revenue" ? "out" : "in";
}

/** May this account be the category for this kind? */
export function categoryAllowed(kind: LateEntryKind, account: Pick<LedgerAccount, "type">): boolean {
  if (kind === "expense") return account.type === "expense";
  if (kind === "income") return account.type === "revenue";
  return account.type === "revenue" || account.type === "expense";
}

/** The category accounts the form offers for a kind, in chart order. */
export function categoryOptions<A extends LateAccount & { sortOrder?: number }>(kind: LateEntryKind, accounts: readonly A[]): A[] {
  return accounts
    .filter((a) => a.active !== false && categoryAllowed(kind, a))
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
}

/** The paid-from choices that make sense for a kind and category. Income
 *  never lands on a credit card; everything else is allowed. */
export function paidFromOptions(kind: LateEntryKind): PaidFrom[] {
  return kind === "income" ? PAID_FROM.filter((p) => p !== "card") : [...PAID_FROM];
}

/** "Paid from" for money out, "Received into" for money in. */
export function paidFromHeading(kind: LateEntryKind, category: Pick<LedgerAccount, "type"> | null): string {
  const dir = category ? moneyDirection(kind, category) : kind === "income" ? "in" : "out";
  return dir === "in" ? "Received into" : "Paid from";
}

export function lateMemo(input: Pick<LateEntryInput, "counterparty" | "memo">): string {
  const who = input.counterparty.trim().replace(/\s+/g, " ");
  const what = (input.memo ?? "").trim().replace(/\s+/g, " ");
  return what ? `${who} - ${what}` : who;
}

export type LatePlan = {
  direction: "in" | "out";
  memo: string;
  lines: (EntryLine & { accountId: string })[];
  totalCents: number;
  paymentType?: { kind: string; raw: string };
  category: LateAccount;
  source: LateAccount;
  reason: string;
};

/** Validate the form and build the balanced lines. Throws a
 *  LedgerValidationError with words a person can act on. */
export function planLateEntry(input: LateEntryInput, accounts: readonly LateAccount[]): LatePlan {
  const counterparty = input.counterparty.trim();
  if (!counterparty) throw new LedgerValidationError(input.kind === "income" ? "Who paid? Add the customer." : "Who was it? Add the vendor or customer.");
  if (counterparty.length > 120) throw new LedgerValidationError("Keep the vendor or customer name under 120 characters.");
  if ((input.memo ?? "").length > 300) throw new LedgerValidationError("Keep the memo under 300 characters.");
  if (!isCents(input.amountCents) || input.amountCents <= 0) throw new LedgerValidationError("Enter an amount greater than zero.");
  if (input.amountCents > MAX_LATE_CENTS) throw new LedgerValidationError("That amount is too large for one entry. Check the number.");
  if (!LATE_KINDS.some((k) => k.id === input.kind)) throw new LedgerValidationError("Choose expense, income or refund.");
  if (!PAID_FROM.includes(input.paidFrom)) throw new LedgerValidationError("Choose how it was paid.");
  const reason = (input.reason ?? "").trim() || DEFAULT_LATE_REASON;
  if (reason.length > 200) throw new LedgerValidationError("Keep the reason under 200 characters.");

  const category = accounts.find((a) => a.id === input.accountId);
  if (!category) throw new LedgerValidationError("That category isn't in this studio's chart.");
  if (category.active === false) throw new LedgerValidationError(`${category.name} is inactive.`);
  if (!categoryAllowed(input.kind, category)) {
    throw new LedgerValidationError(
      input.kind === "expense" ? `${category.name} is not an expense account.`
        : input.kind === "income" ? `${category.name} is not an income account.`
          : `${category.name} is not an income or expense account, so it cannot be refunded.`,
    );
  }
  const direction = moneyDirection(input.kind, category);
  if (input.kind === "income" && input.paidFrom === "card") throw new LedgerValidationError("Income cannot land on a credit card. Choose the bank or cash.");
  const sourceKey = SOURCE_KEY[direction][input.paidFrom];
  const source = accounts.find((a) => a.key === sourceKey && a.active !== false);
  if (!source) throw new LedgerValidationError(`This studio's chart has no active ${sourceKey.replace(/_/g, " ")} account for "${PAID_FROM_LABEL[direction][input.paidFrom]}".`);

  const amount = input.amountCents;
  const lines = direction === "out"
    ? [
        { accountId: category.id, debitCents: amount, creditCents: 0 },
        { accountId: source.id, debitCents: 0, creditCents: amount },
      ]
    : [
        { accountId: source.id, debitCents: amount, creditCents: 0 },
        { accountId: category.id, debitCents: 0, creditCents: amount },
      ];
  const totalCents = assertBalancedLines(lines);
  const payment = PAYMENT[input.paidFrom];
  return {
    direction, memo: lateMemo({ counterparty, memo: input.memo }), lines, totalCents,
    ...(payment ? { paymentType: payment } : {}),
    category, source, reason,
  };
}

/** The lines that cancel an entry: every debit becomes a credit and back. */
export function reversalLines<L extends EntryLine>(lines: readonly L[]): L[] {
  return lines.map((l) => ({ ...l, debitCents: l.creditCents, creditCents: l.debitCents }));
}

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The first day of the month `now` falls in (UTC). */
export function monthStartOf(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Is this a month that has already ended? Late entries are for those only. */
export function isPastPeriod(periodKey: string, now: number): boolean {
  return parsePeriod(periodKey).end <= monthStartOf(now);
}

/** The date rules. Returns the snapped day; throws a readable
 *  LedgerValidationError.
 *  - the month has ended (the current month takes ordinary entries)
 *  - the day is inside the stated month, and not in the future
 *  - no opening balance snapshot sits after the day: a snapshot is a fixed
 *    starting point, so a change before it would never reach later months.
 *    Before the first snapshot that means before the books start. */
export function checkLateDate(args: { periodKey: string; entryDate: number; now: number; openingDates: readonly number[] }): { period: Period; day: number } {
  let period: Period;
  try {
    period = parsePeriod(args.periodKey);
  } catch (e) {
    throw new LedgerValidationError((e as Error).message);
  }
  if (!Number.isFinite(args.entryDate)) throw new LedgerValidationError("Choose a date.");
  const day = toDay(args.entryDate);
  if (period.end > monthStartOf(args.now)) {
    throw new LedgerValidationError("Late entries are for months that have ended. Add this one as an ordinary entry.");
  }
  if (day < period.start || day >= period.end) {
    throw new LedgerValidationError(`Choose a date between ${fmtDay(period.start)} and ${fmtDay(period.end - DAY_MS)}.`);
  }
  if (day > toDay(args.now)) throw new LedgerValidationError("That date is in the future.");
  const dates = [...args.openingDates].sort((a, b) => a - b);
  const after = dates.find((d) => d > day);
  if (after !== undefined) {
    throw new LedgerValidationError(
      after === dates[0]
        ? `These books start on ${fmtDay(after)}. A change before then belongs in the opening balances, not a late entry.`
        : `Opening balances were set for ${fmtDay(after)}, after this date, so a change here would not carry into later months. Update those opening balances first.`,
    );
  }
  return { period, day };
}

/* ── Duplicates ───────────────────────────────────────────── */

export type PossibleDuplicate = { id: string; entryDate: number; memo: string; totalCents: number; why: string };

/** Words that say nothing about who it was. */
const NAME_STOP = new Set(["vendor", "client", "customer", "payment", "paid", "the", "and", "for", "inc", "llc", "ltd", "co", "company", "services", "service", "studio", "from"]);

const tokens = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 2 && !/^\d+$/.test(t) && !NAME_STOP.has(t)));

/** Posted entries that may already be this item: the same amount within a
 *  week on the same category account, or within three days sharing a word of
 *  the vendor or customer name. A person decides; this only asks. */
export function possibleDuplicates(
  entries: readonly LedgerEntry[],
  candidate: { entryDate: number; totalCents: number; categoryAccountId: string; counterparty: string },
): PossibleDuplicate[] {
  const day = toDay(candidate.entryDate);
  const who = tokens(candidate.counterparty);
  const out: PossibleDuplicate[] = [];
  for (const e of entries) {
    if (e.status !== "posted" || e.late?.reversalOf || e.late?.reversedBy) continue;
    if (entryTotalCents(e.lines) !== candidate.totalCents) continue;
    const days = Math.abs(Math.round((e.entryDate - day) / DAY_MS));
    if (days > 7) continue;
    const sameAccount = e.lines.some((l) => l.accountId === candidate.categoryAccountId);
    const memo = tokens(e.memo);
    const shared = [...who].some((t) => memo.has(t));
    if (sameAccount || (shared && days <= 3)) {
      out.push({
        id: e.id, entryDate: e.entryDate, memo: e.memo, totalCents: entryTotalCents(e.lines),
        why: [`same amount`, days === 0 ? "same day" : `${days} day${days === 1 ? "" : "s"} apart`, sameAccount ? "same category" : "same name"].join(", "),
      });
    }
  }
  return out.sort((a, b) => Math.abs(a.entryDate - day) - Math.abs(b.entryDate - day));
}

/* ── Before and after ─────────────────────────────────────── */

export type LatePreview = {
  before: HeadlineFigures;
  after: HeadlineFigures;
  duplicates: PossibleDuplicate[];
};

/** The period's figures without and with one more entry, through the same
 *  engine the statements use. */
export function previewWithEntry(args: {
  period: Period;
  accounts: readonly LedgerAccount[];
  opening: OpeningBalances | null;
  entries: readonly LedgerEntry[];
  add: LedgerEntry;
}): { before: HeadlineFigures; after: HeadlineFigures } {
  const { period, accounts, opening, entries, add } = args;
  return {
    before: headlineFigures(recomputeStatements(period, accounts, opening, entries)),
    after: headlineFigures(recomputeStatements(period, accounts, opening, [...entries, add])),
  };
}

/** A late entry in engine form, before it has an id. */
export function lateLedgerEntry(plan: Pick<LatePlan, "memo" | "lines" | "reason" | "paymentType">, day: number, meta: { enteredAt: number; enteredBy: string; kind?: LateEntryKind; counterparty?: string; reversalOf?: string }, id = "pending"): LedgerEntry {
  return {
    id, entryDate: toDay(day), memo: plan.memo, status: "posted", receiptStatus: "pending",
    ...(plan.paymentType ? { paymentKind: plan.paymentType.kind } : {}),
    lines: plan.lines.map((l) => ({ accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents })),
    late: { enteredAt: meta.enteredAt, enteredBy: meta.enteredBy, reason: plan.reason, ...(meta.kind ? { kind: meta.kind } : {}), ...(meta.counterparty ? { counterparty: meta.counterparty } : {}), ...(meta.reversalOf ? { reversalOf: meta.reversalOf } : {}) },
  };
}
