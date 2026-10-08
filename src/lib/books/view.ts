/* View model for the Books report. Pure: no React, no Convex, no arithmetic on
   money. Every cents value below is copied from the ledger API's output
   (recomputed, reported, variances, checks, bank rows). Only formatting
   (money.ts) and ordering happen here. */

import { formatUsd } from "./money";
import type {
  BankRow,
  Check,
  JournalEntryRow,
  StatementKind,
  StatementsPayload,
  Variance,
} from "./types";

export type JournalFilter = {
  text?: string;
  accountId?: string;
  paymentKind?: string;
  receiptStatus?: "yes" | "no" | "pending";
};

export type TabId = "summary" | "journal" | "balanceSheet" | "incomeStatement" | "cashFlow" | "checks";

export const TABS: { id: TabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "journal", label: "Journal" },
  { id: "balanceSheet", label: "Balance Sheet" },
  { id: "incomeStatement", label: "Income Statement" },
  { id: "cashFlow", label: "Cash Flow" },
  { id: "checks", label: "Checks" },
];

export const STATEMENT_TITLE: Record<StatementKind, string> = {
  balanceSheet: "Balance Sheet",
  incomeStatement: "Income Statement",
  cashFlow: "Cash Flow",
};

/* ── statements: reported beside recomputed ───────────────── */

export type StatementRow = {
  key: string;
  label: string;
  kind: "line" | "total";
  section: string;
  reportedCents: number | null;
  journalCents: number | null;
  /** journal minus reported, from the engine's variances. 0 when they agree. */
  differenceCents: number;
  reportedMissing: boolean;
  journalMissing: boolean;
  derived: boolean;
  cell?: string;
  formula?: string;
};

/** Lines in the owner's order (the recomputed reading order carries it), then
 *  any line only the workbook has. */
export function statementRows(kind: StatementKind, s: StatementsPayload): StatementRow[] {
  const journal = s.recomputed[kind].lines as StatementsPayload["recomputed"][StatementKind]["lines"];
  const reported = s.reported?.[kind] ?? null;
  const reportedByKey = new Map((reported ?? []).map((l) => [l.key, l]));
  const variances = new Map<string, Variance>((s.variances?.[kind] ?? []).map((v) => [v.key, v]));
  const rows: StatementRow[] = [];
  const seen = new Set<string>();

  const push = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const j = journal.find((l) => l.key === key);
    const r = reportedByKey.get(key);
    const v = variances.get(key);
    rows.push({
      key,
      label: j?.label ?? r?.label ?? key,
      kind: (j?.kind ?? r?.kind ?? "line") as "line" | "total",
      section: j?.section ?? r?.section ?? "",
      reportedCents: reported ? (r?.cents ?? null) : null,
      journalCents: j ? j.cents : null,
      differenceCents: v ? v.varianceCents : 0,
      reportedMissing: Boolean(v?.reportedMissing),
      journalMissing: Boolean(v?.recomputedMissing),
      derived: Boolean((j as { derived?: boolean } | undefined)?.derived),
      cell: r?.cell,
      formula: r?.formula,
    });
  };
  for (const l of journal) push(l.key);
  for (const l of reported ?? []) push(l.key);
  return rows;
}

/** A plain-words reason for a nonzero difference. Never invents a cause the
 *  engine did not report. */
export function explainDifference(row: StatementRow): string {
  const higher = row.differenceCents > 0;
  const direction = higher ? "higher" : "lower";
  if (row.reportedMissing) {
    return "Your journal has this line but the workbook does not. Check whether the workbook left a line out, or whether a journal entry belongs somewhere else.";
  }
  if (row.journalMissing) {
    return "The workbook shows this line, but no journal entries feed it this month. The workbook number may be typed in rather than calculated.";
  }
  if (row.key === "equity.retained_earnings") {
    return "Retained earnings is derived, not read from an account. The workbook calculates it as a balancing figure, so it moves whenever another line moves.";
  }
  if (row.key === "asset.cash" || row.key === "ending_cash") {
    return `Your journal ends the month ${direction} than the workbook. The Checks tab compares cash with the bank statement.`;
  }
  if (row.kind === "total") {
    return `This total is ${direction} in your journal than in the workbook because one or more lines above it differ.`;
  }
  return `Your journal is ${direction} than the workbook on this line. Usually an entry was added, changed or dated differently after the workbook was built, or the workbook value was typed in.`;
}

