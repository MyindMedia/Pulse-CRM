import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { filter } from "convex-helpers/server/filter";
import type { Doc, Id } from "./_generated/dataModel";
import { AccessError, requireCapability } from "./lib/access";
import { currentActor, currentOrgWithCapability } from "./lib/tenant";
import {
  type LedgerAccount,
  type LedgerEntry,
  type OpeningBalances,
  type Period,
  LedgerValidationError,
  assertBalancedLines,
  parsePeriod,
  periodKeyOf,
  toDay,
} from "./lib/ledgerMath";
import {
  type BankStatementBalance,
  type ReportedStatements,
  bankReconciliation as reconcileBank,
  buildStatements,
  impliedOpeningBalances,
} from "./lib/statements";
import { DEFAULT_STUDIO_CHART, type ChartAccount } from "./lib/booksImport";
import {
  accountSubtypeV,
  accountTypeV,
  entryStatusV,
  importWarningV,
  normalBalanceV,
  paymentKindV,
  paymentTypeV,
  receiptStatusV,
  reportedLineV,
} from "./ledgerTables";

/* ============================================================
   The ledger API: a double-entry general ledger per studio, the
   statements built from it, and how they compare with what the
   owner's own books reported.

   Contract: docs/LEDGER-API.md. Spec: openspec/changes/ledger-books-statements.

   Money follows permission. Reads need insights.read, the same gate as
   expenses.plReport: owner, manager (unless the owner switched money off for
   managers), accountant, and agency owner/admin acting as the studio. Writes
   additionally need an owner or manager seat; agency owner/admin act as the
   studio within their existing scope. Every amount is integer cents.
   ============================================================ */

type Ctx = QueryCtx | MutationCtx;

/** Upper bound on rows one call reads. A studio past this needs a closing
 *  entry (opening balances for a later date), not a bigger number. */
const MAX_ROWS = 20_000;

const WRITE_ROLES = new Set(["owner", "manager"]);

async function readOrg(ctx: Ctx): Promise<string> {
  return await currentOrgWithCapability(ctx, "insights.read");
}

/** The caller's studio, if they may change its books. */
export async function writeOrg(ctx: MutationCtx): Promise<{ orgId: string; actor: string }> {
  const viewer = await requireCapability(ctx, "insights.read");
  if (viewer.kind === "guest") throw new AccessError("CAPABILITY_DENIED", "Guests cannot change the books.");
  if (viewer.kind === "studio_member" && !WRITE_ROLES.has(viewer.role)) {
    throw new AccessError("CAPABILITY_DENIED", "Only an owner or manager can change the books.");
  }
  if (!viewer.orgId) throw new AccessError("NO_WORKSPACE", "Choose a studio first.");
  return { orgId: viewer.orgId, actor: await currentActor(ctx) };
}

function asPeriod(key: string): Period {
  try {
    return parsePeriod(key);
  } catch (e) {
    throw new Error((e as Error).message);
  }
}

// ── Doc <-> engine ──────────────────────────────────────────

function toAccount(d: Doc<"ledgerAccounts">): LedgerAccount {
  return {
    id: d._id, key: d.key, name: d.name, type: d.type, subtype: d.subtype, statementLine: d.statementLine,
    sortOrder: d.sortOrder, normalBalance: d.normalBalance, isCash: d.isCash, isClearing: d.isClearing,
    cashFlowLine: d.cashFlowLine, cashFlowLineInflow: d.cashFlowLineInflow, active: d.active,
  };
}

function toEntry(d: Doc<"journalEntries">): LedgerEntry {
  return {
    id: d._id, entryDate: d.entryDate, memo: d.memo, status: d.status, receiptStatus: d.receiptStatus,
    paymentKind: d.paymentType?.kind, bookPeriod: d.bookPeriod, sourceRef: d.sourceRef,
    lines: d.lines.map((l) => ({ accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents, memo: l.memo })),
  };
}

