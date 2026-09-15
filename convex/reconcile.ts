import { v, ConvexError } from "convex/values";
import { paginator } from "convex-helpers/server/pagination";
import schema from "./schema";
import { internal } from "./_generated/api";
import { query, type QueryCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { currentActor, currentOrgWithCapability } from "./lib/tenant";
import {
  rankCandidates, autoLinkDecision, pairKey, type MatchSide, type MatchKind,
} from "./lib/financeMatch";
import {
  linkReceiptExpense, linkReceiptTransaction, linkExpenseTransaction, unlink, financeLog, canJoinFinanceChain, type LinkMeta, type FinanceChainCache,
} from "./lib/financeLinks";

/* ============================================================
   Reconciliation - receipts, expenses and bank lines, matched.
   openspec/changes/add-bank-sync-receipts (finance/reconciliation).

   Scoring is lib/financeMatch (plain code, no AI, no bank data
   leaves Pulse). autoMatch runs after a bank sync and after a
   receipt is read or corrected; it links only confident, unambiguous
   pairs and labels them automatic. Everything else is a suggestion a
   person confirms or rejects. Unmatching remembers the pair so it is
   never proposed again. Every step lands in financeAudit.
   ============================================================ */

const DAY = 86_400_000;
type Ctx = QueryCtx;

type Candidate = MatchSide & { label: string; sub?: string };

async function rejectedKeys(ctx: Ctx, orgId: string): Promise<Set<string>> {
  const rows = await ctx.db.query("financeMatchRejections").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
  return new Set(rows.map((r) => r.key));
}

function receiptSide(r: Doc<"receipts">): MatchSide | null {
  if (r.totalCents === undefined || r.date === undefined) return null;
  return {
    kind: "receipt", id: r._id, amountCents: r.totalCents, dateMs: r.date, vendor: r.vendor, last4: r.cardLast4,
    matched: false,
  };
}

async function rankCompatibleCandidates(ctx: Ctx, orgId: string, side: MatchSide, candidates: Candidate[], rejected: Set<string>) {
  // This cache lives only through one read pass. A later link may change these rows.
  const cache: FinanceChainCache = new Map();
  const keyFor = { receipt: "receiptId", expense: "expenseId", transaction: "bankTransactionId" } as const;
  const compatible: Candidate[] = [];
  for (const candidate of candidates) {
    if (await canJoinFinanceChain(ctx, orgId, {
      [keyFor[side.kind]]: side.id, [keyFor[candidate.kind]]: candidate.id,
    }, cache)) compatible.push(candidate);
  }
  return rankCandidates(side, compatible, rejected);
}

async function txnCandidates(ctx: Ctx, orgId: string, from: number, to: number, forKind: "receipt" | "expense"): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("bankTransactions")
    .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", from).lt("date", to))
    .collect();
  const masks = new Map<string, string | null>();
  const out: Candidate[] = [];
  for (const t of rows) {
    if (t.removed || t.excluded || t.direction !== "out") continue;
    if (!masks.has(t.accountId)) masks.set(t.accountId, (await ctx.db.get(t.accountId))?.mask ?? null);
    out.push({
      kind: "transaction", id: t._id, amountCents: t.amountCents, dateMs: t.date, vendor: t.merchantName ?? t.name,
      direction: "out", accountMask: masks.get(t.accountId), label: t.merchantName ?? t.name,
      sub: t.pending ? "pending" : undefined,
      matched: forKind === "receipt" ? Boolean(t.receiptId) : Boolean(t.expenseId),
    });
  }
  return out;
}

async function expenseCandidates(ctx: Ctx, orgId: string, from: number, to: number, forKind: "receipt" | "transaction"): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("expenses")
    .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", from).lt("date", to))
    .collect();
  return rows.map((e) => ({
    kind: "expense" as const, id: e._id, amountCents: e.amountCents, dateMs: e.date, vendor: e.vendor ?? e.description,
    label: e.vendor ?? e.description ?? e.category, sub: e.category,
    matched: forKind === "receipt" ? Boolean(e.receiptDocId) : Boolean(e.bankTransactionId),
  }));
}

