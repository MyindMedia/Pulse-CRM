/* ============================================================
   Ledger math. Pure: no Convex imports, so the CLI, the tests and
   the API compute exactly the same numbers.

   Money is integer cents. Dates are UTC midnight milliseconds (day
   resolution). A period is a calendar month, "YYYY-MM", covering
   [start, end) in UTC.

   openspec/changes/ledger-books-statements
   ============================================================ */

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type NormalBalance = "debit" | "credit";

export type AccountSubtype =
  | "current_asset"
  | "noncurrent_asset"
  | "current_liability"
  | "long_term_liability"
  | "owner_equity"
  | "owner_draw"
  | "retained_earnings"
  | "operating_revenue"
  | "other_income"
  | "operating_expense"
  | "other_expense";

export const ACCOUNT_TYPES: readonly AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

export const SUBTYPES_BY_TYPE: Readonly<Record<AccountType, readonly AccountSubtype[]>> = {
  asset: ["current_asset", "noncurrent_asset"],
  liability: ["current_liability", "long_term_liability"],
  equity: ["owner_equity", "owner_draw", "retained_earnings"],
  revenue: ["operating_revenue", "other_income"],
  expense: ["operating_expense", "other_expense"],
};

export function defaultNormalBalance(type: AccountType): NormalBalance {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

/** What the engine needs to know about an account. `id` is the Convex id as a
 *  string in the API, or the chart key in the importer and tests. */
export type LedgerAccount = {
  id: string;
  key: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  /** Statement line key, e.g. "revenue.recording_session" or "asset.cash". */
  statementLine: string;
  sortOrder: number;
  normalBalance: NormalBalance;
  /** Counts as cash for the cash flow statement and the bank check. */
  isCash?: boolean;
  /** A holding account that should net to zero (deposits in transit,
   *  funds held by the owner). A balance left over is a finding. */
  isClearing?: boolean;
  /** Cash flow line key for cash moving against this account, e.g.
   *  "operating.rent" or "financing.credit_card_payments". */
  cashFlowLine?: string;
  /** Optional override for an inflow (e.g. an owner reimbursing a draw). */
  cashFlowLineInflow?: string;
  active?: boolean;
};

export type EntryLine = {
  accountId: string;
  debitCents: number;
  creditCents: number;
  memo?: string;
};

export type ReceiptStatus = "yes" | "no" | "pending";
export type EntryStatus = "posted" | "draft" | "void";

export type LedgerEntry = {
  id: string;
  entryDate: number;
  memo: string;
  status: EntryStatus;
  receiptStatus: ReceiptStatus;
  paymentKind?: string;
  /** The month the books filed this entry under ("2026-07"), when imported. */
  bookPeriod?: string;
  sourceRef?: string;
  lines: EntryLine[];
  /** Set on a late entry (added to a month after its books were reported) and
   *  on the reversing entry that cancels one. openspec/changes/late-entries. */
  late?: LateEntryMeta;
};

export type LateEntryKind = "expense" | "income" | "refund";

export type LateEntryMeta = {
  /** When a person actually entered it (real time, ms). */
  enteredAt: number;
  enteredBy: string;
  reason: string;
  kind?: LateEntryKind;
  counterparty?: string;
  /** On a reversing entry: the late entry it cancels. */
  reversalOf?: string;
  /** On a late entry that was reversed: the reversing entry. */
  reversedBy?: string;
};

/** Balances at the start of `asOf`, in each account's NORMAL direction
 *  (a positive liability is a credit balance). */
export type OpeningBalances = {
  asOf: number;
  lines: { accountId: string; cents: number }[];
};

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

// ── Cents ───────────────────────────────────────────────────

/** A spreadsheet or form number to integer cents. Floating noise such as
 *  2413.7999999999997 rounds to 241380. Throws on anything non-finite. */
export function toCents(value: number | string): number {
  const n = typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : value;
  if (!Number.isFinite(n)) throw new LedgerValidationError(`Not a money amount: ${String(value)}`);
  return Math.round(n * 100);
}

export function isCents(n: unknown): n is number {
  return typeof n === "number" && Number.isSafeInteger(n);
}

/** 123456 -> "1,234.56", -70621 -> "-706.21". No currency sign. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}${whole}.${String(abs % 100).padStart(2, "0")}`;
}

// ── Dates and periods ───────────────────────────────────────

export const DAY_MS = 86_400_000;

/** Snap a timestamp to UTC midnight of its UTC day. */
export function toDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

export function dayFromParts(y: number, m: number, d: number): number {
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    throw new LedgerValidationError(`Not a calendar date: ${y}-${m}-${d}`);
  }
  return ms;
}

export function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export type Period = { key: string; start: number; end: number };