function toOpening(d: Doc<"openingBalances"> | null): OpeningBalances | null {
  return d ? { asOf: d.asOf, lines: d.lines.map((l) => ({ accountId: l.accountId, cents: l.cents })) } : null;
}

function toBank(d: Doc<"bankStatementBalances">): BankStatementBalance {
  return {
    accountLabel: d.accountLabel, ledgerAccountId: d.ledgerAccountId, periodStart: d.periodStart, periodEnd: d.periodEnd,
    beginningCents: d.beginningCents, endingCents: d.endingCents, depositsCents: d.depositsCents,
    withdrawalsCents: d.withdrawalsCents, feesCents: d.feesCents,
  };
}

function toReported(d: Doc<"reportedStatements"> | null): ReportedStatements | null {
  return d ? {
    entityName: d.entityName, periodStart: d.periodStart, periodEnd: d.periodEnd,
    balanceSheet: d.balanceSheet, incomeStatement: d.incomeStatement, cashFlow: d.cashFlow, warnings: d.warnings,
  } : null;
}

async function loadAccounts(ctx: Ctx, orgId: string) {
  const rows = await ctx.db.query("ledgerAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(2001);
  if (rows.length > 2000) throw new Error("This studio has more than 2,000 ledger accounts.");
  return rows;
}

/** Everything one period's statements read. */
async function loadPeriod(ctx: Ctx, orgId: string, period: Period) {
  const [accounts, openingDoc, bankDocs, reportedDocs, filed] = await Promise.all([
    loadAccounts(ctx, orgId),
    ctx.db.query("openingBalances").withIndex("by_org_asOf", (q) => q.eq("orgId", orgId).lte("asOf", period.start)).order("desc").first(),
    ctx.db.query("bankStatementBalances").withIndex("by_org_period", (q) => q.eq("orgId", orgId).eq("periodStart", period.start)).take(50),
    ctx.db.query("reportedStatements").withIndex("by_org_period", (q) => q.eq("orgId", orgId).eq("periodStart", period.start)).take(10),
    ctx.db.query("journalEntries").withIndex("by_org_book_period", (q) => q.eq("orgId", orgId).eq("bookPeriod", period.key)).take(MAX_ROWS + 1),
  ]);
  const from = openingDoc?.asOf;
  const ranged = await ctx.db
    .query("journalEntries")
    .withIndex("by_org_date", (q) => (from === undefined ? q.eq("orgId", orgId).lt("entryDate", period.end) : q.eq("orgId", orgId).gte("entryDate", from).lt("entryDate", period.end)))
    .take(MAX_ROWS + 1);
  if (ranged.length > MAX_ROWS || filed.length > MAX_ROWS) {
    throw new Error("Too many entries to build these statements in one read. Add opening balances closer to this period.");
  }
  const byId = new Map<string, Doc<"journalEntries">>();
  for (const e of [...ranged, ...filed]) byId.set(e._id, e);
  const reportedDoc = reportedDocs.sort((a, b) => b.importedAt - a.importedAt)[0] ?? null;
  return {
    accounts, openingDoc, bankDocs, reportedDoc,
    entries: [...byId.values()],
  };
}

// ── Queries ─────────────────────────────────────────────────

/** The chart of accounts, in statement order. */
export const accounts = query({
  args: { includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { includeInactive }) => {
    const orgId = await readOrg(ctx);
    const rows = await loadAccounts(ctx, orgId);
    return rows
      .filter((a) => includeInactive || a.active)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((a) => ({
        _id: a._id, key: a.key, name: a.name, type: a.type, subtype: a.subtype, statementLine: a.statementLine,
        sortOrder: a.sortOrder, normalBalance: a.normalBalance, isCash: a.isCash ?? false, isClearing: a.isClearing ?? false,
        cashFlowLine: a.cashFlowLine ?? null, cashFlowLineInflow: a.cashFlowLineInflow ?? null, active: a.active,
      }));
  },
});

/** Months that have books: imported statements, bank balances, or entries.
 *  Newest first. */
export const periods = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await readOrg(ctx);
    const [reported, bank, first, last] = await Promise.all([
      ctx.db.query("reportedStatements").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(500),
      ctx.db.query("bankStatementBalances").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(500),
      ctx.db.query("journalEntries").withIndex("by_org_date", (q) => q.eq("orgId", orgId)).order("asc").first(),
      ctx.db.query("journalEntries").withIndex("by_org_date", (q) => q.eq("orgId", orgId)).order("desc").first(),
    ]);
    const months = new Map<string, { period: string; hasReported: boolean; hasBank: boolean; hasEntries: boolean }>();
    const touch = (key: string) => {
      const m = months.get(key) ?? { period: key, hasReported: false, hasBank: false, hasEntries: false };
      months.set(key, m);
      return m;
    };
    for (const r of reported) touch(periodKeyOf(r.periodStart)).hasReported = true;
    for (const b of bank) touch(periodKeyOf(b.periodStart)).hasBank = true;
    if (first && last) {
      let cur = asPeriod(periodKeyOf(first.entryDate));
      const lastKey = periodKeyOf(last.entryDate);
      for (let guard = 0; guard < 600; guard++) {
        touch(cur.key).hasEntries = true;
        if (cur.key === lastKey) break;
        cur = asPeriod(periodKeyOf(cur.end));
      }
    }
    return [...months.values()].sort((a, b) => b.period.localeCompare(a.period));
  },
});