async function receiptCandidates(ctx: Ctx, orgId: string, from: number, to: number, forKind: "expense" | "transaction", readyOnly = false): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("receipts")
    .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", from).lt("date", to))
    .collect();
  const out: Candidate[] = [];
  for (const r of rows) {
    const side = receiptSide(r);
    if (!side || r.status === "reading" || (readyOnly && r.status !== "ready")) continue;
    out.push({
      ...side, label: r.vendor ?? r.fileName, sub: r.fileName,
      matched: forKind === "expense" ? Boolean(r.expenseId) : Boolean(r.bankTransactionId),
    });
  }
  return out;
}

/** A charge or expense must also prefer this source over its other eligible sources. */
async function isReciprocalMatch(ctx: Ctx, orgId: string, source: MatchSide, target: Candidate, rejected: Set<string>): Promise<boolean> {
  const targetDay = Math.floor(target.dateMs / DAY) * DAY;
  const from = targetDay - 7 * DAY;
  const to = targetDay + (target.kind === "transaction" ? 2 : 8) * DAY;
  let candidates: Candidate[];
  if (source.kind === "receipt" && target.kind !== "receipt") {
    candidates = await receiptCandidates(ctx, orgId, from, to, target.kind, true);
  } else if (source.kind === "expense" && target.kind === "transaction") {
    candidates = await expenseCandidates(ctx, orgId, from, to, "transaction");
  } else {
    return false;
  }
  const reverse = autoLinkDecision(await rankCompatibleCandidates(ctx, orgId, target, candidates, rejected));
  return reverse?.candidate.kind === source.kind && reverse.candidate.id === source.id;
}

async function link(ctx: Parameters<typeof linkReceiptExpense>[0], orgId: string, a: { kind: MatchKind; id: string }, b: { kind: MatchKind; id: string }, meta: LinkMeta) {
  const pair = [a, b].sort((x, y) => x.kind.localeCompare(y.kind));
  const [first, second] = pair;
  if (first.kind === "expense" && second.kind === "receipt") {
    return linkReceiptExpense(ctx, orgId, second.id as Id<"receipts">, first.id as Id<"expenses">, meta);
  }
  if (first.kind === "receipt" && second.kind === "transaction") {
    return linkReceiptTransaction(ctx, orgId, first.id as Id<"receipts">, second.id as Id<"bankTransactions">, meta);
  }
  if (first.kind === "expense" && second.kind === "transaction") {
    return linkExpenseTransaction(ctx, orgId, first.id as Id<"expenses">, second.id as Id<"bankTransactions">, meta);
  }
  throw new ConvexError("Those two can't be matched.");
}

