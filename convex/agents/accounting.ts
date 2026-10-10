/* ============================================================
   Accounting agent - pure candidate generators.

   The deterministic rule layer for the one agent that works on the
   studio's money. It reads plain data (the signals convex/accountingAgent.ts
   gathers from the ledger, receipts and bank reconciliation) and returns
   ProposedAction rows, the same shape every other named agent returns.

   Pure and V8-safe, no ctx, no model: every figure here is arithmetic on the
   books, and every proposal carries the evidence a person needs to check it.
   What it will never do is written in convex/lib/agentScope.ts and enforced
   before anything is saved: it drafts, it flags, it explains, and a person
   approves. Nothing here posts, voids, edits, deletes or sends.

   Tone: plain, calm, never alarmist. No em dashes in any copy.
   Spec: openspec/changes/accounting-agent/.
   ============================================================ */
import type { Id } from "../_generated/dataModel";
import type { ProposedAction } from "../opsBrain";
import { DAY_MS, formatCents, isoDay } from "../lib/ledgerMath";
import type { BankReconciliationRow } from "../lib/statements";
import { vendorSimilarity } from "../lib/financeMatch";
import { plain } from "../lib/agentScope";

/* ----------------------------------------------------------------
   Signal shapes
   ---------------------------------------------------------------- */
export type AcctAccount = {
  id: string;
  key: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  isCash?: boolean;
  isClearing?: boolean;
};

export type AcctLine = { accountId: string; debitCents: number; creditCents: number };

export type AcctEntry = {
  id: Id<"journalEntries">;
  entryDate: number;
  memo: string;
  status: "posted" | "draft" | "void";
  source: string;
  receiptStatus: "yes" | "no" | "pending";
  paymentKind?: string;
  paymentRaw?: string;
  bookPeriod?: string;
  sourceRef?: string;
  lines: AcctLine[];
  totalCents: number;
  receiptIds: string[];
};

export type AcctReceipt = {
  id: Id<"receipts">;
  vendor?: string;
  date?: number;
  totalCents?: number;
  status: string;
  cardLast4?: string;
};

/** A bank feed line (bankTransactions), for spotting money the books never saw. */
export type AcctBankLine = {
  id: Id<"bankTransactions">;
  date: number;
  amountCents: number;
  direction: "in" | "out";
  name: string;
  /** An expenses category, when one was suggested or chosen. */
  category?: string;
  /** The feed account is a credit card. */
  onCard?: boolean;
  receiptId?: Id<"receipts">;
};

/** What late entries changed in this period since it was reported (the
 *  engine's lateEntryImpact, trimmed). */
export type AcctLateImpact = {
  count: number;
  before: { netIncomeCents: number; endingCashCents: number };
  after: { netIncomeCents: number; endingCashCents: number };
  entries: { memo: string; totalCents: number; enteredAt: number; reversal: boolean }[];
};

export type AcctWarning = {
  code: string;
  severity: string;
  message: string;
  row?: number;
  raw?: string;
  normalized?: string;
};

export type AcctCheck = {
  code: string;
  status: "pass" | "warn" | "fail";
  message: string;
  amountCents?: number;
  detail?: unknown;
};

export type AcctVariance = {
  statement: string;
  key: string;
  label: string;
  kind: "line" | "total";
  reportedCents: number;
  recomputedCents: number;
  varianceCents: number;
};

export type AccountingSignals = {
  now: number;
  periodKey: string; // "2026-07"
  periodStart: number;
  periodEnd: number; // exclusive
  accounts: AcctAccount[];
  /** Posted and draft entries dated in the period or filed under it. */
  entries: AcctEntry[];
  /** The posted entries of the months just before, newest first. */
  prior: { key: string; entries: AcctEntry[] }[];
  receipts: AcctReceipt[];
  recon: BankReconciliationRow[];
  checks: AcctCheck[];
  variances: AcctVariance[];
  warnings: AcctWarning[];
  hasReported: boolean;
  totals: { revenueCents: number; expensesCents: number; netIncomeCents: number; endingCashCents: number };
  /** Bank feed lines dated in the period. Optional: a studio with no feed has none. */
  bankLines?: AcctBankLine[];
  /** Late entries that changed the period since it was reported, if any. */
  lateImpact?: AcctLateImpact | null;
};

/* ----------------------------------------------------------------
   Small helpers
   ---------------------------------------------------------------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function periodLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1] ?? key} ${y}`;
}

/** $1,305.00. Negative amounts keep the minus sign in front of the dollar sign. */
export function dollars(cents: number): string {
  return `${cents < 0 ? "-" : ""}$${formatCents(Math.abs(cents))}`;
}

function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}