/** "2026-07" -> { start: 2026-07-01, end: 2026-08-01 } (UTC, end exclusive). */
export function parsePeriod(key: string): Period {
  const m = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!m) throw new LedgerValidationError(`Period must look like 2026-07, got "${key}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new LedgerValidationError(`Period month out of range: "${key}"`);
  return { key: `${m[1]}-${m[2]}`, start: Date.UTC(y, mo - 1, 1), end: Date.UTC(y, mo, 1) };
}

export function periodKeyOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── Validation ──────────────────────────────────────────────

/** The one balanced-entry rule, shared by the parser, the import mutation,
 *  addEntry and postFromExpense. Returns the entry total in cents.
 *  Rules: at least two lines; every amount a non-negative integer of cents;
 *  each line is a debit or a credit, not both and not neither; total debits
 *  equal total credits and are greater than zero. */
export function assertBalancedLines(lines: readonly EntryLine[]): number {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new LedgerValidationError("An entry needs at least two lines.");
  }
  let debits = 0;
  let credits = 0;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.accountId) throw new LedgerValidationError(`Line ${n} has no account.`);
    if (!isCents(line.debitCents) || !isCents(line.creditCents)) {
      throw new LedgerValidationError(`Line ${n}: amounts must be whole cents.`);
    }
    if (line.debitCents < 0 || line.creditCents < 0) {
      throw new LedgerValidationError(`Line ${n}: amounts cannot be negative.`);
    }
    if (line.debitCents > 0 && line.creditCents > 0) {
      throw new LedgerValidationError(`Line ${n} is both a debit and a credit.`);
    }
    if (line.debitCents === 0 && line.creditCents === 0) {
      throw new LedgerValidationError(`Line ${n} has no amount.`);
    }
    debits += line.debitCents;
    credits += line.creditCents;
  });
  if (debits !== credits) {
    throw new LedgerValidationError(
      `Debits (${formatCents(debits)}) must equal credits (${formatCents(credits)}).`,
    );
  }
  return debits;
}

export function isBalanced(lines: readonly EntryLine[]): boolean {
  try {
    assertBalancedLines(lines);
    return true;
  } catch {
    return false;
  }
}

export function entryTotalCents(lines: readonly EntryLine[]): number {
  return lines.reduce((s, l) => s + l.debitCents, 0);
}

// ── Hashing (idempotency) ───────────────────────────────────

/** cyrb53: a fast, stable 53-bit string hash. Not cryptographic; used only
 *  to recognise an entry already imported. Returned as 14 hex chars. */
export function stableHash(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

/** Content identity of an entry: date, memo and lines by account KEY (not
 *  database id), so the same workbook row hashes the same in every import.
 *  `occurrence` separates identical twins within one batch. */
export function entryContentHash(e: {
  entryDate: number;
  memo: string;
  lines: { accountKey: string; debitCents: number; creditCents: number }[];
  occurrence?: number;
}): string {
  const memo = e.memo.trim().replace(/\s+/g, " ").toLowerCase();
  const lines = e.lines
    .map((l) => `${l.accountKey}:${l.debitCents}:${l.creditCents}`)
    .join("|");
  return stableHash(`${isoDay(e.entryDate)}#${memo}#${lines}#${e.occurrence ?? 0}`);
}

// ── Balances ────────────────────────────────────────────────

/** +1 for a debit-normal account, -1 for a credit-normal one. */
export function normalSign(a: Pick<LedgerAccount, "normalBalance">): 1 | -1 {
  return a.normalBalance === "debit" ? 1 : -1;
}

/** Posted entries only; drafts and voids never touch a balance. */
export function postedOnly<T extends { status: EntryStatus }>(entries: readonly T[]): T[] {
  return entries.filter((e) => e.status === "posted");
}

/** Signed debit-minus-credit balance per account, at the START of `end`
 *  (entries dated before `end`), from the opening balances forward.
 *  Entries dated before the opening date are already inside it and skipped. */
export function signedBalances(
  accounts: readonly LedgerAccount[],
  opening: OpeningBalances | null,
  entries: readonly LedgerEntry[],
  end: number,
): Map<string, number> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const bal = new Map<string, number>(accounts.map((a) => [a.id, 0]));
  const from = opening?.asOf ?? -Infinity;
  if (opening && opening.asOf <= end) {
    for (const l of opening.lines) {
      const a = byId.get(l.accountId);
      if (!a) continue;
      bal.set(a.id, (bal.get(a.id) ?? 0) + normalSign(a) * l.cents);
    }
  }
  for (const e of postedOnly(entries)) {
    if (e.entryDate < from || e.entryDate >= end) continue;
    for (const l of e.lines) {
      bal.set(l.accountId, (bal.get(l.accountId) ?? 0) + l.debitCents - l.creditCents);
    }
  }
  return bal;
}

/** Signed debit-minus-credit activity per account for [start, end). */
export function signedActivity(
  entries: readonly LedgerEntry[],
  start: number,
  end: number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of postedOnly(entries)) {
    if (e.entryDate < start || e.entryDate >= end) continue;
    for (const l of e.lines) {
      out.set(l.accountId, (out.get(l.accountId) ?? 0) + l.debitCents - l.creditCents);
    }
  }
  return out;
}

export type TrialBalanceRow = {
  accountId: string;
  key: string;
  name: string;
  type: AccountType;
  debitCents: number;
  creditCents: number;
  /** Balance in the account's normal direction. */
  balanceCents: number;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  balanced: boolean;
};

/** Trial balance as of `end` (exclusive): each account's balance shown on
 *  its debit or credit side. Debits equal credits for any balanced ledger. */
export function trialBalance(
  accounts: readonly LedgerAccount[],
  opening: OpeningBalances | null,
  entries: readonly LedgerEntry[],
  end: number,
): TrialBalance {
  const bal = signedBalances(accounts, opening, entries, end);
  const rows: TrialBalanceRow[] = [...accounts]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => {
      const signed = bal.get(a.id) ?? 0;
      return {
        accountId: a.id,
        key: a.key,
        name: a.name,
        type: a.type,
        debitCents: signed > 0 ? signed : 0,
        creditCents: signed < 0 ? -signed : 0,
        balanceCents: normalSign(a) * signed,
      };
    })
    .filter((r) => r.debitCents !== 0 || r.creditCents !== 0);
  const totalDebitCents = rows.reduce((s, r) => s + r.debitCents, 0);
  const totalCreditCents = rows.reduce((s, r) => s + r.creditCents, 0);
  return { rows, totalDebitCents, totalCreditCents, balanced: totalDebitCents === totalCreditCents };
}