/** Link every confident, unambiguous pair in the studio. Idempotent. */
export const autoMatch = internalMutation({
  args: {
    orgId: v.string(),
    phase: v.optional(v.union(v.literal("receipts"), v.literal("expenses"))),
    cursor: v.optional(v.string()),
    expenseSince: v.optional(v.number()),
  },
  returns: v.object({ linked: v.number() }),
  handler: async (ctx, { orgId, phase, cursor, expenseSince }) => {
    const rejected = await rejectedKeys(ctx, orgId);
    const actor: LinkMeta = { actorType: "system", automatic: true };
    let linked = 0;
    const since = expenseSince ?? Date.now() - 730 * DAY;
    // Helper pagination supports both phases in one small pass and stable continuation.
    const reader = paginator(ctx.db, schema);
    const receiptPage = phase !== "expenses"
      ? await reader.query("receipts").withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", "ready"))
        .paginate({ cursor: cursor ?? null, numItems: 100 })
      : null;

    for (const r0 of receiptPage?.page ?? []) {
      const r = await ctx.db.get(r0._id);
      if (!r || (r.expenseId && r.bankTransactionId)) continue;
      const side = receiptSide(r);
      if (!side) continue;
      if (!r.bankTransactionId) {
        const cands = await txnCandidates(ctx, orgId, r.date! - DAY, r.date! + 8 * DAY, "receipt");
        const pick = autoLinkDecision(await rankCompatibleCandidates(ctx, orgId, side, cands, rejected));
        if (pick && await isReciprocalMatch(ctx, orgId, side, pick.candidate, rejected)) {
          await linkReceiptTransaction(ctx, orgId, r._id, pick.candidate.id as Id<"bankTransactions">, { ...actor, score: pick.score, reasons: pick.reasons });
          linked++;
        }
      }
      const fresh = (await ctx.db.get(r._id))!;
      if (!fresh.expenseId) {
        const cands = await expenseCandidates(ctx, orgId, r.date! - 7 * DAY, r.date! + 8 * DAY, "receipt");
        const pick = autoLinkDecision(await rankCompatibleCandidates(ctx, orgId, side, cands, rejected));
        if (pick && await isReciprocalMatch(ctx, orgId, side, pick.candidate, rejected)) {
          await linkReceiptExpense(ctx, orgId, r._id, pick.candidate.id as Id<"expenses">, { ...actor, score: pick.score, reasons: pick.reasons });
          linked++;
        }
      }
    }

    if (receiptPage && !receiptPage.isDone) {
      await ctx.scheduler.runAfter(0, internal.reconcile.autoMatch, {
        orgId, phase: "receipts", cursor: receiptPage.continueCursor, expenseSince: since,
      });
      return { linked };
    }
    const expensePage = await reader.query("expenses")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gt("date", since))
      .paginate({ cursor: phase === "expenses" ? cursor ?? null : null, numItems: 100 });
    for (const e0 of expensePage.page) {
      const e = await ctx.db.get(e0._id);
      if (!e || e.bankTransactionId) continue;
      const side: MatchSide = { kind: "expense", id: e._id, amountCents: e.amountCents, dateMs: e.date, vendor: e.vendor ?? e.description };
      const cands = await txnCandidates(ctx, orgId, e.date - 7 * DAY, e.date + 8 * DAY, "expense");
      const pick = autoLinkDecision(await rankCompatibleCandidates(ctx, orgId, side, cands, rejected));
      if (pick && await isReciprocalMatch(ctx, orgId, side, pick.candidate, rejected)) {
        await linkExpenseTransaction(ctx, orgId, e._id, pick.candidate.id as Id<"bankTransactions">, { ...actor, score: pick.score, reasons: pick.reasons });
        linked++;
      }
    }
    if (!expensePage.isDone) {
      await ctx.scheduler.runAfter(0, internal.reconcile.autoMatch, {
        orgId, phase: "expenses", cursor: expensePage.continueCursor, expenseSince: since,
      });
    }
    return { linked };
  },
});

const kindV = v.union(v.literal("receipt"), v.literal("expense"), v.literal("transaction"));

const TABLE_FOR: Record<MatchKind, "receipts" | "expenses" | "bankTransactions"> = {
  receipt: "receipts", expense: "expenses", transaction: "bankTransactions",
};

/** A client-supplied reference, proven to be a row of that kind in this studio. */
async function ownedRef(ctx: QueryCtx, orgId: string, ref: { kind: MatchKind; id: string }) {
  const table = TABLE_FOR[ref.kind];
  const id = ctx.db.normalizeId(table, ref.id);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || (row as { orgId?: string }).orgId !== orgId) throw new ConvexError("That item is not in this studio.");
  return { kind: ref.kind, id: id as string };
}