function clip(text: string, n = 60): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}...` : t;
}

const accountIndex = (s: AccountingSignals) => ({
  byId: new Map(s.accounts.map((a) => [a.id, a] as const)),
  byKey: new Map(s.accounts.map((a) => [a.key, a] as const)),
});

const inPeriod = (s: AccountingSignals, e: AcctEntry) => e.entryDate >= s.periodStart && e.entryDate < s.periodEnd;

/** Posted entries dated in the period. Drafts and voids never count. */
function postedInPeriod(s: AccountingSignals): AcctEntry[] {
  return s.entries.filter((e) => e.status === "posted" && inPeriod(s, e));
}

/** An entry the agent drafted itself needs no receipt and is never a lead. */
const isAgentEntry = (e: AcctEntry) => e.source === "agent";

/** The row a warning names, mapped to the entry that holds it and the line. */
function entryAtRow(entries: AcctEntry[], row: number): { entry: AcctEntry; lineIndex: number } | null {
  for (const e of entries) {
    const m = /!A(\d+):H(\d+)$/.exec(e.sourceRef ?? "");
    if (!m) continue;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (row >= start && row <= end) return { entry: e, lineIndex: row - start };
  }
  return null;
}

/* ----------------------------------------------------------------
   (i) Receipts: link proposals and "no receipt" flags
   ---------------------------------------------------------------- */
const LINK_DATE_WINDOW_DAYS = 7;
const LINK_SUGGEST_SCORE = 70;
const LINK_EXACT_SCORE = 85;
const LINK_MARGIN = 15;

export type ReceiptMatch = {
  entry: AcctEntry;
  receipt: AcctReceipt;
  score: number;
  exact: boolean;
  reasons: string[];
};

function scoreReceipt(entry: AcctEntry, r: AcctReceipt): { score: number; reasons: string[]; days: number | null; vendor: number } | null {
  if (r.totalCents === undefined || r.totalCents <= 0) return null;
  if (Math.abs(r.totalCents - entry.totalCents) > 1) return null;
  const reasons = ["the amount matches to the cent"];
  let score = 60;
  let days: number | null = null;
  if (r.date !== undefined) {
    days = Math.abs(Math.round((r.date - entry.entryDate) / DAY_MS));
    if (days > LINK_DATE_WINDOW_DAYS) return null;
    if (days === 0) { score += 25; reasons.push("same day"); }
    else if (days <= 3) { score += 20; reasons.push(`${days} day${days === 1 ? "" : "s"} apart`); }
    else { score += 10; reasons.push(`${days} days apart`); }
  }
  const sim = vendorSimilarity(r.vendor, entry.memo);
  if (sim >= 0.6) { score += 15; reasons.push("the vendor name matches the description"); }
  else if (sim >= 0.3) { score += 8; reasons.push("the vendor name partly matches the description"); }
  return { score, reasons, days, vendor: sim };
}

/** Every receipt and entry pair worth a person's time, best pairs first, each
 *  receipt and entry used at most once. Exact means: amount to the cent, within
 *  three days, a vendor clue, and clearly ahead of the runner-up on both sides. */
export function matchReceipts(s: AccountingSignals): ReceiptMatch[] {
  const linked = new Set<string>();
  for (const e of [...s.entries, ...s.prior.flatMap((p) => p.entries)]) for (const id of e.receiptIds) linked.add(id);
  const open = s.receipts.filter((r) => !linked.has(r.id) && (r.status === "ready" || r.status === "needs_review"));
  const needing = postedInPeriod(s).filter((e) => !isAgentEntry(e) && e.receiptStatus !== "yes" && e.receiptIds.length === 0);

  type Pair = { entry: AcctEntry; receipt: AcctReceipt; score: number; reasons: string[]; days: number | null; vendor: number };
  const pairs: Pair[] = [];
  for (const entry of needing) {
    for (const receipt of open) {
      const sc = scoreReceipt(entry, receipt);
      if (sc && sc.score >= LINK_SUGGEST_SCORE) pairs.push({ entry, receipt, ...sc });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.entry.entryDate - b.entry.entryDate || String(a.entry.id).localeCompare(String(b.entry.id)));

  const best = (list: Pair[], pick: (p: Pair) => string, p: Pair) => {
    const rivals = list.filter((q) => pick(q) === pick(p) && q !== p).map((q) => q.score);
    return rivals.length ? Math.max(...rivals) : 0;
  };

  const usedEntries = new Set<string>();
  const usedReceipts = new Set<string>();
  const out: ReceiptMatch[] = [];
  for (const p of pairs) {
    if (usedEntries.has(p.entry.id) || usedReceipts.has(p.receipt.id)) continue;
    usedEntries.add(p.entry.id);
    usedReceipts.add(p.receipt.id);
    const rival = Math.max(best(pairs, (q) => q.entry.id, p), best(pairs, (q) => q.receipt.id, p));
    const exact = p.score >= LINK_EXACT_SCORE && (p.days ?? 99) <= 3 && p.vendor >= 0.3 && p.score - rival >= LINK_MARGIN;
    out.push({ entry: p.entry, receipt: p.receipt, score: p.score, exact, reasons: p.reasons });
  }
  return out;
}

export function receiptCandidates(s: AccountingSignals): ProposedAction[] {
  const out: ProposedAction[] = [];
  const matches = matchReceipts(s);
  const matchedEntries = new Set(matches.map((m) => m.entry.id));

  for (const m of matches) {
    out.push({
      type: "acct_receipt_link",
      priority: m.exact ? "low" : "medium",
      riskLevel: m.exact ? "low" : "medium",
      confidence: m.score / 100,
      title: `Link receipt to ${clip(m.entry.memo, 48)} (${dollars(m.entry.totalCents)})`,
      rationale: plain(
        m.exact
          ? `A receipt from ${m.receipt.vendor ?? "an unnamed vendor"} matches this entry exactly: ${m.reasons.join(", ")}. Linking it marks the entry as having a receipt.`
          : `A receipt from ${m.receipt.vendor ?? "an unnamed vendor"} may belong to this entry: ${m.reasons.join(", ")}. It is close but not certain, so it is yours to confirm.`,
      ),
      entityType: "journal_entry",
      entityId: `${s.periodKey}:link:${m.entry.id}:${m.receipt.id}`,
      payload: {
        kind: "receipt_link",
        entryId: m.entry.id,
        receiptId: m.receipt.id,
        score: m.score,
        exact: m.exact,
        evidence: [
          `Entry: ${shortDate(m.entry.entryDate)}, ${clip(m.entry.memo)}, ${dollars(m.entry.totalCents)}`,
          `Receipt: ${m.receipt.vendor ?? "no vendor read"}${m.receipt.date !== undefined ? `, ${shortDate(m.receipt.date)}` : ""}, ${dollars(m.receipt.totalCents ?? 0)}`,
          `Match score ${m.score} of 100${m.exact ? " (exact: amount, date and vendor all agree and nothing else comes close)" : ""}`,
        ],
      },
    });
  }

  for (const e of postedInPeriod(s)) {
    if (isAgentEntry(e) || e.receiptStatus !== "no" || e.receiptIds.length > 0 || matchedEntries.has(e.id)) continue;
    out.push({
      type: "acct_receipt_missing",
      priority: e.totalCents >= 5000 ? "medium" : "low",
      riskLevel: "low",
      title: `No receipt on file: ${clip(e.memo, 48)} (${dollars(e.totalCents)})`,
      rationale: plain(
        `The books mark this ${dollars(e.totalCents)} entry on ${shortDate(e.entryDate)} as having no receipt, and none of the uploaded receipts matches it. Find or upload one so the entry is backed up, or note why there is none.`,
      ),
      entityType: "journal_entry",
      entityId: `${s.periodKey}:norcpt:${e.id}`,
      payload: {
        kind: "acct_note",
        entryIds: [e.id],
        evidence: [
          `Entry: ${shortDate(e.entryDate)}, ${clip(e.memo)}, ${dollars(e.totalCents)}`,
          "Receipt column in the books: No",
          "No uploaded receipt matches this amount within a week of this date",
        ],
      },
    });
  }
  return out;
}

/* ----------------------------------------------------------------
   (ii) Clearing: money the bank shows that the books never moved
   ---------------------------------------------------------------- */
function endOfPeriodDay(s: AccountingSignals): number {
  return s.periodEnd - DAY_MS;
}

const PROCESSOR_RE = /processor|stripe|square|paypal|merchant/i;
const PAIR_STOP = new Set([
  "client", "processing", "processor", "fee", "fees", "deposit", "session", "payment", "for", "the", "and", "of", "to",
  "july", "june", "august", "recording", "studio", "balance", "remaining", "received", "unearned", "revenue", "a", "an",
]);

function pairTokens(memo: string): Set<string> {
  return new Set(
    memo.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !PAIR_STOP.has(t) && !/^\d+(st|nd|rd|th)?$/.test(t)),
  );
}

export type ClearingPlan = {
  /** What each clearing draft moves, per bank row. */
  clearing: { accountId: string; accountName: string; accountKey: string; cents: number; bankLabel: string }[];
  /** Cents the books would still sit above (+) or below (-) the bank after every clearing draft. */
  residualCents: number;
  bankLabel: string;
  bankEndingCents: number;
  ledgerEndingCents: number;
  endingVarianceCents: number;
};

/** What clearing the bank can support. When the bank holds more cash than the
 *  books, money the books are carrying in transit is the one thing that can
 *  explain it, so each such balance gets a draft. If together they are more
 *  than the gap, the drafts say so and the overshoot is reported as it is.
 *  Whatever is left over is never allocated to anything. */
export function planClearing(s: AccountingSignals): ClearingPlan | null {
  const row = s.recon[0];
  if (!row) return null;
  const { byId } = accountIndex(s);
  const gap = -row.endingVarianceCents; // positive: the bank holds more than the books
  const clearing: ClearingPlan["clearing"] = [];
  if (gap > 0) {
    for (const u of row.unclearedClearing) {
      const acct = byId.get(u.accountId);
      if (!acct || u.cents <= 0) continue;
      clearing.push({ accountId: u.accountId, accountName: u.name, accountKey: acct.key, cents: u.cents, bankLabel: row.accountLabel });
    }
  }
  const moved = clearing.reduce((sum, c) => sum + c.cents, 0);
  return {
    clearing,
    residualCents: row.endingVarianceCents + moved,
    bankLabel: row.accountLabel,
    bankEndingCents: row.bankEndingCents,
    ledgerEndingCents: row.ledgerEndingCents,
    endingVarianceCents: row.endingVarianceCents,
  };
}

export function clearingCandidates(s: AccountingSignals): ProposedAction[] {
  const out: ProposedAction[] = [];
  const plan = planClearing(s);
  const { byId, byKey } = accountIndex(s);
  const cash = s.accounts.find((a) => a.isCash) ?? byKey.get("bank_cash");
  if (!cash) return out;
  const row = s.recon[0];

  // 1. Clearing drafts: the bank shows the money, the books still hold it in transit.
  for (const c of plan ? plan.clearing : []) {
    if (!plan) break;
    const gapText = `The ${plan.bankLabel} statement ends at ${dollars(plan.bankEndingCents)}. The books show ${dollars(plan.ledgerEndingCents)} in cash, ${dollars(-plan.endingVarianceCents)} less.`;
    const leftover = plan.residualCents === 0
      ? "Approving every clearing draft brings the books level with the statement."
      : `Approving every clearing draft leaves the books ${dollars(Math.abs(plan.residualCents))} ${plan.residualCents > 0 ? "above" : "below"} the statement. That part is not explained yet (see the separate item).`;
    out.push({
      type: "acct_clearing_draft",
      priority: "high",
      riskLevel: "medium",
      title: `Move ${dollars(c.cents)} from ${c.accountName} into ${cash.name}`,
      rationale: plain(
        `${c.accountName} still holds ${dollars(c.cents)} at the end of ${periodLabel(s.periodKey)}, money the books received but never moved into the bank. The bank balance is higher than the books by more than this amount, so it is likely already there. A draft entry is ready; nothing changes until you approve it.`,
      ),
      entityType: "ledger_clearing",
      entityId: `${s.periodKey}:clear:${c.accountKey}:${c.cents}`,
      payload: {
        kind: "ledger_draft",
        entryDate: endOfPeriodDay(s),
        memo: `Move ${c.accountName} into ${cash.name} - cleared at the bank (accounting agent draft)`,
        lines: [
          { accountKey: cash.key, accountName: cash.name, debitCents: c.cents, creditCents: 0 },
          { accountKey: c.accountKey, accountName: c.accountName, debitCents: 0, creditCents: c.cents },
        ],
        evidence: [
          gapText,
          `${c.accountName} holds ${dollars(c.cents)} at ${isoDay(endOfPeriodDay(s))}.`,
          `Check the statement for these deposits before approving. Approving raises the books' cash by ${dollars(c.cents)}, which narrows the gap to ${dollars(Math.abs(plan.endingVarianceCents + c.cents))}.`,
          leftover,
        ],
        cashEffectCents: c.cents,
      },
    });
  }

  // 2. A draw paid in physical cash that was posted against the bank account.
  const owner = s.accounts.find((a) => a.key === "owner_draw");
  const transit = byKey.get("deposits_in_transit");
  const transitHeld = transit ? row?.unclearedClearing.find((u) => u.accountId === transit.id)?.cents ?? 0 : 0;
  if (owner && transit) {
    const posted = postedInPeriod(s);
    for (const e of posted) {
      if (isAgentEntry(e)) continue;
      if (e.paymentKind !== "cash" && e.paymentKind !== "cashapp_or_cash") continue;
      const draw = e.lines.find((l) => l.accountId === owner.id && l.debitCents > 0);
      const cashOut = e.lines.find((l) => byId.get(l.accountId)?.isCash && l.creditCents > 0);
      if (!draw || !cashOut || draw.debitCents !== cashOut.creditCents) continue;
      const cents = draw.debitCents;
      // Cash taken in and not yet deposited is what sits in transit, so that is
      // where a cash draw comes out of. If transit no longer holds that much
      // (it was already cleared), this would overdraw it: do not propose.
      if (row && transitHeld < cents) continue;
      const reversal = posted.find((x) => x !== e && x.entryDate >= e.entryDate && x.lines.some((l) => l.accountId === owner.id && l.creditCents === cents) && x.lines.some((l) => byId.get(l.accountId)?.isCash && l.debitCents === cents));
      out.push({
        type: "acct_cash_draw_reclass",
        priority: "medium",
        riskLevel: "medium",
        title: `Take the ${dollars(cents)} cash owner draw off ${cash.name}`,
        rationale: plain(
          `On ${shortDate(e.entryDate)} the owner took ${dollars(cents)} in physical cash (${clip(e.memo, 40)}), but the books paid it out of ${cash.name}. Cash that never went through the bank should not reduce the bank account. A draft entry takes it out of ${transit.name} instead, the cash that came in and was not yet deposited.`,
        ),
        entityType: "journal_entry",
        entityId: `${s.periodKey}:drawcash:${e.id}`,
        payload: {
          kind: "ledger_draft",
          entryDate: e.entryDate,
          memo: `Cash owner draw of ${dollars(cents)} was not paid from the bank - move off ${cash.name} (accounting agent draft)`,
          lines: [
            { accountKey: cash.key, accountName: cash.name, debitCents: cents, creditCents: 0 },
            { accountKey: transit.key, accountName: transit.name, debitCents: 0, creditCents: cents },
          ],
          evidence: [
            `Original entry: ${shortDate(e.entryDate)}, ${clip(e.memo)}, ${dollars(cents)}, payment type ${e.paymentRaw ?? e.paymentKind}.`,
            reversal
              ? `A later entry on ${shortDate(reversal.entryDate)} (${clip(reversal.memo, 50)}) put ${dollars(cents)} back through the bank, so the bank saw the reimbursement but never the cash payment.`
              : "No matching reimbursement was found.",
            `Cash taken in and not yet deposited sits in ${transit.name}, so the draw comes out of there, not the bank account.`,
            row
              ? `Approving raises the books' cash by ${dollars(cents)} and lowers ${transit.name} by ${dollars(cents)}. Once ${transit.name} is cleared into the bank the books end up the same either way; the clearing draft then moves ${dollars(transitHeld - cents)} instead of ${dollars(transitHeld)}, so approve this one first.`
              : `Approving raises the books' cash by ${dollars(cents)} and lowers ${transit.name} by ${dollars(cents)}.`,
            `Approve only if the statement shows no ${dollars(cents)} withdrawal.`,
          ],
          cashEffectCents: cents,
        },
      });
    }
  }

  // 3. Processor deposits: the processor keeps its fee before it pays out.
  const posted = postedInPeriod(s).filter((e) => !isAgentEntry(e));
  const merchant = byKey.get("merchant_processing");
  if (merchant) {
    const usedFees = new Set<string>();
    for (const dep of posted) {
      if (!PROCESSOR_RE.test(dep.paymentRaw ?? "")) continue;
      const cashIn = dep.lines.find((l) => byId.get(l.accountId)?.isCash && l.debitCents > 0);
      if (!cashIn) continue;
      const depTokens = pairTokens(dep.memo);
      let bestFee: { fee: AcctEntry; cents: number; shared: number } | null = null;
      for (const fee of posted) {
        if (fee === dep || usedFees.has(fee.id)) continue;
        const expense = fee.lines.find((l) => l.accountId === merchant.id && l.debitCents > 0);
        const cashOut = fee.lines.find((l) => byId.get(l.accountId)?.isCash && l.creditCents > 0);
        if (!expense || !cashOut || expense.debitCents >= cashIn.debitCents) continue;
        if (Math.abs(fee.entryDate - dep.entryDate) > 2 * DAY_MS) continue;
        if (!PROCESSOR_RE.test(fee.paymentRaw ?? "")) continue;
        const shared = [...pairTokens(fee.memo)].filter((t) => depTokens.has(t)).length;
        if (shared === 0) continue;
        if (!bestFee || shared > bestFee.shared) bestFee = { fee, cents: expense.debitCents, shared };
      }
      if (!bestFee) continue;
      usedFees.add(bestFee.fee.id);
      const gross = cashIn.debitCents;
      const net = gross - bestFee.cents;
      out.push({
        type: "acct_fee_split",
        priority: "low",
        riskLevel: "low",
        title: `Processor deposit: ${dollars(gross)} less ${dollars(bestFee.cents)} fee = ${dollars(net)} (${clip(dep.memo, 36)})`,
        rationale: plain(
          `The processor keeps its ${dollars(bestFee.cents)} fee before it pays out, so the bank should show one ${dollars(net)} deposit for ${shortDate(dep.entryDate)}. The books record ${dollars(gross)} in and ${dollars(bestFee.cents)} out as two entries that net to the same cash. No entry is needed; match them to the one statement line.`,
        ),
        entityType: "journal_entry",
        entityId: `${s.periodKey}:fee:${dep.id}:${bestFee.fee.id}`,
        payload: {
          kind: "acct_note",
          entryIds: [dep.id, bestFee.fee.id],
          evidence: [
            `Deposit: ${shortDate(dep.entryDate)}, ${clip(dep.memo)}, ${dollars(gross)}`,
            `Fee: ${shortDate(bestFee.fee.entryDate)}, ${clip(bestFee.fee.memo)}, ${dollars(bestFee.cents)}`,
            `Net the bank should show: ${dollars(net)}. Cash effect in the books: ${dollars(net)}, the same.`,
          ],
        },
      });
    }
  }

  // 4. What is left after clearing: reported, never guessed.
  if (plan && plan.residualCents !== 0 && row) {
    const above = plan.residualCents > 0;
    const leads = postedInPeriod(s)
      .filter((e) => !isAgentEntry(e) && e.totalCents === Math.abs(plan.residualCents))
      .slice(0, 5)
      .map((e) => `${shortDate(e.entryDate)}, ${clip(e.memo, 50)}, ${dollars(e.totalCents)}`);
    out.push({
      type: "acct_unexplained_cash",
      priority: "high",
      riskLevel: "medium",
      title: `Cash differs from the bank by ${dollars(Math.abs(plan.residualCents))} with nothing to explain it`,
      rationale: plain(
        `After the clearing drafts above, the books would still sit ${dollars(Math.abs(plan.residualCents))} ${above ? "above" : "below"} the ${plan.bankLabel} statement. Nothing in the books accounts for that amount, so no draft is proposed. It needs a look at the statement lines.`,
      ),
      entityType: "bank_reconciliation",
      entityId: `${s.periodKey}:unexplained:${plan.residualCents}`,
      payload: {
        kind: "acct_note",
        evidence: [
          `Books: ${dollars(plan.ledgerEndingCents)} in cash. Statement: ${dollars(plan.bankEndingCents)}. Difference: ${dollars(plan.endingVarianceCents)}.`,
          `Money the books still hold in transit: ${dollars(row.unclearedClearingTotalCents)}.`,
          `Left after clearing it: ${dollars(plan.residualCents)}.`,
          leads.length
            ? `Entries for exactly ${dollars(Math.abs(plan.residualCents))} this month (leads to check, not conclusions): ${leads.join("; ")}.`
            : `No entry this month is for exactly ${dollars(Math.abs(plan.residualCents))}.`,
        ],
      },
    });
  }
  return out;
}