/** Reported vs recomputed statements for a month, with variances and checks.
 *  `reported` is null when no workbook was imported for the period. */
export const statements = query({
  args: { period: v.string() },
  handler: async (ctx, args) => {
    const orgId = await readOrg(ctx);
    const period = asPeriod(args.period);
    const data = await loadPeriod(ctx, orgId, period);
    const reported = toReported(data.reportedDoc);
    const built = buildStatements({
      period,
      accounts: data.accounts.map(toAccount),
      opening: toOpening(data.openingDoc),
      entries: data.entries.map(toEntry),
      bank: data.bankDocs.map(toBank),
      reported,
    });
    return {
      period: { key: period.key, start: period.start, end: period.end },
      entityName: reported?.entityName ?? null,
      opening: data.openingDoc
        ? { asOf: data.openingDoc.asOf, source: data.openingDoc.source, note: data.openingDoc.note ?? null }
        : null,
      reported: reported && data.reportedDoc
        ? { ...reported, importBatchId: data.reportedDoc.importBatchId, importedAt: data.reportedDoc.importedAt }
        : null,
      recomputed: built.recomputed,
      variances: built.variances,
      checks: built.checks,
    };
  },
});

const journalFilterV = v.object({
  accountId: v.optional(v.id("ledgerAccounts")),
  paymentKind: v.optional(paymentKindV),
  receiptStatus: v.optional(receiptStatusV),
  status: v.optional(entryStatusV),
  /** Case-insensitive match on the memo, line memos and the raw payment type. */
  text: v.optional(v.string()),
});