/* ── summary ──────────────────────────────────────────────── */

export type Kpi = { id: "revenue" | "expenses" | "net" | "cash"; label: string; journalCents: number; reportedCents: number | null; note: string };

export function kpis(s: StatementsPayload, bank: BankRow[] | undefined): Kpi[] {
  const is = s.recomputed.incomeStatement;
  const rep = (kind: StatementKind, key: string) => {
    const l = s.reported?.[kind]?.find((x) => x.key === key);
    return l ? l.cents : null;
  };
  const bankEnding = bank?.[0]?.bankEndingCents ?? null;
  return [
    {
      id: "revenue", label: "Revenue", journalCents: is.totalRevenueCents,
      reportedCents: rep("incomeStatement", "total_revenue"), note: "Income statement",
    },
    {
      id: "expenses", label: "Expenses", journalCents: is.totalExpensesCents,
      reportedCents: rep("incomeStatement", "total_expenses"), note: "Income statement",
    },
    {
      id: "net", label: "Net income", journalCents: is.netIncomeCents,
      reportedCents: rep("incomeStatement", "net_income"), note: "Income statement",
    },
    {
      id: "cash", label: "Cash", journalCents: s.recomputed.cashFlow.endingCashCents,
      reportedCents: rep("cashFlow", "ending_cash"),
      note: bankEnding === null ? "Ending cash" : `Bank statement ${formatUsd(bankEnding)}`,
    },
  ];
}

/** Revenue lines with money in them, in the owner's order. */
export function revenueMix(s: StatementsPayload) {
  const total = s.recomputed.incomeStatement.totalRevenueCents;
  return s.recomputed.incomeStatement.revenue
    .filter((l) => l.cents !== 0)
    .map((l) => ({ key: l.key, label: l.label, cents: l.cents, share: total > 0 ? l.cents / total : 0 }));
}

/** Largest expense lines first. Ties keep the owner's order. */
export function topExpenses(s: StatementsPayload, limit = 5) {
  return s.recomputed.incomeStatement.expenses
    .filter((l) => l.cents > 0)
    .slice() // ties keep the owner's order: Array.prototype.sort is stable
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit)
    .map((l) => ({ key: l.key, label: l.label, cents: l.cents }));
}

/* ── needs attention ──────────────────────────────────────── */

export type Attention = {
  id: string;
  tone: "critical" | "caution" | "info";
  title: string;
  detail: string;
  tab: TabId;
  /** Journal filter to apply when the link opens the Journal. */
  filter?: JournalFilter;
  /** Statement row to scroll to. */
  rowKey?: string;
};

const CHECK_TAB: Record<string, { tab: TabId; filter?: JournalFilter }> = {
  balanced_entries: { tab: "journal" },
  opening_balanced: { tab: "balanceSheet" },
  balance_sheet_balances: { tab: "balanceSheet" },
  cash_flow_ties: { tab: "cashFlow" },
  cash_vs_bank: { tab: "checks" },
  unclassified_accounts: { tab: "journal" },
  receipts_missing: { tab: "journal", filter: { receiptStatus: "no" } },
  clearing_not_cleared: { tab: "balanceSheet" },
  negative_cash: { tab: "cashFlow" },
  entries_outside_period: { tab: "journal" },
  duplicate_entries: { tab: "journal" },
  reported_statement_warnings: { tab: "checks" },
};

/** Short headlines for the attention list. The check's own sentence is the detail. */
const CHECK_TITLE: Record<string, string> = {
  balanced_entries: "Journal entries do not balance",
  opening_balanced: "Opening balances do not match",
  balance_sheet_balances: "Balance sheet does not balance",
  cash_flow_ties: "Cash flow does not tie to the ledger",
  cash_vs_bank: "Cash does not match the bank",
  unclassified_accounts: "Accounts without a statement line",
  receipts_missing: "Entries missing receipts",
  clearing_not_cleared: "Money still in clearing accounts",
  negative_cash: "Cash went negative",
  entries_outside_period: "Entries dated outside this month",
  duplicate_entries: "Possible duplicate entries",
  reported_statement_warnings: "Notes from your workbook",
};