/* ----------------------------------------------------------------
   (iii) Categorization help
   ---------------------------------------------------------------- */
const TYPE_LABEL: Record<AcctAccount["type"], string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Operating Expenses",
};

export function categorizationCandidates(s: AccountingSignals): ProposedAction[] {
  const out: ProposedAction[] = [];
  const { byId } = accountIndex(s);
  const entries = s.entries.filter((e) => e.status !== "void");

  const describe = (row: number | undefined) => {
    if (row === undefined) return null;
    const hit = entryAtRow(entries, row);
    if (!hit) return null;
    const line = hit.entry.lines[hit.lineIndex] ?? hit.entry.lines[0];
    return { entry: hit.entry, account: line ? byId.get(line.accountId) : undefined };
  };

  // Blank or dash categories.
  const blanks = s.warnings.filter((w) => w.code === "category_missing").map((w) => ({ w, d: describe(w.row) })).filter((x) => x.d);
  if (blanks.length) {
    out.push({
      type: "acct_categorize",
      priority: "low",
      riskLevel: "low",
      title: `${blanks.length} line${blanks.length === 1 ? " has" : "s have"} no category`,
      rationale: plain(
        `${blanks.length} journal line${blanks.length === 1 ? " is" : "s are"} missing a category (blank or a dash). The account on each line tells us what it should be, listed below. Fill them in so reports group them correctly.`,
      ),
      entityType: "categorization",
      entityId: `${s.periodKey}:cat-blank:${blanks.map((b) => b.w.row).join("-")}`,
      payload: {
        kind: "acct_note",
        entryIds: [...new Set(blanks.map((b) => b.d!.entry.id))],
        evidence: blanks.map((b) => `Row ${b.w.row}: ${clip(b.d!.entry.memo, 50)} is on ${b.d!.account?.name ?? "an account"}, so the category would be ${b.d!.account ? TYPE_LABEL[b.d!.account.type] : "unknown"}.`),
      },
    });
  }

  // A category that contradicts the account.
  const conflicts = s.warnings.filter((w) => w.code === "category_conflict").map((w) => ({ w, d: describe(w.row) })).filter((x) => x.d);
  if (conflicts.length) {
    out.push({
      type: "acct_categorize",
      priority: "low",
      riskLevel: "low",
      title: `${conflicts.length} line${conflicts.length === 1 ? "'s" : "s'"} category disagrees with its account`,
      rationale: plain(
        `On ${conflicts.length} line${conflicts.length === 1 ? "" : "s"} the category in the books says one thing and the account says another. The account is what the statements use, so the category is the likely typo.`,
      ),
      entityType: "categorization",
      entityId: `${s.periodKey}:cat-conflict:${conflicts.map((b) => b.w.row).join("-")}`,
      payload: {
        kind: "acct_note",
        entryIds: [...new Set(conflicts.map((b) => b.d!.entry.id))],
        evidence: conflicts.map((b) => `Row ${b.w.row}: ${clip(b.d!.entry.memo, 44)}. Category "${b.w.raw ?? ""}", account ${b.d!.account?.name ?? "unknown"}${b.d!.account ? ` (${TYPE_LABEL[b.d!.account.type]})` : ""}.`),
      },
    });
  }

  // "Revenue" lines sorted into a revenue account by keyword.
  const inferred = s.warnings.filter((w) => w.code === "revenue_line_inferred").map((w) => ({ w, d: describe(w.row) })).filter((x) => x.d);
  if (inferred.length) {
    out.push({
      type: "acct_categorize",
      priority: "low",
      riskLevel: "low",
      confidence: 0.8,
      title: `${inferred.length} revenue line${inferred.length === 1 ? " was" : "s were"} sorted by keyword`,
      rationale: plain(
        `The books use one "Revenue" account. ${inferred.length} line${inferred.length === 1 ? " was" : "s were"} placed in a specific revenue account by reading the description, for example Recording Session or Podcast. Confirm the sorting is right, since it decides which revenue line each dollar lands on.`,
      ),
      entityType: "categorization",
      entityId: `${s.periodKey}:cat-revenue:${inferred.map((b) => b.w.row).join("-")}`,
      payload: {
        kind: "acct_note",
        entryIds: [...new Set(inferred.map((b) => b.d!.entry.id))],
        evidence: inferred.map((b) => `Row ${b.w.row}: ${clip(b.d!.entry.memo, 48)} went to ${b.w.normalized ?? "a revenue account"}.`),
      },
    });
  }
  const unguessed = s.warnings.filter((w) => w.code === "revenue_line_default").map((w) => ({ w, d: describe(w.row) })).filter((x) => x.d);
  if (unguessed.length) {
    out.push({
      type: "acct_categorize",
      priority: "medium",
      riskLevel: "medium",
      title: `${unguessed.length} revenue line${unguessed.length === 1 ? "" : "s"} could not be sorted`,
      rationale: plain(`${unguessed.length} "Revenue" line${unguessed.length === 1 ? " has" : "s have"} no recognisable service in the description, so ${unguessed.length === 1 ? "it was" : "they were"} put in a default revenue account. Choose the right one.`),
      entityType: "categorization",
      entityId: `${s.periodKey}:cat-revdefault:${unguessed.map((b) => b.w.row).join("-")}`,
      payload: {
        kind: "acct_note",
        entryIds: [...new Set(unguessed.map((b) => b.d!.entry.id))],
        evidence: unguessed.map((b) => `Row ${b.w.row}: ${clip(b.d!.entry.memo, 50)} is in ${b.w.normalized ?? "the default revenue account"}.`),
      },
    });
  }

  // The two lines of one entry name different payment types.
  for (const w of s.warnings.filter((x) => x.code === "payment_type_mismatch")) {
    const d = describe(w.row);
    if (!d) continue;
    out.push({
      type: "acct_categorize",
      priority: "medium",
      riskLevel: "low",
      title: `Payment type disagrees inside one entry: ${clip(d.entry.memo, 40)}`,
      rationale: plain(
        `The two lines of this ${dollars(d.entry.totalCents)} entry on ${shortDate(d.entry.entryDate)} name different payment types (${w.raw ?? "two different types"}). The books kept the first. Which one is right changes whether the money is cash on hand or a bank deposit.`,
      ),
      entityType: "journal_entry",
      entityId: `${s.periodKey}:paymix:${d.entry.id}`,
      payload: {
        kind: "acct_note",
        entryIds: [d.entry.id],
        evidence: [
          `Entry: ${shortDate(d.entry.entryDate)}, ${clip(d.entry.memo)}, ${dollars(d.entry.totalCents)}`,
          `Payment types written: ${w.raw ?? "n/a"}. The books kept: ${d.entry.paymentRaw ?? d.entry.paymentKind ?? "the first"}.`,
        ],
      },
    });
  }
  return out;
}

