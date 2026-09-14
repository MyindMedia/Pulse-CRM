import { v, ConvexError } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { currentActor, currentOrgWithCapability } from "./lib/tenant";
import {
  rankCandidates, autoLinkDecision, pairKey, type MatchSide, type MatchKind,
} from "./lib/financeMatch";
import {
  linkReceiptExpense, linkReceiptTransaction, linkExpenseTransaction, unlink, financeLog, type LinkMeta,
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

async function receiptCandidates(ctx: Ctx, orgId: string, from: number, to: number, forKind: "expense" | "transaction"): Promise<Candidate[]> {
  const rows = await ctx.db
    .query("receipts")
    .withIndex("by_org_date", (q) => q.eq("orgId", orgId).gte("date", from).lt("date", to))
    .collect();
  const out: Candidate[] = [];
  for (const r of rows) {
    const side = receiptSide(r);
    if (!side || r.status === "reading") continue;
    out.push({
      ...side, label: r.vendor ?? r.fileName, sub: r.fileName,
      matched: forKind === "expense" ? Boolean(r.expenseId) : Boolean(r.bankTransactionId),
    });
  }
  return out;
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
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const rejected = await rejectedKeys(ctx, orgId);
    const actor: LinkMeta = { actorType: "system", automatic: true };
    let linked = 0;

    const receipts = (await ctx.db.query("receipts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
      .filter((r) => r.status === "ready" && (!r.expenseId || !r.bankTransactionId))
      .slice(0, 300);

    for (const r0 of receipts) {
      const r = await ctx.db.get(r0._id);
      if (!r) continue;
      const side = receiptSide(r);
      if (!side) continue;
      if (!r.bankTransactionId) {
        const cands = await txnCandidates(ctx, orgId, r.date! - DAY, r.date! + 8 * DAY, "receipt");
        const pick = autoLinkDecision(rankCandidates(side, cands, rejected));
        if (pick) {
          await linkReceiptTransaction(ctx, orgId, r._id, pick.candidate.id as Id<"bankTransactions">, { ...actor, score: pick.score, reasons: pick.reasons });
          linked++;
        }
      }
      const fresh = (await ctx.db.get(r._id))!;
      if (!fresh.expenseId) {
        const cands = await expenseCandidates(ctx, orgId, r.date! - 7 * DAY, r.date! + 8 * DAY, "receipt");
        const pick = autoLinkDecision(rankCandidates(side, cands, rejected));
        if (pick) {
          await linkReceiptExpense(ctx, orgId, r._id, pick.candidate.id as Id<"expenses">, { ...actor, score: pick.score, reasons: pick.reasons });
          linked++;
        }
      }
    }

    const expenses = (await ctx.db.query("expenses").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect())
      .filter((e) => !e.bankTransactionId && e.date > Date.now() - 730 * DAY)
      .slice(0, 1000);
    for (const e0 of expenses) {
      const e = await ctx.db.get(e0._id);
      if (!e || e.bankTransactionId) continue;
      const side: MatchSide = { kind: "expense", id: e._id, amountCents: e.amountCents, dateMs: e.date, vendor: e.vendor ?? e.description };
      const cands = await txnCandidates(ctx, orgId, e.date - 7 * DAY, e.date + 8 * DAY, "expense");
      const pick = autoLinkDecision(rankCandidates(side, cands, rejected));
      if (pick) {
        await linkExpenseTransaction(ctx, orgId, e._id, pick.candidate.id as Id<"bankTransactions">, { ...actor, score: pick.score, reasons: pick.reasons });
        linked++;
      }
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
      if (!r.bankTransactionId) push(rankCandidates(side, await txnCandidates(ctx, orgId, r.date! - DAY, r.date! + 8 * DAY, "receipt"), rejected));
      if (!r.expenseId) push(rankCandidates(side, await expenseCandidates(ctx, orgId, r.date! - 7 * DAY, r.date! + 8 * DAY, "receipt"), rejected));
    } else if (kind === "expense") {
      const e = await ctx.db.get(id as Id<"expenses">);
      if (!e || e.orgId !== orgId) throw new ConvexError("Expense not found.");
      const side: MatchSide = { kind: "expense", id: e._id, amountCents: e.amountCents, dateMs: e.date, vendor: e.vendor ?? e.description };
      if (!e.bankTransactionId) push(rankCandidates(side, await txnCandidates(ctx, orgId, e.date - 7 * DAY, e.date + 8 * DAY, "expense"), rejected));
      if (!e.receiptDocId) push(rankCandidates(side, await receiptCandidates(ctx, orgId, e.date - 7 * DAY, e.date + 8 * DAY, "expense"), rejected));
    } else {
      const t = await ctx.db.get(id as Id<"bankTransactions">);
      if (!t || t.orgId !== orgId || t.removed || t.direction !== "out") return [];
      const mask = (await ctx.db.get(t.accountId))?.mask ?? null;
      const side: MatchSide = {
        kind: "transaction", id: t._id, amountCents: t.amountCents, dateMs: t.date, vendor: t.merchantName ?? t.name,
        direction: "out", accountMask: mask,
      };
      if (!t.expenseId) push(rankCandidates(side, await expenseCandidates(ctx, orgId, t.date - 7 * DAY, t.date + 8 * DAY, "transaction"), rejected));
      if (!t.receiptId) push(rankCandidates(side, await receiptCandidates(ctx, orgId, t.date - 8 * DAY, t.date + 2 * DAY, "transaction"), rejected));
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

/** Everything that happened to one item and the items linked to it. */
export const history = query({
  args: {
    receiptId: v.optional(v.id("receipts")),
    expenseId: v.optional(v.id("expenses")),
    bankTransactionId: v.optional(v.id("bankTransactions")),
  },
  handler: async (ctx, args) => {
    const orgId = await currentOrgWithCapability(ctx, "insights.read");
    const receiptIds = new Set<string>();
    const expenseIds = new Set<string>();
    const txnIds = new Set<string>();
    if (args.receiptId) {
      receiptIds.add(args.receiptId);
      const r = await ctx.db.get(args.receiptId);
      if (r && r.orgId === orgId) { if (r.expenseId) expenseIds.add(r.expenseId); if (r.bankTransactionId) txnIds.add(r.bankTransactionId); }
    }
    if (args.expenseId) {
      expenseIds.add(args.expenseId);
      const e = await ctx.db.get(args.expenseId);
      if (e && e.orgId === orgId) { if (e.receiptDocId) receiptIds.add(e.receiptDocId); if (e.bankTransactionId) txnIds.add(e.bankTransactionId); }
    }
    if (args.bankTransactionId) {
      txnIds.add(args.bankTransactionId);
      const t = await ctx.db.get(args.bankTransactionId);
      if (t && t.orgId === orgId) { if (t.expenseId) expenseIds.add(t.expenseId); if (t.receiptId) receiptIds.add(t.receiptId); }
    }
    const seen = new Map<string, Doc<"financeAudit">>();
    for (const id of receiptIds) {
      for (const row of await ctx.db.query("financeAudit").withIndex("by_receipt", (q) => q.eq("receiptId", id as Id<"receipts">)).collect()) seen.set(row._id, row);
    }
    for (const id of expenseIds) {
      for (const row of await ctx.db.query("financeAudit").withIndex("by_expense", (q) => q.eq("expenseId", id as Id<"expenses">)).collect()) seen.set(row._id, row);
    }
    for (const id of txnIds) {
      for (const row of await ctx.db.query("financeAudit").withIndex("by_transaction", (q) => q.eq("bankTransactionId", id as Id<"bankTransactions">)).collect()) seen.set(row._id, row);
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