/** Suggested counterparts for one item, best first. */
export const suggestions = query({
  args: { kind: kindV, id: v.string() },
  handler: async (ctx, { kind, id: rawId }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const { id } = await ownedRef(ctx, orgId, { kind, id: rawId });
    const rejected = await rejectedKeys(ctx, orgId);
    const out: Array<{ kind: MatchKind; id: string; label: string; sub?: string; amountCents: number; dateMs: number; score: number; reasons: string[]; alreadyMatched: boolean }> = [];
    const push = (ranked: ReturnType<typeof rankCandidates<Candidate>>) => {
      for (const r of ranked.slice(0, 5)) {
        out.push({
          kind: r.candidate.kind, id: r.candidate.id, label: r.candidate.label, sub: r.candidate.sub,
          amountCents: r.candidate.amountCents, dateMs: r.candidate.dateMs, score: r.score, reasons: r.reasons,
          alreadyMatched: Boolean(r.candidate.matched),
        });
      }
    };

    if (kind === "receipt") {
      const r = await ctx.db.get(id as Id<"receipts">);
      if (!r || r.orgId !== orgId) throw new ConvexError("Receipt not found.");
      const side = receiptSide(r);
      if (!side) return [];
      if (!r.bankTransactionId) push(await rankCompatibleCandidates(ctx, orgId, side, await txnCandidates(ctx, orgId, r.date! - DAY, r.date! + 8 * DAY, "receipt"), rejected));
      if (!r.expenseId) push(await rankCompatibleCandidates(ctx, orgId, side, await expenseCandidates(ctx, orgId, r.date! - 7 * DAY, r.date! + 8 * DAY, "receipt"), rejected));
    } else if (kind === "expense") {
      const e = await ctx.db.get(id as Id<"expenses">);
      if (!e || e.orgId !== orgId) throw new ConvexError("Expense not found.");
      const side: MatchSide = { kind: "expense", id: e._id, amountCents: e.amountCents, dateMs: e.date, vendor: e.vendor ?? e.description };
      if (!e.bankTransactionId) push(await rankCompatibleCandidates(ctx, orgId, side, await txnCandidates(ctx, orgId, e.date - 7 * DAY, e.date + 8 * DAY, "expense"), rejected));
      if (!e.receiptDocId) push(await rankCompatibleCandidates(ctx, orgId, side, await receiptCandidates(ctx, orgId, e.date - 7 * DAY, e.date + 8 * DAY, "expense"), rejected));
    } else {
      const t = await ctx.db.get(id as Id<"bankTransactions">);
      if (!t || t.orgId !== orgId || t.removed || t.direction !== "out") return [];
      const mask = (await ctx.db.get(t.accountId))?.mask ?? null;
      const side: MatchSide = {
        kind: "transaction", id: t._id, amountCents: t.amountCents, dateMs: t.date, vendor: t.merchantName ?? t.name,
        direction: "out", accountMask: mask,
      };
      if (!t.expenseId) push(await rankCompatibleCandidates(ctx, orgId, side, await expenseCandidates(ctx, orgId, t.date - 7 * DAY, t.date + 8 * DAY, "transaction"), rejected));
      if (!t.receiptId) push(await rankCompatibleCandidates(ctx, orgId, side, await receiptCandidates(ctx, orgId, t.date - 8 * DAY, t.date + 2 * DAY, "transaction"), rejected));
    }
    return out.sort((a, b) => b.score - a.score);
  },
});

const refV = v.object({ kind: kindV, id: v.string() });

export const confirm = mutation({
  args: { a: refV, b: refV, score: v.optional(v.number()), reasons: v.optional(v.array(v.string())) },
  handler: async (ctx, { a: rawA, b: rawB, score, reasons }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const a = await ownedRef(ctx, orgId, rawA);
    const b = await ownedRef(ctx, orgId, rawB);
    await link(ctx, orgId, a, b, { actorType: "user", actorName: await currentActor(ctx), score, reasons });
  },
});