/* ----------------------------------------------------------------
   (v) Anomalies
   ---------------------------------------------------------------- */
const INTEREST_RATIO = 0.3;
const INTEREST_MIN_CENTS = 5_000;
const OUTLIER_FACTOR = 2;
const OUTLIER_MIN_EXCESS_CENTS = 10_000;

const memoKey = (memo: string) => memo.trim().toLowerCase().replace(/\s+/g, " ");

/** Debits to an expense account across entries. */
function expenseByAccount(s: AccountingSignals, entries: AcctEntry[]): Map<string, number> {
  const { byId } = accountIndex(s);
  const m = new Map<string, number>();
  for (const e of entries) {
    for (const l of e.lines) {
      const a = byId.get(l.accountId);
      if (a?.type === "expense") m.set(a.key, (m.get(a.key) ?? 0) + l.debitCents - l.creditCents);
    }
  }
  return m;
}

export function anomalyCandidates(s: AccountingSignals): ProposedAction[] {
  const out: ProposedAction[] = [];
  const { byId, byKey } = accountIndex(s);
  const posted = postedInPeriod(s).filter((e) => !isAgentEntry(e));

  // Duplicates: same date, amount and description.
  const groups = new Map<string, AcctEntry[]>();
  for (const e of posted) {
    const k = `${e.entryDate}|${e.totalCents}|${memoKey(e.memo)}`;
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    out.push({
      type: "acct_anomaly",
      priority: "medium",
      riskLevel: "medium",
      title: `Possible duplicate: ${clip(g[0].memo, 44)} (${dollars(g[0].totalCents)}) entered ${g.length} times`,
      rationale: plain(
        `${g.length} entries share the date ${shortDate(g[0].entryDate)}, the amount ${dollars(g[0].totalCents)} and the description. If it really happened twice, ignore this; if not, one of them should be voided by a person.`,
      ),
      entityType: "journal_entry",
      entityId: `${s.periodKey}:dup:${g.map((e) => e.id).sort().join(",")}`,
      payload: {
        kind: "acct_note",
        entryIds: g.map((e) => e.id),
        evidence: g.map((e) => `${shortDate(e.entryDate)}, ${clip(e.memo)}, ${dollars(e.totalCents)}${e.sourceRef ? ` (${e.sourceRef})` : ""}`),
      },
    });
  }

  // An expense far above its usual level.
  const thisMonth = expenseByAccount(s, posted);
  const history = s.prior.filter((p) => p.entries.length > 0).map((p) => expenseByAccount(s, p.entries));
  if (history.length >= 2) {
    for (const [key, cents] of thisMonth) {
      const past = history.map((h) => h.get(key) ?? 0);
      if (past.filter((x) => x > 0).length < 2) continue;
      const avg = Math.round(past.reduce((a, b) => a + b, 0) / past.length);
      if (avg > 0 && cents >= avg * OUTLIER_FACTOR && cents - avg >= OUTLIER_MIN_EXCESS_CENTS) {
        const name = byKey.get(key)?.name ?? key;
        out.push({
          type: "acct_anomaly",
          priority: "medium",
          riskLevel: "low",
          title: `${name} is ${dollars(cents - avg)} above its usual level`,
          rationale: plain(`${name} came to ${dollars(cents)} in ${periodLabel(s.periodKey)}. Over the previous ${past.length} months it averaged ${dollars(avg)}. That may be fine, but it is worth a glance.`),
          entityType: "expense_account",
          entityId: `${s.periodKey}:outlier:${key}:${cents}`,
          payload: { kind: "acct_note", evidence: [`${periodLabel(s.periodKey)}: ${dollars(cents)}`, `Trailing average: ${dollars(avg)} over ${past.length} months`] },
        });
      }
    }
  }

  // Credit card interest that is large next to what is being paid down.
  const interest = byKey.get("cc_interest_fees");
  const payable = byKey.get("credit_card_payable");
  if (interest && payable) {
    const interestCents = posted.reduce((sum, e) => sum + e.lines.filter((l) => l.accountId === interest.id).reduce((t, l) => t + l.debitCents - l.creditCents, 0), 0);
    const paidCents = posted.reduce((sum, e) => {
      const paysFromCash = e.lines.some((l) => byId.get(l.accountId)?.isCash && l.creditCents > 0);
      return paysFromCash ? sum + e.lines.filter((l) => l.accountId === payable.id).reduce((t, l) => t + l.debitCents, 0) : sum;
    }, 0);
    if (interestCents >= INTEREST_MIN_CENTS && paidCents > 0 && interestCents / paidCents >= INTEREST_RATIO) {
      const pct = Math.round((interestCents / paidCents) * 100);
      out.push({
        type: "acct_anomaly",
        priority: "medium",
        riskLevel: "low",
        title: `Card interest was ${dollars(interestCents)} against ${dollars(paidCents)} paid on the cards`,
        rationale: plain(
          `Interest and card fees came to ${dollars(interestCents)} in ${periodLabel(s.periodKey)}, about ${pct}% of the ${dollars(paidCents)} paid toward the cards. That is a lot of what you pay going to interest rather than to the balance. Worth looking at which cards carry it.`,
        ),
        entityType: "expense_account",
        entityId: `${s.periodKey}:cc-interest:${interestCents}`,
        payload: {
          kind: "acct_note",
          evidence: [`Interest and card fees: ${dollars(interestCents)}`, `Paid from the bank toward cards: ${dollars(paidCents)}`, `Interest as a share of payments: ${pct}%`],
        },
      });
    }
  }

  // Negative cash, straight from the engine's own check.
  const neg = s.checks.find((c) => c.code === "negative_cash" && c.status === "warn");
  if (neg) {
    const days = (Array.isArray(neg.detail) ? neg.detail : []) as { date: string; cents: number }[];
    out.push({
      type: "acct_anomaly",
      priority: "high",
      riskLevel: "medium",
      title: `Cash in the books goes below zero (${days.length} day${days.length === 1 ? "" : "s"})`,
      rationale: plain(`${neg.message} Cash cannot really be below zero, so an entry is probably dated too early or a deposit is missing.`),
      entityType: "bank_reconciliation",
      entityId: `${s.periodKey}:negative-cash:${days[0]?.date ?? "x"}`,
      payload: { kind: "acct_note", evidence: days.slice(0, 5).map((d) => `${d.date}: ${dollars(d.cents)}`) },
    });
  }
  return out;
}

