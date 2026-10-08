import { query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { ConvexError, v, type Infer } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { filter } from "convex-helpers/server/filter";
import type { Doc, Id } from "./_generated/dataModel";
import { AccessError, requireCapability, resolveViewer } from "./lib/access";
import { currentActor, currentOrgWithCapability } from "./lib/tenant";
import { financeLog } from "./lib/financeLinks";
import {
  type LedgerAccount,
  type LedgerEntry,
  type OpeningBalances,
  type Period,
  LedgerValidationError,
  assertBalancedLines,
  formatCents,
  isoDay,
  parsePeriod,
  periodKeyOf,
  toDay,
} from "./lib/ledgerMath";
import {
  type BankStatementBalance,
  type HeadlineFigures,
  type ReportedStatements,
  bankReconciliation as reconcileBank,
  buildStatements,
  impliedOpeningBalances,
  journalTotals,
} from "./lib/statements";
import {
  DEFAULT_LATE_REASON,
  checkLateDate,
  lateLedgerEntry,
  planLateEntry,
  possibleDuplicates,
  previewWithEntry,
  reversalLines,
} from "./lib/lateEntries";
import { DEFAULT_STUDIO_CHART, type ChartAccount } from "./lib/booksImport";
import {
  accountSubtypeV,
  accountTypeV,
  entryStatusV,
  importWarningV,
  lateKindV,
  normalBalanceV,
  paidFromV,
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
    ...(d.lateEntry
      ? {
          late: {
            enteredAt: d.enteredAt ?? d.createdAt,
            enteredBy: d.enteredBy ?? d.createdBy,
            reason: d.reason ?? DEFAULT_LATE_REASON,
            ...(d.lateKind ? { kind: d.lateKind } : {}),
            ...(d.counterparty ? { counterparty: d.counterparty } : {}),
            ...(d.reversalOf ? { reversalOf: d.reversalOf } : {}),
            ...(d.reversedBy ? { reversedBy: d.reversedBy } : {}),
          },
        }
      : {}),
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
    importedAt: d.importedAt,
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
      journalTotals: journalTotals(data.entries.map(toEntry), period.start, period.end),
      /** What late entries changed since the workbook was imported; null when none. */
      lateEntries: built.lateEntries,
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
  /** Late entries and their reversals only. */
  lateOnly: v.optional(v.boolean()),
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
      if (f.lateOnly && !e.lateEntry) return false;
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
  /** A late entry (or a late entry's reversal). openspec/changes/late-entries. */
  late?: {
    enteredAt: number;
    reason: string;
    kind?: "expense" | "income" | "refund";
    counterparty?: string;
    reversalOf?: Id<"journalEntries">;
  };
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
  const day = toDay(args.entryDate);
  return await ctx.db.insert("journalEntries", {
    orgId,
    entryDate: day,
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
    ...(args.late
      ? {
          lateEntry: true,
          enteredAt: args.late.enteredAt,
          effectiveDate: day,
          enteredBy: actor,
          reason: args.late.reason,
          ...(args.late.kind ? { lateKind: args.late.kind } : {}),
          ...(args.late.counterparty ? { counterparty: args.late.counterparty } : {}),
          ...(args.late.reversalOf ? { reversalOf: args.late.reversalOf } : {}),
        }
      : {}),
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
    // A late entry changed a reported month; cancelling it must leave a trail.
    if (e.lateEntry) throw new Error("Reverse a late entry instead of voiding it, so both entries stay in the books.");
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

// ── Late entries ────────────────────────────────────────────
/* A missed invoice or receipt added to a month that has ended.
   openspec/changes/late-entries. The entry goes in the way every entry does
   (createEntry as a draft, then postDraft: the helpers behind addEntry and
   postEntry), flagged late, with who, when and why. The reported statements
   are never touched. A mistake is cancelled by a reversing entry on the same
   day; both stay in the journal. Every change writes the finance audit log. */

/** Changing a past month is the owner's call: a studio owner, or an agency
 *  owner or admin acting as the studio. A manager may add ordinary entries
 *  but not rewrite a month that was already reported. */
export async function lateEntryWriter(ctx: MutationCtx): Promise<{ orgId: string; actor: string; viewerType: "agency_member" | "studio_member" }> {
  const viewer = await requireCapability(ctx, "insights.read");
  if (viewer.kind === "guest") throw new AccessError("CAPABILITY_DENIED", "Guests cannot change the books.");
  if (viewer.kind === "studio_member" && viewer.role !== "owner") {
    throw new AccessError("CAPABILITY_DENIED", "Only the studio owner can change a past month.");
  }
  if (viewer.kind === "agency_member" && viewer.role !== "owner" && viewer.role !== "admin") {
    throw new AccessError("CAPABILITY_DENIED", "Only an agency owner or admin can change a studio's past month.");
  }
  if (!viewer.orgId) throw new AccessError("NO_WORKSPACE", "Choose a studio first.");
  return { orgId: viewer.orgId, actor: await currentActor(ctx), viewerType: viewer.kind };
}

/** True when the caller may add late entries. Never throws: the UI asks. */
async function mayWriteLate(ctx: Ctx): Promise<boolean> {
  try {
    const viewer = await resolveViewer(ctx);
    if (viewer.kind === "guest" || !viewer.capabilities.has("insights.read")) return false;
    if (viewer.kind === "studio_member") return viewer.role === "owner";
    return (viewer.role === "owner" || viewer.role === "admin") && !!viewer.orgId;
  } catch {
    return false;
  }
}

const lateInputV = v.object({
  kind: lateKindV,
  entryDate: v.number(),
  counterparty: v.string(),
  amountCents: v.number(),
  accountId: v.id("ledgerAccounts"),
  paidFrom: paidFromV,
  memo: v.optional(v.string()),
  reason: v.optional(v.string()),
});

export type LateInput = Infer<typeof lateInputV>;

async function openingDates(ctx: Ctx, orgId: string): Promise<number[]> {
  return (await ctx.db.query("openingBalances").withIndex("by_org_asOf", (q) => q.eq("orgId", orgId)).take(500)).map((o) => o.asOf);
}

/** Everything one late entry needs: the date checked, the lines planned
 *  against this studio's chart, the period's books, and what may already be
 *  this item. Throws a readable Error. */
async function prepareLate(ctx: Ctx, orgId: string, periodKey: string, input: LateInput, now: number) {
  try {
    const { period, day } = checkLateDate({ periodKey, entryDate: input.entryDate, now, openingDates: await openingDates(ctx, orgId) });
    const data = await loadPeriod(ctx, orgId, period);
    const accounts = data.accounts.map(toAccount);
    const plan = planLateEntry({ ...input, entryDate: day }, accounts);
    const entries = data.entries.map(toEntry);
    const duplicates = possibleDuplicates(entries, { entryDate: day, totalCents: plan.totalCents, categoryAccountId: plan.category.id, counterparty: input.counterparty });
    return { period, day, plan, data, accounts, entries, duplicates };
  } catch (e) {
    if (e instanceof LedgerValidationError) throw new Error(e.message);
    throw e;
  }
}

async function lateAudit(
  ctx: MutationCtx,
  orgId: string,
  who: { actor: string; viewerType: "agency_member" | "studio_member" },
  a: { action: "ledger.late_entry.posted" | "ledger.late_entry.reversed"; entryId: Id<"journalEntries">; period: string; reason: string; detail: string; receiptId?: Id<"receipts">; before: unknown; after: unknown },
) {
  await financeLog(ctx, orgId, {
    action: a.action,
    actorType: "user",
    actorName: who.actor,
    ...(a.receiptId ? { receiptId: a.receiptId } : {}),
    before: a.before,
    after: a.after,
    detail: `${a.detail} (entry ${a.entryId}, ${a.period}). Reason: ${a.reason}`,
  });
  await ctx.db.insert("auditEvents", {
    orgId, viewerType: who.viewerType, viewerId: who.actor, action: a.action, resource: a.entryId, result: "allow", reason: a.reason,
  });
}

/** Rescan the month so the Accounting agent's note about it is current. Only
 *  for a month the owner already reported; the scan itself respects the
 *  studio's on/off switch and never posts. */
async function rescanReportedMonth(ctx: MutationCtx, orgId: string, periodKey: string, hasReported: boolean) {
  if (!hasReported) return;
  await ctx.scheduler.runAfter(0, internal.accountingAgent.scanOrg, { orgId, period: periodKey });
}

export type LateEntryResult = {
  entryId: Id<"journalEntries">;
  before: HeadlineFigures;
  after: HeadlineFigures;
};

/** The one path a late entry is posted by: the Books form and an approved
 *  Accounting agent suggestion both come here. The caller has already
 *  authorised the writer with lateEntryWriter. */
export async function recordLateEntry(
  ctx: MutationCtx,
  who: { orgId: string; actor: string; viewerType: "agency_member" | "studio_member" },
  args: { period: string; input: LateInput; receiptId?: Id<"receipts">; confirmPastMonth: boolean; allowDuplicate?: boolean; via: "books" | "agent" },
): Promise<LateEntryResult> {
  if (!args.confirmPastMonth) throw new Error("Confirm that you are changing a past month.");
  const now = Date.now();
  const { orgId, actor } = who;
  const prep = await prepareLate(ctx, orgId, args.period, args.input, now);
  if (prep.duplicates.length && !args.allowDuplicate) {
    const d = prep.duplicates[0];
    throw new ConvexError({
      code: "POSSIBLE_DUPLICATE",
      message: `This may already be in the books: ${d.memo}, ${isoDay(d.entryDate)}, ${formatCents(d.totalCents)} (${d.why}). Confirm it is a different charge to add it anyway.`,
    });
  }
  if (args.receiptId) {
    const r = await ctx.db.get(args.receiptId);
    if (!r || r.orgId !== orgId) throw new Error("Receipt not found.");
  }
  const { plan, day, period } = prep;
  const meta = { enteredAt: now, reason: plan.reason, kind: args.input.kind, counterparty: args.input.counterparty.trim() };
  // Through the same helpers as addEntry (draft) and postEntry (post).
  const entryId = await createEntry(ctx, orgId, actor, {
    entryDate: day,
    memo: plan.memo,
    lines: plan.lines.map((l) => ({ accountId: l.accountId as Id<"ledgerAccounts">, debitCents: l.debitCents, creditCents: l.creditCents })),
    status: "draft",
    ...(plan.paymentType ? { paymentType: { kind: plan.paymentType.kind as Infer<typeof paymentKindV>, raw: plan.paymentType.raw } } : {}),
    receiptStatus: "pending",
    source: args.via === "agent" ? "agent" : "manual",
    late: meta,
  });
  await postDraft(ctx, orgId, entryId);
  if (args.receiptId) await attachReceipt(ctx, orgId, entryId, args.receiptId);

  const { before, after } = previewWithEntry({
    period, accounts: prep.accounts, opening: toOpening(prep.data.openingDoc), entries: prep.entries,
    add: lateLedgerEntry(plan, day, { ...meta, enteredBy: actor }, entryId),
  });
  await lateAudit(ctx, orgId, who, {
    action: "ledger.late_entry.posted", entryId, period: period.key, reason: plan.reason,
    detail: `Late ${args.input.kind} added to ${period.key}${args.via === "agent" ? " from an Accounting agent suggestion" : ""}: ${plan.memo}, ${formatCents(plan.totalCents)}`,
    receiptId: args.receiptId, before, after,
  });
  await rescanReportedMonth(ctx, orgId, period.key, !!prep.data.reportedDoc);
  return { entryId, before, after };
}

/** Cancel a late entry with a reversing entry on the same day: every debit
 *  becomes a credit, so the month returns to exactly where it was. Both
 *  entries stay posted and visible, linked both ways. */
export async function reverseLate(
  ctx: MutationCtx,
  who: { orgId: string; actor: string; viewerType: "agency_member" | "studio_member" },
  args: { id: Id<"journalEntries">; reason: string; confirmPastMonth: boolean },
): Promise<LateEntryResult> {
  const { orgId, actor } = who;
  if (!args.confirmPastMonth) throw new Error("Confirm that you are changing a past month.");
  const reason = args.reason.trim();
  if (!reason) throw new Error("Say why the late entry is being reversed.");
  if (reason.length > 200) throw new Error("Keep the reason under 200 characters.");
  const e = await ctx.db.get(args.id);
  if (!e || e.orgId !== orgId) throw new Error("Entry not found.");
  if (!e.lateEntry) throw new Error("Only a late entry can be reversed here.");
  if (e.reversalOf) throw new Error("That entry is itself a reversal.");
  if (e.reversedBy) throw new Error("That late entry was already reversed.");
  if (e.status !== "posted") throw new Error("Only a posted late entry can be reversed.");
  const now = Date.now();
  const periodKey = periodKeyOf(e.entryDate);
  let period: Period;
  try {
    // A reversal lands on the original's day, so the same date rules apply.
    ({ period } = checkLateDate({ periodKey, entryDate: e.entryDate, now, openingDates: await openingDates(ctx, orgId) }));
  } catch (err) {
    throw new Error((err as Error).message);
  }
  const data = await loadPeriod(ctx, orgId, period);
  const lines = reversalLines(e.lines).map((l) => ({ accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents, ...(l.memo ? { memo: l.memo } : {}) }));
  const memo = `Reversal of late entry: ${e.memo}`.slice(0, 400);
  const reversalId = await createEntry(ctx, orgId, actor, {
    entryDate: e.entryDate,
    memo,
    lines,
    status: "draft",
    ...(e.paymentType ? { paymentType: e.paymentType } : {}),
    receiptStatus: e.receiptStatus,
    source: "manual",
    late: { enteredAt: now, reason, ...(e.lateKind ? { kind: e.lateKind } : {}), ...(e.counterparty ? { counterparty: e.counterparty } : {}), reversalOf: e._id },
  });
  await postDraft(ctx, orgId, reversalId);
  await ctx.db.patch(e._id, { reversedBy: reversalId, reversedAt: now });

  const { before, after } = previewWithEntry({
    period, accounts: data.accounts.map(toAccount), opening: toOpening(data.openingDoc), entries: data.entries.map(toEntry),
    add: { id: reversalId, entryDate: e.entryDate, memo, status: "posted", receiptStatus: e.receiptStatus, lines },
  });
  await lateAudit(ctx, orgId, who, {
    action: "ledger.late_entry.reversed", entryId: reversalId, period: period.key, reason,
    detail: `Late entry reversed in ${period.key}: ${e.memo}, ${formatCents(e.totalCents)} (original ${e._id})`,
    before, after,
  });
  await rescanReportedMonth(ctx, orgId, period.key, !!data.reportedDoc);
  return { entryId: reversalId, before, after };
}

/** Add a missed invoice or receipt to a month that has ended. */
export const addLateEntry = mutation({
  args: {
    period: v.string(),
    input: lateInputV,
    /** A receipts row (uploaded to R2 through media.prepareUpload, then receipts.attach). */
    receiptId: v.optional(v.id("receipts")),
    /** The owner saw "You are changing a past month" with the before and after. */
    confirmPastMonth: v.boolean(),
    /** The owner confirmed it is not the possible duplicate the preview showed. */
    allowDuplicate: v.optional(v.boolean()),
    /** The Accounting agent suggestion this completes, when it came from one. */
    proposalId: v.optional(v.id("opsActions")),
  },
  handler: async (ctx, args): Promise<LateEntryResult> => {
    const who = await lateEntryWriter(ctx);
    let proposal: Doc<"opsActions"> | null = null;
    if (args.proposalId) {
      proposal = await ctx.db.get(args.proposalId);
      if (!proposal || proposal.orgId !== who.orgId || proposal.type !== "acct_late_entry") throw new Error("That suggestion is not in this studio.");
      if (proposal.status !== "proposed" && proposal.status !== "snoozed") throw new Error(`That suggestion is already ${proposal.status}.`);
    }
    const out = await recordLateEntry(ctx, who, { ...args, via: proposal ? "agent" : "books" });
    if (proposal) {
      const now = Date.now();
      await ctx.db.patch(proposal._id, { status: "executed", decidedAt: now, decidedBy: who.actor, executedAt: now, result: "Added as a late entry from Books." });
      await ctx.db.insert("agentAuditLogs", { orgId: who.orgId, event: "approval.approved", detail: proposal.title, actor: who.actor, at: now });
    }
    return out;
  },
});

/** Cancel a late entry with a linked reversing entry. Nothing is deleted. */
export const reverseLateEntry = mutation({
  args: { id: v.id("journalEntries"), reason: v.string(), confirmPastMonth: v.boolean() },
  handler: async (ctx, args): Promise<LateEntryResult> => {
    const who = await lateEntryWriter(ctx);
    return await reverseLate(ctx, who, args);
  },
});

/** What adding this item would do, before anything is written: the lines,
 *  net income and cash before and after, and entries it may duplicate. A
 *  problem with the form comes back as `error`, not a throw. */
export const lateEntryPreview = query({
  args: { period: v.string(), input: lateInputV },
  handler: async (ctx, args) => {
    const orgId = await readOrg(ctx);
    let prep: Awaited<ReturnType<typeof prepareLate>>;
    try {
      prep = await prepareLate(ctx, orgId, args.period, args.input, Date.now());
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
    const { plan, day, period } = prep;
    const { before, after } = previewWithEntry({
      period, accounts: prep.accounts, opening: toOpening(prep.data.openingDoc), entries: prep.entries,
      add: lateLedgerEntry(plan, day, { enteredAt: Date.now(), enteredBy: "preview" }),
    });
    const names = new Map(prep.accounts.map((a) => [a.id, a.name]));
    return {
      ok: true as const,
      period: period.key,
      entryDate: day,
      memo: plan.memo,
      reason: plan.reason,
      totalCents: plan.totalCents,
      lines: plan.lines.map((l) => ({ accountName: names.get(l.accountId) ?? l.accountId, debitCents: l.debitCents, creditCents: l.creditCents })),
      before,
      after,
      hasReported: !!prep.data.reportedDoc,
      duplicates: prep.duplicates,
    };
  },
});

/** What reversing a late entry would do: the month's figures before and after. */
export const lateReversalPreview = query({
  args: { id: v.id("journalEntries") },
  handler: async (ctx, { id }) => {
    const orgId = await readOrg(ctx);
    const e = await ctx.db.get(id);
    if (!e || e.orgId !== orgId) return { ok: false as const, error: "Entry not found." };
    if (!e.lateEntry || e.reversalOf || e.reversedBy || e.status !== "posted") {
      return { ok: false as const, error: "Only a posted late entry that has not been reversed can be reversed." };
    }
    const period = asPeriod(periodKeyOf(e.entryDate));
    const data = await loadPeriod(ctx, orgId, period);
    const { before, after } = previewWithEntry({
      period, accounts: data.accounts.map(toAccount), opening: toOpening(data.openingDoc), entries: data.entries.map(toEntry),
      add: { id: "reversal", entryDate: e.entryDate, memo: e.memo, status: "posted", receiptStatus: e.receiptStatus, lines: reversalLines(e.lines) },
    });
    return { ok: true as const, period: period.key, memo: e.memo, totalCents: e.totalCents, before, after };
  },
});

/** May the caller add late entries, and which months count as past. */
export const lateEntryAccess = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return { canAdd: await mayWriteLate(ctx), currentMonth: periodKeyOf(now), today: toDay(now) };
  },
});

/** Open Accounting agent suggestions for late entries in a month, for the
 *  Books screen's "Review" list. Money follows permission. */
export const lateEntrySuggestions = query({
  args: { period: v.string() },
  handler: async (ctx, { period }) => {
    const orgId = await readOrg(ctx);
    const key = asPeriod(period).key;
    const rows = await ctx.db.query("opsActions").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "proposed")).take(500);
    return rows.flatMap((r) =>
      r.type === "acct_late_entry" && r.payload.kind === "late_entry" && r.payload.period === key
        ? [{ _id: r._id, title: r.title, rationale: r.rationale, payload: r.payload }]
        : [],
    );
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

  // 3. Reported statements: replace this period's workbook copy. When the
  //    figures are exactly what was already reported (a re-run of the same
  //    import), keep when they were reported: late entries count from that
  //    moment, so re-running an import must not fold them into "reported".
  const old = await ctx.db.query("reportedStatements").withIndex("by_org_period", (q) => q.eq("orgId", orgId).eq("periodStart", period.start)).take(10);
  const sameFigures = (r: Doc<"reportedStatements">) =>
    JSON.stringify([r.balanceSheet, r.incomeStatement, r.cashFlow]) === JSON.stringify([plan.reported.balanceSheet, plan.reported.incomeStatement, plan.reported.cashFlow]);
  const unchanged = old.filter(sameFigures).sort((a, b) => a.importedAt - b.importedAt)[0];
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
    importedAt: unchanged?.importedAt ?? now,
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
    const periodDocs = await ctx.db.query("journalEntries").withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("entryDate", period.start).lt("entryDate", period.end)).take(MAX_ROWS);
    // A late entry changes the month after it was reported. Re-deriving the
    // opening from the reported close would quietly absorb that change into
    // the opening balances, so an existing opening is kept once one exists.
    const hasLate = periodDocs.some((e) => e.lateEntry && e.status === "posted");
    if (existing && (hasLate || !(existing.asOf === period.start && existing.source === "implied_from_reported_close"))) {
      opening = "kept";
    } else {
      const accounts = (await loadAccounts(ctx, orgId)).map(toAccount);
      const entries = periodDocs.filter((e) => !e.lateEntry).map(toEntry);
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