function cashVsBankText(check: Check): string {
  const row = check.detail as BankRow | undefined;
  if (!row) return check.message;
  const gap = Math.abs(row.endingVarianceCents);
  const below = row.endingVarianceCents < 0 ? "below" : "above";
  const parts = [`Cash in your books is ${formatUsd(gap)} ${below} the bank statement.`];
  if (row.unclearedClearingTotalCents > 0) {
    const names = row.unclearedClearing.map((c) => `${c.name} ${formatUsd(c.cents)}`).join(" and ");
    parts.push(`${formatUsd(row.unclearedClearingTotalCents)} sits in clearing accounts (${names}).`);
  }
  parts.push(
    row.unexplainedCents === 0
      ? "Nothing is left unexplained."
      : `${formatUsd(Math.abs(row.unexplainedCents))} is still unexplained.`,
  );
  return parts.filter(Boolean).join(" ");
}

export function needsAttention(s: StatementsPayload, bank: BankRow[] | undefined): Attention[] {
  const out: Attention[] = [];
  const bankRow = bank?.[0];
  for (const c of s.checks) {
    if (c.status === "pass" || c.code === "reported_vs_recomputed" || c.code === "reported_statement_warnings") continue;
    const target = CHECK_TAB[c.code] ?? { tab: "checks" as TabId };
    out.push({
      id: `check:${c.code}`,
      tone: c.status === "fail" ? "critical" : "caution",
      title: CHECK_TITLE[c.code] ?? c.message,
      detail: c.code === "cash_vs_bank" && bankRow ? cashVsBankText(c) : c.message,
      tab: target.tab,
      filter: target.filter,
    });
  }
  // Line-level differences, plain words. Cash is covered by the bank check.
  const cashKeys = new Set(["asset.cash", "ending_cash"]);
  for (const kind of ["incomeStatement", "balanceSheet", "cashFlow"] as StatementKind[]) {
    for (const v of s.variances?.[kind] ?? []) {
      if (v.kind !== "line" || cashKeys.has(v.key)) continue;
      // varianceCents is journal minus statements: positive means the statements read lower.
      const statementWord = v.varianceCents > 0 ? "lower" : "higher";
      out.push({
        id: `variance:${kind}:${v.key}`,
        tone: "caution",
        title: `${v.label} differs from your journal`,
        detail: v.reportedMissing
          ? `${v.label} is in your journal but missing from the statements.`
          : v.recomputedMissing
            ? `${v.label} is in your statements but no journal entry supports it.`
            : `${v.label} in your statements is ${formatUsd(Math.abs(v.varianceCents))} ${statementWord} than your journal.`,
        tab: kind === "balanceSheet" ? "balanceSheet" : kind === "cashFlow" ? "cashFlow" : "incomeStatement",
        rowKey: v.key,
      });
    }
  }
  const rank = { critical: 0, caution: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/* ── journal ──────────────────────────────────────────────── */

export function filterJournal(entries: readonly JournalEntryRow[], f: JournalFilter): JournalEntryRow[] {
  const text = f.text?.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.receiptStatus && e.receiptStatus !== f.receiptStatus) return false;
    if (f.paymentKind && e.paymentType?.kind !== f.paymentKind) return false;
    if (f.accountId && !e.lines.some((l) => l.accountId === f.accountId)) return false;
    if (text) {
      const hay = [e.memo, e.paymentType?.raw ?? "", ...e.lines.map((l) => l.memo ?? "")].join(" ").toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}


/* ── summary: four cards, the rest behind "Show all" ──────── */

/** Workbook remarks. Quiet "About these books", never attention items. */
const NOTE_CODES = new Set([
  "beginning_cash_label_date",
  "retained_earnings_plug",
  "hardcoded_statement_values",
  "statement_heading_date",
  "formula_cache_mismatch",
  "statement_repeat_differs",
  "unmapped_statement_label",
]);

export function aboutNotes(s: StatementsPayload): { code: string; message: string }[] {
  return (s.reported?.warnings ?? [])
    .filter((w) => NOTE_CODES.has(w.code))
    .map((w) => ({ code: w.code, message: w.message }));
}

/** "+$19.00" or "\u2212$19.00". Sign is the difference's own sign. */
export function formatSignedUsd(cents: number): string {
  if (cents === 0) return "$0.00";
  return cents > 0 ? `+${formatUsd(cents)}` : formatUsd(cents);
}

export type AttentionCard = { id: "cash" | "statements" | "receipts" | "clearing"; tone: "critical" | "caution"; text: string; tab: TabId; filter?: JournalFilter };

/** At most four cards, in the owner's order of need: cash, statements,
 *  receipts, clearing. A card appears only when its check or variance does. */
export function attentionCards(s: StatementsPayload, bank: BankRow[] | undefined): AttentionCard[] {
  const cards: AttentionCard[] = [];
  const cash = s.checks.find((c) => c.code === "cash_vs_bank");
  if (cash && cash.status !== "pass") {
    const row = (cash.detail as BankRow | undefined) ?? bank?.[0];
    const text = row
      ? `Cash is ${formatUsd(Math.abs(row.endingVarianceCents))} ${row.endingVarianceCents < 0 ? "below" : "above"} the bank statement.`
      : cash.message;
    cards.push({ id: "cash", tone: cash.status === "fail" ? "critical" : "caution", text, tab: "checks" });
  }

  const lines = (["incomeStatement", "balanceSheet", "cashFlow"] as StatementKind[]).flatMap((k) =>
    (s.variances?.[k] ?? []).filter((v) => v.kind === "line").map((v) => ({ ...v, statement: k })),
  );
  if (lines.length > 0) {
    const ni = s.variances?.incomeStatement.find((v) => v.key === "net_income");
    const cashVar = s.variances?.balanceSheet.find((v) => v.key === "asset.cash");
    const parts = [`${lines.length} ${lines.length === 1 ? "line" : "lines"} in your statements differ from your journal`];
    if (ni) parts.push(`net income by ${formatSignedUsd(ni.varianceCents)}`);
    if (cashVar) parts.push(`cash by ${formatSignedUsd(cashVar.varianceCents)}`);
    cards.push({ id: "statements", tone: "caution", text: `${parts[0]}${parts.length > 1 ? `, ${parts.slice(1).join(", ")}` : ""}.`, tab: "checks" });
  }

  const receipts = s.checks.find((c) => c.code === "receipts_missing");
  if (receipts && receipts.status !== "pass") {
    const amount = receipts.amountCents !== undefined ? ` (${formatUsd(receipts.amountCents)} in those entries)` : "";
    cards.push({ id: "receipts", tone: "caution", text: `${receipts.message}${amount}`, tab: "journal", filter: { receiptStatus: "no" } });
  }

  const clearing = s.checks.find((c) => c.code === "clearing_not_cleared");
  if (clearing && clearing.status !== "pass" && clearing.amountCents !== undefined) {
    cards.push({ id: "clearing", tone: "caution", text: `${formatUsd(clearing.amountCents)} is still in clearing accounts at month end.`, tab: "balanceSheet" });
  }
  return cards.slice(0, 4);
}

/** Every line that differs, for the Checks tab: statement, label, the two figures, the difference. */
export function lineDifferences(s: StatementsPayload) {
  const names: Record<StatementKind, string> = { balanceSheet: "Balance Sheet", incomeStatement: "Income Statement", cashFlow: "Cash Flow" };
  return (["balanceSheet", "incomeStatement", "cashFlow"] as StatementKind[]).flatMap((k) =>
    statementRows(k, s)
      .filter((r) => r.kind === "line" && r.differenceCents !== 0)
      .map((r) => ({ key: r.key, statement: names[k], label: r.label, reportedCents: r.reportedCents, journalCents: r.journalCents, differenceCents: r.differenceCents, tab: k, rowKey: r.key })),
  );
}