/* ----------------------------------------------------------------
   (iv) Month-end close checklist
   ---------------------------------------------------------------- */
export type CloseGroup = "statements" | "cash" | "receipts" | "recurring" | "tidy";

export type CloseItem = {
  key: string;
  group: CloseGroup;
  label: string;
  status: "done" | "needs_attention" | "tidy_up";
  details: string[];
};

const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/g;

/** "July rent and CAM - Landlord A" -> "rent and cam landlord a". */
export function recurringKey(memo: string): string {
  return memo
    .toLowerCase()
    .replace(MONTH_RE, " ")
    .replace(/\b\d{1,4}(st|nd|rd|th)?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && !["monthly", "premium", "payment", "for", "the"].includes(t))
    .slice(0, 5)
    .join(" ");
}

const RECURRING_ACCOUNTS = new Set(["rent", "insurance", "internet", "software"]);

function jaccard(a: string, b: string): number {
  const x = new Set(a.split(" "));
  const y = new Set(b.split(" "));
  const shared = [...x].filter((t) => y.has(t)).length;
  return shared / (x.size + y.size - shared || 1);
}

export type MissingRecurring = { accountName: string; label: string; lastCents: number; months: string[] };

/** Expenses that appeared in each of the two months before this one and not in
 *  this one: rent, insurance, internet, software. */