/** Journal entries, newest first, paginated. `period` limits to a month. */
export const journal = query({
  args: {
    period: v.optional(v.string()),
    filter: v.optional(journalFilterV),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const orgId = await readOrg(ctx);
    const period = args.period ? asPeriod(args.period) : null;
    const f = args.filter ?? {};
    const text = f.text?.trim().toLowerCase();
    const base = ctx.db
      .query("journalEntries")
      .withIndex("by_org_date", (q) => (period ? q.eq("orgId", orgId).gte("entryDate", period.start).lt("entryDate", period.end) : q.eq("orgId", orgId)))
      .order("desc");
    const page = await filter(base, (e) => {
      if (f.status && e.status !== f.status) return false;
      if (f.receiptStatus && e.receiptStatus !== f.receiptStatus) return false;
      if (f.paymentKind && e.paymentType?.kind !== f.paymentKind) return false;
      if (f.accountId && !e.lines.some((l) => l.accountId === f.accountId)) return false;
      if (text) {
        const hay = [e.memo, e.paymentType?.raw ?? "", ...e.lines.map((l) => l.memo ?? "")].join(" ").toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    }).paginate(args.paginationOpts);
    return page;
  },
});

/** Cash per ledger against each bank statement summary for the month, with
 *  the clearing balances that may explain a gap. */
export const bankReconciliation = query({
  args: { period: v.string() },
  handler: async (ctx, args) => {
    const orgId = await readOrg(ctx);
    const period = asPeriod(args.period);
    const data = await loadPeriod(ctx, orgId, period);
    return {
      period: { key: period.key, start: period.start, end: period.end },
      rows: reconcileBank(
        data.accounts.map(toAccount),
        toOpening(data.openingDoc),
        data.entries.map(toEntry),
        data.bankDocs.map(toBank),
      ),
    };
  },
});

/** One period's books, computed for a caller that has already been authorised
 *  (the accounting agent's scan). Same engine and same inputs as the
 *  `statements` and `bankReconciliation` queries. */
export async function ledgerPeriodView(ctx: Ctx, orgId: string, periodKey: string) {
  const period = asPeriod(periodKey);
  const data = await loadPeriod(ctx, orgId, period);
  const reported = toReported(data.reportedDoc);
  const engineAccounts = data.accounts.map(toAccount);
  const engineEntries = data.entries.map(toEntry);
  const opening = toOpening(data.openingDoc);
  const bank = data.bankDocs.map(toBank);
  const built = buildStatements({ period, accounts: engineAccounts, opening, entries: engineEntries, bank, reported });
  return {
    period,
    accountDocs: data.accounts,
    entryDocs: data.entries,
    reportedDoc: data.reportedDoc,
    built,
    recon: reconcileBank(engineAccounts, opening, engineEntries, bank),
  };
}

// ── Writes ──────────────────────────────────────────────────

const lineInputV = v.object({
  accountId: v.id("ledgerAccounts"),
  debitCents: v.number(),
  creditCents: v.number(),
  memo: v.optional(v.string()),
});

/** Validate lines against this studio's chart. Throws a readable Error. */
async function checkLines(ctx: MutationCtx, orgId: string, lines: { accountId: Id<"ledgerAccounts">; debitCents: number; creditCents: number }[]) {
  let total: number;
  try {
    total = assertBalancedLines(lines);
  } catch (e) {
    throw new Error((e as Error).message);
  }
  for (const l of lines) {
    const a = await ctx.db.get(l.accountId);
    if (!a || a.orgId !== orgId) throw new Error("That account isn't in this studio's chart.");
    if (!a.active) throw new Error(`${a.name} is inactive.`);
  }
  return total;
}

export type NewEntryInput = {
  entryDate: number;
  memo: string;
  lines: { accountId: Id<"ledgerAccounts">; debitCents: number; creditCents: number; memo?: string }[];
  status: "draft" | "posted";
  paymentType?: Infer<typeof paymentTypeV>;
  receiptStatus?: "yes" | "no" | "pending";
  source?: "manual" | "agent";
  sourceRef?: string;
};

/** The one place a journal entry is created. The `addEntry` mutation and the
 *  accounting agent both go through it, so lines are validated against the
 *  studio's chart the same way whoever writes them. The caller has already
 *  decided who may write; this does not look at the viewer. */
export async function createEntry(ctx: MutationCtx, orgId: string, actor: string, args: NewEntryInput) {
  const memo = args.memo.trim();
  if (!memo) throw new Error("Describe the entry.");
  if (!Number.isFinite(args.entryDate)) throw new Error("Choose a date.");
  const totalCents = await checkLines(ctx, orgId, args.lines);
  return await ctx.db.insert("journalEntries", {
    orgId,
    entryDate: toDay(args.entryDate),
    memo,
    ...(args.paymentType ? { paymentType: args.paymentType } : {}),
    ...(args.sourceRef ? { sourceRef: args.sourceRef } : {}),
    receiptStatus: args.receiptStatus ?? "pending",
    status: args.status,
    source: args.source ?? "manual",
    lines: args.lines,
    totalCents,
    createdBy: actor,
    createdAt: Date.now(),
  });
}

/** Draft to posted, revalidated. Only a person's approval may call this. */
export async function postDraft(ctx: MutationCtx, orgId: string, id: Id<"journalEntries">) {
  const e = await ctx.db.get(id);
  if (!e || e.orgId !== orgId) throw new Error("Entry not found.");
  if (e.status !== "draft") throw new Error("Only a draft can be posted.");
  await checkLines(ctx, orgId, e.lines);
  await ctx.db.patch(id, { status: "posted" });
}

/** Attach a receipt row to an entry and mark it received. Idempotent. */
export async function attachReceipt(ctx: MutationCtx, orgId: string, entryId: Id<"journalEntries">, receiptId: Id<"receipts">) {
  const e = await ctx.db.get(entryId);
  if (!e || e.orgId !== orgId) throw new Error("Entry not found.");
  const r = await ctx.db.get(receiptId);
  if (!r || r.orgId !== orgId) throw new Error("Receipt not found.");
  const ids = e.receiptDocIds ?? [];
  if (!ids.includes(receiptId)) {
    await ctx.db.patch(entryId, { receiptDocIds: [...ids, receiptId], receiptStatus: "yes" });
  }
  return { receiptDocIds: ids.includes(receiptId) ? ids : [...ids, receiptId] };
}

/** Add a balanced entry, as a draft or posted. */
export const addEntry = mutation({
  args: {
    entryDate: v.number(),
    memo: v.string(),
    lines: v.array(lineInputV),
    status: v.union(v.literal("draft"), v.literal("posted")),
    paymentType: v.optional(paymentTypeV),
    receiptStatus: v.optional(receiptStatusV),
    source: v.optional(v.union(v.literal("manual"), v.literal("agent"))),
  },
  handler: async (ctx, args) => {
    const { orgId, actor } = await writeOrg(ctx);
    return await createEntry(ctx, orgId, actor, args);
  },
});

/** Post a draft (for example one the accounting agent proposed). */
export const postEntry = mutation({
  args: { id: v.id("journalEntries") },
  handler: async (ctx, { id }) => {
    const { orgId } = await writeOrg(ctx);
    await postDraft(ctx, orgId, id);
  },
});

/** Void an entry. It stays in the journal, out of every balance. */
export const voidEntry = mutation({
  args: { id: v.id("journalEntries"), reason: v.string() },
  handler: async (ctx, { id, reason }) => {
    const { orgId, actor } = await writeOrg(ctx);
    const e = await ctx.db.get(id);
    if (!e || e.orgId !== orgId) throw new Error("Entry not found.");
    if (e.status === "void") throw new Error("That entry is already void.");
    if (!reason.trim()) throw new Error("Say why the entry is void.");
    await ctx.db.patch(id, { status: "void", voidedAt: Date.now(), voidedBy: actor, voidReason: reason.trim() });
  },
});

/** Attach a receipt (receipts table) to an entry and mark it received. */
export const linkReceipt = mutation({
  args: { entryId: v.id("journalEntries"), receiptId: v.id("receipts") },
  handler: async (ctx, { entryId, receiptId }) => {
    const { orgId } = await writeOrg(ctx);
    return await attachReceipt(ctx, orgId, entryId, receiptId);
  },
});

// ── Chart seeding ───────────────────────────────────────────

/** Create any chart account this studio is missing, by key. Existing
 *  accounts are never renamed or reclassified: the owner's wording wins. */
async function upsertChart(ctx: MutationCtx, orgId: string, chart: readonly Omit<ChartAccount, "aliases">[]) {
  const existing = await loadAccounts(ctx, orgId);
  const byKey = new Map(existing.map((a) => [a.key, a._id]));
  let created = 0;
  for (const a of chart) {
    if (byKey.has(a.key)) continue;
    const id = await ctx.db.insert("ledgerAccounts", {
      orgId, key: a.key, name: a.name, type: a.type, subtype: a.subtype, statementLine: a.statementLine,
      sortOrder: a.sortOrder, normalBalance: a.normalBalance,
      ...(a.isCash ? { isCash: true } : {}),
      ...(a.isClearing ? { isClearing: true } : {}),
      ...(a.cashFlowLine ? { cashFlowLine: a.cashFlowLine } : {}),
      ...(a.cashFlowLineInflow ? { cashFlowLineInflow: a.cashFlowLineInflow } : {}),
      active: true, createdAt: Date.now(),
    });
    byKey.set(a.key, id);
    created++;
  }
  return { byKey, created };
}

/** Seed the default studio chart of accounts. Safe to call again. */
export const seedChart = mutation({
  args: {},
  handler: async (ctx) => {
    const { orgId } = await writeOrg(ctx);
    const { created } = await upsertChart(ctx, orgId, DEFAULT_STUDIO_CHART);
    return { created };
  },
});

// ── Expense bridge ──────────────────────────────────────────

/** Default expense account per Pulse expense category. Categories not listed
 *  need an explicit debitAccountId: guessing would misstate the books. */
const EXPENSE_CATEGORY_ACCOUNT: Readonly<Record<string, string>> = {
  rent: "rent",
  software: "software",
  subscriptions: "software",
  marketing: "advertising",
  insurance: "insurance",
  fees: "bank_service",
};

/** Post one balanced entry for an existing expense. Explicit and idempotent:
 *  never runs on its own, and a second call returns the first entry. */
export const postFromExpense = mutation({
  args: {
    expenseId: v.id("expenses"),
    debitAccountId: v.optional(v.id("ledgerAccounts")),
    creditAccountId: v.optional(v.id("ledgerAccounts")),
    status: v.optional(v.union(v.literal("draft"), v.literal("posted"))),
  },
  handler: async (ctx, args) => {
    const { orgId, actor } = await writeOrg(ctx);
    const expense = await ctx.db.get(args.expenseId);
    if (!expense || expense.orgId !== orgId) throw new Error("Expense not found.");
    const sourceRef = `expense:${expense._id}`;
    const prior = (await ctx.db.query("journalEntries").withIndex("by_org_source_ref", (q) => q.eq("orgId", orgId).eq("sourceRef", sourceRef)).take(20))
      .find((e) => e.status !== "void");
    if (prior) return { entryId: prior._id, created: false };

    const { byKey } = await upsertChart(ctx, orgId, DEFAULT_STUDIO_CHART);
    let debitAccountId = args.debitAccountId;
    if (!debitAccountId) {
      const key = EXPENSE_CATEGORY_ACCOUNT[expense.category];
      if (!key || !byKey.get(key)) throw new Error(`Choose the ledger account for a ${expense.category} expense.`);
      debitAccountId = byKey.get(key)!;
    }
    let creditAccountId = args.creditAccountId;
    if (!creditAccountId) {
      let key = "bank_cash";
      if (expense.bankTransactionId) {
        const t = await ctx.db.get(expense.bankTransactionId);
        const acct = t ? await ctx.db.get(t.accountId) : null;
        if (acct?.type === "credit") key = "credit_card_payable";
      }
      creditAccountId = byKey.get(key)!;
    }
    const lines = [
      { accountId: debitAccountId, debitCents: expense.amountCents, creditCents: 0 },
      { accountId: creditAccountId, debitCents: 0, creditCents: expense.amountCents },
    ];
    const totalCents = await checkLines(ctx, orgId, lines);
    const memo = [expense.vendor, expense.description].filter(Boolean).join(" - ") || `${expense.category} expense`;
    const entryId = await ctx.db.insert("journalEntries", {
      orgId,
      entryDate: toDay(expense.date),
      memo,
      receiptStatus: expense.receiptDocId || expense.receiptId ? "yes" : "pending",
      ...(expense.receiptDocId ? { receiptDocIds: [expense.receiptDocId] } : {}),
      status: args.status ?? "posted",
      source: "expense",
      sourceRef,
      expenseId: expense._id,
      lines,
      totalCents,
      createdBy: actor,
      createdAt: Date.now(),
    });
    return { entryId, created: true };
  },
});

// ── Workbook import ─────────────────────────────────────────

const importPlanV = v.object({
  period: v.string(),
  entityName: v.string(),
  importBatchId: v.string(),
  chart: v.array(v.object({
    key: v.string(),
    name: v.string(),
    type: accountTypeV,
    subtype: accountSubtypeV,
    statementLine: v.string(),
    sortOrder: v.number(),
    normalBalance: normalBalanceV,
    isCash: v.optional(v.boolean()),
    isClearing: v.optional(v.boolean()),
    cashFlowLine: v.optional(v.string()),
    cashFlowLineInflow: v.optional(v.string()),
  })),
  entries: v.array(v.object({
    entryDate: v.number(),
    memo: v.string(),
    paymentType: paymentTypeV,
    receiptStatus: receiptStatusV,
    sourceRef: v.string(),
    contentHash: v.string(),
    lines: v.array(v.object({
      accountKey: v.string(),
      debitCents: v.number(),
      creditCents: v.number(),
      memo: v.optional(v.string()),
    })),
  })),
  reported: v.object({
    balanceSheet: v.array(reportedLineV),
    incomeStatement: v.array(reportedLineV),
    cashFlow: v.array(reportedLineV),
    warnings: v.array(importWarningV),
  }),
});

const bankInputV = v.object({
  accountLabel: v.string(),
  periodStart: v.number(),
  periodEnd: v.number(),
  beginningCents: v.number(),
  endingCents: v.number(),
  depositsCents: v.number(),
  withdrawalsCents: v.number(),
  feesCents: v.number(),
});

const seedOpeningV = v.union(v.literal("implied"), v.literal("none"));

type ImportArgs = {
  plan: Infer<typeof importPlanV>;
  bank?: Infer<typeof bankInputV>[];
  seedOpening?: "implied" | "none";
};

async function runImport(ctx: MutationCtx, orgId: string, actor: string, args: ImportArgs) {
  const { plan } = args;
  const period = asPeriod(plan.period);
  const now = Date.now();

  // 1. Chart: create what is missing, keep what the studio already has.
  const { byKey, created: accountsCreated } = await upsertChart(ctx, orgId, plan.chart);

  // 2. Entries: skip any whose content hash this studio already has.
  let entriesCreated = 0;
  let entriesSkipped = 0;
  for (const e of plan.entries) {
    const dup = await ctx.db.query("journalEntries").withIndex("by_org_hash", (q) => q.eq("orgId", orgId).eq("contentHash", e.contentHash)).first();
    if (dup) {
      entriesSkipped++;
      continue;
    }
    const lines = e.lines.map((l) => {
      const accountId = byKey.get(l.accountKey);
      if (!accountId) throw new Error(`Entry ${e.sourceRef} uses an account the plan does not define: ${l.accountKey}.`);
      return { accountId, debitCents: l.debitCents, creditCents: l.creditCents, ...(l.memo ? { memo: l.memo } : {}) };
    });
    let totalCents: number;
    try {
      totalCents = assertBalancedLines(lines);
    } catch (err) {
      throw new LedgerValidationError(`${e.sourceRef}: ${(err as Error).message}`);
    }
    await ctx.db.insert("journalEntries", {
      orgId,
      entryDate: toDay(e.entryDate),
      memo: e.memo,
      paymentType: e.paymentType,
      receiptStatus: e.receiptStatus,
      status: "posted",
      source: "import",
      importBatchId: plan.importBatchId,
      sourceRef: e.sourceRef,
      contentHash: e.contentHash,
      bookPeriod: period.key,
      lines,
      totalCents,
      createdBy: actor,
      createdAt: now,
    });
    entriesCreated++;
  }

  // 3. Reported statements: replace this period's workbook copy.
  const old = await ctx.db.query("reportedStatements").withIndex("by_org_period", (q) => q.eq("orgId", orgId).eq("periodStart", period.start)).take(10);
  for (const r of old) await ctx.db.delete(r._id);
  await ctx.db.insert("reportedStatements", {
    orgId,
    periodStart: period.start,
    periodEnd: period.end,
    entityName: plan.entityName,
    balanceSheet: plan.reported.balanceSheet,
    incomeStatement: plan.reported.incomeStatement,
    cashFlow: plan.reported.cashFlow,
    warnings: plan.reported.warnings,
    source: "workbook",
    importBatchId: plan.importBatchId,
    importedAt: now,
  });

  // 4. Bank statement balances: one row per account label and period.
  let bankUpserted = 0;
  for (const b of args.bank ?? []) {
    if (/\d{5,}/.test(b.accountLabel)) throw new Error("A bank account label must not contain a full account number.");
    if (b.periodStart !== period.start || b.periodEnd !== period.end) throw new Error("The bank statement is for a different period.");
    const prior = (await ctx.db.query("bankStatementBalances").withIndex("by_org_period", (q) => q.eq("orgId", orgId).eq("periodStart", period.start)).take(50))
      .filter((x) => x.accountLabel === b.accountLabel);
    for (const p of prior) await ctx.db.delete(p._id);
    await ctx.db.insert("bankStatementBalances", { orgId, ...b, source: "import", createdAt: now });
    bankUpserted++;
  }

  // 5. Opening balances, implied from the reported close, only when nothing
  //    better exists: a manual or earlier opening is never overwritten.
  let opening: "created" | "replaced" | "kept" | "skipped" = "skipped";
  if (args.seedOpening === "implied") {
    const existing = await ctx.db.query("openingBalances").withIndex("by_org_asOf", (q) => q.eq("orgId", orgId).lte("asOf", period.start)).order("desc").first();
    if (existing && !(existing.asOf === period.start && existing.source === "implied_from_reported_close")) {
      opening = "kept";
    } else {
      const accounts = (await loadAccounts(ctx, orgId)).map(toAccount);
      const entries = (await ctx.db.query("journalEntries").withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("entryDate", period.start).lt("entryDate", period.end)).take(MAX_ROWS)).map(toEntry);
      const anchor = (args.bank ?? [])[0];
      const implied = impliedOpeningBalances({
        accounts, entries, periodStart: period.start, periodEnd: period.end,
        reportedBalanceSheet: plan.reported.balanceSheet,
        cashAnchorCents: anchor?.beginningCents,
      });
      if (existing) await ctx.db.delete(existing._id);
      await ctx.db.insert("openingBalances", {
        orgId,
        asOf: period.start,
        lines: implied.opening.lines.map((l) => ({ accountId: l.accountId as Id<"ledgerAccounts">, cents: l.cents })),
        source: "implied_from_reported_close",
        note: implied.warnings.map((w) => w.message).join(" "),
        createdBy: actor,
        createdAt: now,
      });
      opening = existing ? "replaced" : "created";
    }
  }

  return {
    importBatchId: plan.importBatchId,
    period: period.key,
    accountsCreated,
    entriesCreated,
    entriesSkipped,
    bankUpserted,
    opening,
    warnings: plan.reported.warnings.length,
  };
}

/** Import a parsed workbook (lib/booksImport.ts planToImportArgs) as the
 *  signed-in owner or manager. Idempotent. */
export const importBooks = mutation({
  args: { plan: importPlanV, bank: v.optional(v.array(bankInputV)), seedOpening: v.optional(seedOpeningV) },
  handler: async (ctx, args) => {
    const { orgId, actor } = await writeOrg(ctx);
    return await runImport(ctx, orgId, actor, args);
  },
});

/** The same import for scripts/import-books.mjs --apply (deploy key). */
export const importBooksInternal = internalMutation({
  args: { orgId: v.string(), plan: importPlanV, bank: v.optional(v.array(bankInputV)), seedOpening: v.optional(seedOpeningV) },
  handler: async (ctx, { orgId, ...args }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) throw new Error(`No studio with orgId ${orgId}.`);
    return await runImport(ctx, orgId, "books import", args);
  },
});