export const reject = mutation({
  args: { a: refV, b: refV },
  handler: async (ctx, { a: rawA, b: rawB }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const a = await ownedRef(ctx, orgId, rawA);
    const b = await ownedRef(ctx, orgId, rawB);
    if (a.kind === b.kind) throw new ConvexError("Those two can't be matched.");
    const key = pairKey(a.kind, a.id, b.kind, b.id);
    const existing = await ctx.db.query("financeMatchRejections").withIndex("by_org_key", (q) => q.eq("orgId", orgId).eq("key", key)).first();
    if (!existing) await ctx.db.insert("financeMatchRejections", { orgId, key, at: Date.now() });
    await financeLog(ctx, orgId, {
      action: "suggestion.rejected", actorType: "user", actorName: await currentActor(ctx),
      ...ids(a), ...ids(b), detail: key,
    });
  },
});

function ids(ref: { kind: MatchKind; id: string }) {
  if (ref.kind === "receipt") return { receiptId: ref.id as Id<"receipts"> };
  if (ref.kind === "expense") return { expenseId: ref.id as Id<"expenses"> };
  return { bankTransactionId: ref.id as Id<"bankTransactions"> };
}

/** Undo a link. Remembers the pair so it is never suggested again. */
export const unmatch = mutation({
  args: { a: refV, b: refV },
  handler: async (ctx, { a: rawA, b: rawB }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    const a = await ownedRef(ctx, orgId, rawA);
    const b = await ownedRef(ctx, orgId, rawB);
    const actor = { actorType: "user" as const, actorName: await currentActor(ctx) };
    const kinds = [a.kind, b.kind].sort().join("+");
    const get = (k: MatchKind) => (a.kind === k ? a.id : b.id);
    if (kinds === "expense+receipt") {
      await unlink(ctx, orgId, { kind: "receipt_expense", receiptId: get("receipt") as Id<"receipts">, expenseId: get("expense") as Id<"expenses"> }, actor);
    } else if (kinds === "receipt+transaction") {
      await unlink(ctx, orgId, { kind: "receipt_transaction", receiptId: get("receipt") as Id<"receipts">, bankTransactionId: get("transaction") as Id<"bankTransactions"> }, actor);
    } else if (kinds === "expense+transaction") {
      await unlink(ctx, orgId, { kind: "expense_transaction", expenseId: get("expense") as Id<"expenses">, bankTransactionId: get("transaction") as Id<"bankTransactions"> }, actor);
    } else {
      throw new ConvexError("Those two can't be matched.");
    }
    const key = pairKey(a.kind, a.id, b.kind, b.id);
    const existing = await ctx.db.query("financeMatchRejections").withIndex("by_org_key", (q) => q.eq("orgId", orgId).eq("key", key)).first();
    if (!existing) await ctx.db.insert("financeMatchRejections", { orgId, key, at: Date.now() });
  },
});