export function missingRecurring(s: AccountingSignals): MissingRecurring[] {
  if (s.prior.length < 2) return [];
  const { byId } = accountIndex(s);
  const keysOf = (entries: AcctEntry[]) => {
    const m = new Map<string, { accountName: string; label: string; cents: number }>();
    for (const e of entries) {
      for (const l of e.lines) {
        const a = byId.get(l.accountId);
        if (!a || a.type !== "expense" || !RECURRING_ACCOUNTS.has(a.key) || l.debitCents <= 0) continue;
        const k = `${a.key}|${recurringKey(e.memo)}`;
        if (!m.has(k)) m.set(k, { accountName: a.name, label: clip(e.memo, 56), cents: l.debitCents });
      }
    }
    return m;
  };
  const [one, two] = [keysOf(s.prior[0].entries), keysOf(s.prior[1].entries)];
  const current = keysOf(s.entries.filter((e) => e.status !== "void" && inPeriod(s, e)));
  const out: MissingRecurring[] = [];
  for (const [k, info] of one) {
    if (!two.has(k)) continue;
    const [acct, text] = k.split("|");
    const present = [...current.keys()].some((ck) => {
      const [ca, ct] = ck.split("|");
      return ca === acct && (ct === text || jaccard(ct, text) >= 0.5);
    });
    if (!present) out.push({ accountName: info.accountName, label: info.label, lastCents: info.cents, months: [s.prior[1].key, s.prior[0].key] });
  }
  return out;
}

export function closeChecklist(s: AccountingSignals): CloseItem[] {
  const items: CloseItem[] = [];
  const check = (code: string) => s.checks.filter((c) => c.code === code);

  // Statements against the journal.
  if (!s.hasReported) {
    items.push({ key: "statements", group: "statements", label: "Your statements against the journal", status: "tidy_up", details: ["No statements were imported for this month, so there is nothing to compare."] });
  } else {
    const lines = s.variances.filter((v) => v.kind === "line");
    items.push(lines.length
      ? {
          key: "statements",
          group: "statements",
          label: "Your statements against the journal",
          status: "needs_attention",
          details: [
            `${lines.length} line${lines.length === 1 ? " differs" : "s differ"} between your statements and what the journal adds up to.`,
            ...lines.slice(0, 6).map((v) => `${v.label}: your statement says ${dollars(v.reportedCents)}, the journal adds up to ${dollars(v.recomputedCents)} (${v.varianceCents > 0 ? "+" : "-"}${dollars(Math.abs(v.varianceCents))}).`),
          ],
        }
      : { key: "statements", group: "statements", label: "Your statements against the journal", status: "done", details: ["Every line matches the journal."] });
  }

  // Bank.
  const bankChecks = check("cash_vs_bank");
  if (!s.recon.length) {
    items.push({ key: "bank", group: "cash", label: "Cash against the bank statement", status: "tidy_up", details: ["No bank statement balance for this month, so cash is not reconciled."] });
  } else {
    const off = bankChecks.filter((c) => c.status !== "pass");
    const r = s.recon[0];
    items.push(off.length
      ? {
          key: "bank",
          group: "cash",
          label: "Cash against the bank statement",
          status: "needs_attention",
          details: [`The books show ${dollars(r.ledgerEndingCents)} in cash and the ${r.accountLabel} statement shows ${dollars(r.bankEndingCents)}, ${dollars(Math.abs(r.endingVarianceCents))} apart.`],
        }
      : { key: "bank", group: "cash", label: "Cash against the bank statement", status: "done", details: [`Cash matches the statement at ${dollars(r.bankEndingCents)}.`] });
  }

  // Clearing accounts.
  const clearing = check("clearing_not_cleared")[0];
  const held = (clearing?.detail ?? []) as { name: string; endingCents: number }[];
  items.push(clearing && clearing.status !== "pass"
    ? { key: "clearing", group: "cash", label: "Money still in transit", status: "needs_attention", details: held.map((h) => `${h.name} still holds ${dollars(h.endingCents)}.`) }
    : { key: "clearing", group: "cash", label: "Money still in transit", status: "done", details: ["Nothing is waiting to be cleared."] });

  // Receipts.
  const noReceipt = postedInPeriod(s).filter((e) => !isAgentEntry(e) && e.receiptStatus === "no" && e.receiptIds.length === 0);
  const pending = postedInPeriod(s).filter((e) => !isAgentEntry(e) && e.receiptStatus === "pending" && e.receiptIds.length === 0);
  const unmatched = matchReceipts(s).length;
  items.push(noReceipt.length || pending.length
    ? {
        key: "receipts",
        group: "receipts",
        label: "Receipts",
        status: noReceipt.length ? "needs_attention" : "tidy_up",
        details: [
          ...noReceipt.map((e) => `No receipt: ${shortDate(e.entryDate)}, ${clip(e.memo, 50)}, ${dollars(e.totalCents)}.`),
          ...(pending.length ? [`${pending.length} entr${pending.length === 1 ? "y is" : "ies are"} waiting on a receipt.`] : []),
          ...(unmatched ? [`${unmatched} uploaded receipt${unmatched === 1 ? " looks" : "s look"} like ${unmatched === 1 ? "a match" : "matches"} for these.`] : []),
        ],
      }
    : { key: "receipts", group: "receipts", label: "Receipts", status: "done", details: ["Every entry has a receipt."] });

  // Recurring expenses that did not show up.
  const missing = missingRecurring(s);
  items.push(missing.length
    ? {
        key: "recurring",
        group: "recurring",
        label: "Regular expenses",
        status: "needs_attention",
        details: missing.map((m) => `${m.label} (${m.accountName}, ${dollars(m.lastCents)}) was booked in each of the last two months and not yet in ${periodLabel(s.periodKey)}.`),
      }
    : { key: "recurring", group: "recurring", label: "Regular expenses", status: "done", details: ["Rent, insurance, internet and software all appear as usual."] });

  // Tidy-ups.
  const textDates = s.warnings.filter((w) => w.code === "text_date_normalized");
  items.push(textDates.length
    ? { key: "text_dates", group: "tidy", label: "Dates typed as text", status: "tidy_up", details: textDates.map((w) => `Row ${w.row ?? "?"} had the date "${w.raw ?? ""}" typed as text. It was read as ${w.normalized ?? "a date"}; re-enter it as a real date.`) }
    : { key: "text_dates", group: "tidy", label: "Dates typed as text", status: "done", details: ["Every date is a real date."] });

  const outside = check("entries_outside_period")[0];
  const outsideRows = (outside?.detail ?? []) as { date: string; memo: string }[];
  items.push(outside && outside.status !== "pass"
    ? { key: "outside", group: "tidy", label: "Entries dated outside the month", status: "tidy_up", details: outsideRows.map((o) => `${o.date}: ${clip(o.memo, 50)}.`) }
    : { key: "outside", group: "tidy", label: "Entries dated outside the month", status: "done", details: ["Every entry is dated inside the month."] });

  const label = s.warnings.find((w) => w.code === "beginning_cash_label_date");
  items.push(label
    ? { key: "cash_label", group: "tidy", label: "Beginning cash label", status: "tidy_up", details: [label.message] }
    : { key: "cash_label", group: "tidy", label: "Beginning cash label", status: "done", details: ["The beginning cash date label is right."] });

  return items;
}