/** Everything that happened to one item and its current or former counterparts. */
export const history = query({
  args: {
    receiptId: v.optional(v.id("receipts")),
    expenseId: v.optional(v.id("expenses")),
    bankTransactionId: v.optional(v.id("bankTransactions")),
  },
  returns: v.array(v.object({
    _id: v.id("financeAudit"), at: v.number(), action: v.string(),
    actorType: v.union(v.literal("user"), v.literal("system"), v.literal("ai")),
    actorName: v.union(v.string(), v.null()), score: v.union(v.number(), v.null()),
    reasons: v.array(v.string()), model: v.union(v.string(), v.null()),
    before: v.any(), after: v.any(), detail: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const receiptIds = new Set<string>();
    const expenseIds = new Set<string>();
    const txnIds = new Set<string>();
    const seen = new Map<string, Doc<"financeAudit">>();
    const loaded = new Set<string>();
    const readEvents = async (receiptId?: Id<"receipts">, expenseId?: Id<"expenses">, txnId?: Id<"bankTransactions">) => {
      const id = receiptId ?? expenseId ?? txnId;
      if (!id || loaded.has(id)) return;
      loaded.add(id);
      const rows = receiptId
        ? await ctx.db.query("financeAudit").withIndex("by_receipt", (q) => q.eq("receiptId", receiptId)).collect()
        : expenseId
          ? await ctx.db.query("financeAudit").withIndex("by_expense", (q) => q.eq("expenseId", expenseId)).collect()
          : await ctx.db.query("financeAudit").withIndex("by_transaction", (q) => q.eq("bankTransactionId", txnId!)).collect();
      // Check the tenant before using audit references as relationship evidence.
      for (const row of rows) if (row.orgId === orgId) seen.set(row._id, row);
    };
    if (args.receiptId) {
      receiptIds.add(args.receiptId);
      const r = await ctx.db.get(args.receiptId);
      if (r && r.orgId !== orgId) return [];
      if (r && r.orgId === orgId) { if (r.expenseId) expenseIds.add(r.expenseId); if (r.bankTransactionId) txnIds.add(r.bankTransactionId); }
      await readEvents(args.receiptId);
    }
    if (args.expenseId) {
      expenseIds.add(args.expenseId);
      const e = await ctx.db.get(args.expenseId);
      if (e && e.orgId !== orgId) return [];
      if (e && e.orgId === orgId) { if (e.receiptDocId) receiptIds.add(e.receiptDocId); if (e.bankTransactionId) txnIds.add(e.bankTransactionId); }
      await readEvents(undefined, args.expenseId);
    }
    if (args.bankTransactionId) {
      txnIds.add(args.bankTransactionId);
      const t = await ctx.db.get(args.bankTransactionId);
      if (t && t.orgId !== orgId) return [];
      if (t && t.orgId === orgId) { if (t.expenseId) expenseIds.add(t.expenseId); if (t.receiptId) receiptIds.add(t.receiptId); }
      await readEvents(undefined, undefined, args.bankTransactionId);
    }
    // Links on live documents are intentionally cleared by unmatch/delete.
    // The root item's immutable match events retain its former counterparts,
    // including a deleted receipt whose upload and extraction still explain it.
    // Expand once from the requested items only: a receipt's later expense must
    // not recursively pull that expense's unrelated history into the old one.
    for (const row of [...seen.values()]) {
      if (!["match.auto", "match.confirmed", "match.chained", "match.undone", "expense.created_from_receipt", "expense.created_from_transaction"].includes(row.action)) continue;
      if (row.receiptId) receiptIds.add(row.receiptId);
      if (row.expenseId) expenseIds.add(row.expenseId);
      if (row.bankTransactionId) txnIds.add(row.bankTransactionId);
    }
    for (const id of receiptIds) {
      await readEvents(id as Id<"receipts">);
    }
    for (const id of expenseIds) {
      await readEvents(undefined, id as Id<"expenses">);
    }
    for (const id of txnIds) {
      await readEvents(undefined, undefined, id as Id<"bankTransactions">);
    }
    return [...seen.values()]
      .filter((row) => row.orgId === orgId)
      .sort((a, b) => b.at - a.at)
      .map((row) => ({
        _id: row._id, at: row.at, action: row.action, actorType: row.actorType, actorName: row.actorName ?? null,
        score: row.score ?? null, reasons: row.reasons ?? [], model: row.model ?? null,
        before: row.before ?? null, after: row.after ?? null, detail: row.detail ?? null,
      }));
  },
});

/** The studio-wide finance log, newest first (bank syncs, connections, everything). */
export const recentActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const rows = await ctx.db.query("financeAudit").withIndex("by_org_at", (q) => q.eq("orgId", orgId)).order("desc").take(Math.min(limit ?? 50, 200));
    return rows.map((row) => ({
      _id: row._id, at: row.at, action: row.action, actorType: row.actorType, actorName: row.actorName ?? null,
      detail: row.detail ?? null, score: row.score ?? null,
    }));
  },
});