/* ----------------------------------------------------------------
   (vi) The owner's digest, in plain English
   ---------------------------------------------------------------- */
export type Digest = {
  headline: string;
  attentionCount: number;
  bullets: string[];
};

const COUNT_WORDS = ["Nothing", "One thing", "Two things", "Three things", "Four things", "Five things", "Six things"];

export function ownerDigest(s: AccountingSignals, items: CloseItem[], anomalies: ProposedAction[]): Digest {
  const t = s.totals;
  const net = t.netIncomeCents >= 0 ? `net income ${dollars(t.netIncomeCents)}` : `net loss ${dollars(-t.netIncomeCents)}`;
  const parts = [`Revenue ${dollars(t.revenueCents)}, expenses ${dollars(t.expensesCents)}, ${net}.`];
  if (s.recon.length) {
    const r = s.recon[0];
    parts.push(`Your books show ${dollars(r.ledgerEndingCents)} cash; the bank shows ${dollars(r.bankEndingCents)}.`);
  }
  const attentionGroups = new Set(items.filter((i) => i.status === "needs_attention").map((i) => i.group));
  const n = attentionGroups.size;
  parts.push(n === 0 ? "Nothing needs your attention." : `${COUNT_WORDS[n] ?? `${n} things`} ${n === 1 ? "needs" : "need"} your attention.`);

  const bullets: string[] = [];
  for (const g of ["statements", "cash", "receipts", "recurring"] as const) {
    const flagged = items.filter((i) => i.group === g && i.status === "needs_attention");
    if (!flagged.length) continue;
    bullets.push(...flagged.map((i) => `${i.label}: ${i.details[0]}`));
  }
  const tidy = items.filter((i) => i.status === "tidy_up" && i.group === "tidy");
  if (tidy.length) bullets.push(`${tidy.length} small tidy-up${tidy.length === 1 ? "" : "s"}: ${tidy.map((i) => i.label.toLowerCase()).join(", ")}.`);
  if (anomalies.length) bullets.push(`${anomalies.length} thing${anomalies.length === 1 ? "" : "s"} worth a look: ${anomalies.map((a) => a.title).slice(0, 3).join("; ")}.`);
  return { headline: plain(parts.join(" ")), attentionCount: n, bullets: bullets.map(plain) };
}

/* ----------------------------------------------------------------
   Insights (read-only notes, not approvals)
   ---------------------------------------------------------------- */
export type AccountingInsight = {
  title: string;
  severity: "info" | "warning";
  explanation: string;
};

export function accountingInsights(s: AccountingSignals): AccountingInsight[] {
  const items = closeChecklist(s);
  const anomalies = anomalyCandidates(s);
  const digest = ownerDigest(s, items, anomalies);
  const label = periodLabel(s.periodKey);
  const mark = (i: CloseItem) => (i.status === "done" ? "Done" : i.status === "tidy_up" ? "Tidy up" : "Needs you");
  const checklist = items
    .map((i) => `${mark(i)} - ${i.label}\n${i.details.map((d) => `  ${d}`).join("\n")}`)
    .join("\n");
  const late = s.lateImpact && s.hasReported && s.lateImpact.count > 0 ? [lateEntryInsight(s, s.lateImpact)] : [];
  return [
    ...late,
    {
      title: `Month-end close: ${label}`,
      severity: digest.attentionCount > 0 ? "warning" : "info",
      explanation: plain(checklist),
    },
    {
      title: `Monthly summary: ${label}`,
      severity: "info",
      explanation: plain([digest.headline, ...digest.bullets.map((b) => `- ${b}`)].join("\n")),
    },
  ];
}

/** "July 2026 net income moved from -$1,127.80 to -$1,146.80 after 1 late entry." */
export function lateEntryInsight(s: AccountingSignals, impact: AcctLateImpact): AccountingInsight {
  const label = periodLabel(s.periodKey);
  const n = impact.count;
  const noun = `${n} late ${n === 1 ? "entry" : "entries"}`;
  const ni = impact.after.netIncomeCents - impact.before.netIncomeCents;
  const cash = impact.after.endingCashCents - impact.before.endingCashCents;
  const head = ni !== 0
    ? `${label} net income moved from ${dollars(impact.before.netIncomeCents)} to ${dollars(impact.after.netIncomeCents)} after ${noun}.`
    : cash !== 0
      ? `${label} ending cash moved from ${dollars(impact.before.endingCashCents)} to ${dollars(impact.after.endingCashCents)} after ${noun}; net income did not change.`
      : `${label} has ${noun} that cancel out: net income and cash are back where they were.`;
  const lines = impact.entries.map((e) => `- ${e.reversal ? "Reversal: " : ""}${clip(e.memo)}, ${dollars(e.totalCents)}, entered ${shortDate(e.enteredAt)}`);
  return {
    title: `Late entries: ${label}`,
    severity: "info",
    explanation: plain([
      head,
      ...lines,
      "The statements you checked are kept exactly as reported. Books shows the difference as late entries.",
    ].join("\n")),
  };
}

/* ----------------------------------------------------------------
   (vii) Late entries: money in a month that has ended that the books
   never recorded. The agent pre-fills the entry; a person posts it.
   ---------------------------------------------------------------- */
const LATE_MATCH_DAYS_RECEIPT = 7;
const LATE_MATCH_DAYS_BANK = 3;
const LATE_MAX_PER_PERIOD = 10;

/** Pulse expense categories that name one chart account. Others stay unset:
 *  guessing a category would misstate the books. */
const CATEGORY_ACCOUNT_KEY: Readonly<Record<string, string>> = {
  rent: "rent",
  software: "software",
  subscriptions: "software",
  marketing: "advertising",
  insurance: "insurance",
  fees: "bank_service",
};

function monthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** The category account of the most similar earlier entry, by vendor name. */
function guessAccount(s: AccountingSignals, name: string | undefined, type: "expense" | "revenue"): { key: string; name: string; from: string } | null {
  if (!name) return null;
  const { byId } = accountIndex(s);
  let best: { key: string; name: string; from: string; sim: number } | null = null;
  for (const e of [...s.entries, ...s.prior.flatMap((p) => p.entries)]) {
    if (e.status !== "posted") continue;
    const sim = vendorSimilarity(name, e.memo);
    if (sim < 0.6 || (best && sim <= best.sim)) continue;
    const line = e.lines.map((l) => byId.get(l.accountId)).find((a) => a?.type === type);
    if (line) best = { key: line.key, name: line.name, from: e.memo, sim };
  }
  return best ? { key: best.key, name: best.name, from: best.from } : null;
}

export function lateEntryCandidates(s: AccountingSignals): ProposedAction[] {
  // Only a month that has ended. The current month takes ordinary entries.
  if (s.periodEnd > monthStart(s.now)) return [];
  const { byKey } = accountIndex(s);
  const label = periodLabel(s.periodKey);
  const posted = s.entries.filter((e) => e.status === "posted");
  const inMonth = (ms: number | undefined) => ms !== undefined && ms >= s.periodStart && ms < s.periodEnd;
  const linked = new Set<string>();
  for (const e of [...s.entries, ...s.prior.flatMap((p) => p.entries)]) for (const id of e.receiptIds) linked.add(id);
  const cashIds = new Set(s.accounts.filter((a) => a.isCash).map((a) => a.id));
  const cardIds = new Set(s.accounts.filter((a) => a.key === "credit_card_payable").map((a) => a.id));

  type Found = { amountCents: number; date: number; who: string; kind: "expense" | "income"; paidFrom?: "bank" | "card"; account: { key: string; name: string; from?: string } | null; receiptId?: Id<"receipts">; bankTransactionId?: Id<"bankTransactions">; source: string; entityKey: string };
  const found: Found[] = [];
  const suggestedReceipts = new Set<string>();

  // Bank lines no posted entry accounts for: a cash or card line, same amount,
  // same direction, within three days.
  for (const b of s.bankLines ?? []) {
    if (!inMonth(b.date) || b.amountCents <= 0) continue;
    // Money coming onto a card is a card payment or a vendor credit, not
    // income, and the agent cannot tell which: leave it to a person.
    if (b.onCard && b.direction === "in") continue;
    const ids = b.onCard ? cardIds : cashIds;
    // Money out credits the bank (or the card payable); money in debits it.
    const seen = posted.some((e) => Math.abs(e.entryDate - b.date) <= LATE_MATCH_DAYS_BANK * DAY_MS
      && e.lines.some((l) => ids.has(l.accountId) && (b.direction === "out" ? l.creditCents : l.debitCents) === b.amountCents));
    if (seen) continue;
    const kind = b.direction === "out" ? "expense" : "income";
    const fromCategory = kind === "expense" && b.category ? CATEGORY_ACCOUNT_KEY[b.category] : undefined;
    const acct = fromCategory && byKey.get(fromCategory)
      ? { key: fromCategory, name: byKey.get(fromCategory)!.name, from: `the bank line's ${b.category} category` }
      : guessAccount(s, b.name, kind === "expense" ? "expense" : "revenue");
    if (b.receiptId) suggestedReceipts.add(b.receiptId);
    found.push({
      amountCents: b.amountCents, date: b.date, who: b.name, kind, paidFrom: b.onCard ? "card" : "bank", account: acct,
      ...(b.receiptId ? { receiptId: b.receiptId } : {}), bankTransactionId: b.id,
      source: `Bank line: ${shortDate(b.date)}, ${clip(b.name)}, ${b.direction === "out" ? "money out" : "money in"} ${dollars(b.amountCents)}`,
      entityKey: `bank:${b.id}`,
    });
  }

  // Receipts no entry carries and no entry matches by amount within a week.
  for (const r of s.receipts) {
    if (linked.has(r.id) || suggestedReceipts.has(r.id)) continue;
    if (r.status !== "ready" && r.status !== "needs_review") continue;
    if (!inMonth(r.date) || !r.totalCents || r.totalCents <= 0) continue;
    const matched = posted.some((e) => Math.abs(e.entryDate - r.date!) <= LATE_MATCH_DAYS_RECEIPT * DAY_MS && e.totalCents === r.totalCents);
    if (matched) continue;
    found.push({
      amountCents: r.totalCents, date: r.date!, who: r.vendor ?? "Unnamed vendor", kind: "expense",
      ...(r.cardLast4 ? { paidFrom: "card" as const } : {}),
      account: guessAccount(s, r.vendor, "expense"), receiptId: r.id,
      source: `Receipt: ${r.vendor ?? "no vendor read"}, ${shortDate(r.date!)}, ${dollars(r.totalCents)}${r.cardLast4 ? `, card ending ${r.cardLast4}` : ""}`,
      entityKey: `rcpt:${r.id}`,
    });
  }

  return found
    .sort((a, b) => b.amountCents - a.amountCents || a.date - b.date)
    .slice(0, LATE_MAX_PER_PERIOD)
    .map((f): ProposedAction => {
      const sign = f.kind === "expense" ? -1 : 1;
      const ready = !!f.account && !!f.paidFrom;
      const evidence = [
        f.source,
        `No entry in ${label} has this amount within ${f.bankTransactionId ? LATE_MATCH_DAYS_BANK : LATE_MATCH_DAYS_RECEIPT} days of that date`,
        f.account
          ? `Category: ${f.account.name}${f.account.from ? ` (like ${clip(f.account.from, 40)})` : ""}`
          : "Category: not clear from the evidence, so it is yours to choose",
        ...(f.account
          ? [`${label}${s.hasReported ? ", already reported," : ""} would move: net income ${dollars(s.totals.netIncomeCents)} to ${dollars(s.totals.netIncomeCents + sign * f.amountCents)}`]
          : []),
      ];
      return {
        type: "acct_late_entry",
        priority: f.amountCents >= 10_000 ? "medium" : "low",
        riskLevel: "medium",
        confidence: ready ? 0.7 : 0.5,
        title: `Missed ${f.kind} in ${label}: ${clip(f.who, 40)} (${dollars(f.amountCents)})`,
        rationale: plain(
          `${f.bankTransactionId ? "The bank shows" : "An uploaded receipt shows"} ${dollars(f.amountCents)} ${f.kind === "expense" ? "paid to" : "from"} ${clip(f.who, 40)} on ${shortDate(f.date)}, and nothing in the ${label} books records it. ${label} has ended, so it would go in as a late entry: the reported statements stay as they were, and the difference shows as a late entry. Nothing is added until you approve.`,
        ),
        entityType: "journal_entry",
        entityId: `${s.periodKey}:late:${f.entityKey}`,
        payload: {
          kind: "late_entry",
          period: s.periodKey,
          lateKind: f.kind,
          entryDate: f.date,
          counterparty: clip(f.who, 120),
          amountCents: f.amountCents,
          ...(f.account ? { accountKey: f.account.key, accountName: f.account.name } : {}),
          ...(f.paidFrom ? { paidFrom: f.paidFrom } : {}),
          reason: f.bankTransactionId ? "Missed bank transaction" : "Missed invoice/receipt",
          ...(f.receiptId ? { receiptId: f.receiptId } : {}),
          ...(f.bankTransactionId ? { bankTransactionId: f.bankTransactionId } : {}),
          evidence,
        },
      };
    });
}

/* ----------------------------------------------------------------
   Everything the Accounting agent proposes for one period
   ---------------------------------------------------------------- */
export function accountingCandidates(s: AccountingSignals): ProposedAction[] {
  return [
    ...clearingCandidates(s),
    ...receiptCandidates(s),
    ...categorizationCandidates(s),
    ...anomalyCandidates(s),
    ...lateEntryCandidates(s),
  ];
}
