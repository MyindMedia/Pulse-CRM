/* ============================================================
   Finance links: receipt, expense and bank transaction as one chain.

   Each of the three can be linked to at most one of each other kind.
   A link is written on both rows, and a new link completes the chain:
   a receipt matched to a bank line that already has an expense is
   attached to that expense too, and the reverse. That is what keeps
   the books from ever counting the same spend twice.

   Callers decide WHETHER to link (a person confirming, or the
   deterministic auto-match); these helpers only do it consistently
   and write the audit entries for every link they make.
   ============================================================ */
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Actor = { actorType: "user" | "system" | "ai"; actorName?: string };
export type LinkMeta = Actor & { score?: number; reasons?: string[]; automatic?: boolean; chained?: boolean };

type AuditEntry = Omit<Doc<"financeAudit">, "_id" | "_creationTime" | "at" | "orgId"> & { at?: number };

export async function financeLog(ctx: MutationCtx, orgId: string, entry: AuditEntry): Promise<void> {
  await ctx.db.insert("financeAudit", { orgId, at: entry.at ?? Date.now(), ...entry });
}

async function load<T extends "receipts" | "expenses" | "bankTransactions">(
  ctx: MutationCtx,
  orgId: string,
  table: T,
  id: Id<T>,
): Promise<Doc<T>> {
  const row = (await ctx.db.get(id)) as Doc<T> | null;
  if (!row || (row as unknown as { orgId: string }).orgId !== orgId) throw new ConvexError("That item is not in this studio.");
  return row;
}

function linkAction(meta: LinkMeta) {
  if (meta.chained) return "match.chained";
  return meta.automatic ? "match.auto" : "match.confirmed";
}

/** The follow-on link a match implies: same actor, no score of its own. */
function chainMeta(meta: LinkMeta): LinkMeta {
  return { actorType: meta.actorType, actorName: meta.actorName, automatic: meta.automatic, chained: true, reasons: ["completes the chain"] };
}

export async function linkReceiptExpense(
  ctx: MutationCtx, orgId: string, receiptId: Id<"receipts">, expenseId: Id<"expenses">, meta: LinkMeta,
): Promise<void> {
  const receipt = await load(ctx, orgId, "receipts", receiptId);
  const expense = await load(ctx, orgId, "expenses", expenseId);
  if (receipt.expenseId === expenseId && expense.receiptDocId === receiptId) return;
  if (receipt.expenseId && receipt.expenseId !== expenseId) throw new ConvexError("That receipt is already matched to another expense.");
  if (expense.receiptDocId && expense.receiptDocId !== receiptId) throw new ConvexError("That expense already has a receipt.");

  await ctx.db.patch(receiptId, { expenseId });
  await ctx.db.patch(expenseId, { receiptDocId: receiptId, receiptId: receipt.storageId });
  await financeLog(ctx, orgId, {
    action: linkAction(meta), actorType: meta.actorType, actorName: meta.actorName,
    receiptId, expenseId, score: meta.score, reasons: meta.reasons, detail: "receipt to expense",
  });

  const r = (await ctx.db.get(receiptId))!;
  const e = (await ctx.db.get(expenseId))!;
  if (r.bankTransactionId && !e.bankTransactionId) {
    await linkExpenseTransaction(ctx, orgId, expenseId, r.bankTransactionId, chainMeta(meta));
  } else if (e.bankTransactionId && !r.bankTransactionId) {
    await linkReceiptTransaction(ctx, orgId, receiptId, e.bankTransactionId, chainMeta(meta));
  }
}

export async function linkReceiptTransaction(
  ctx: MutationCtx, orgId: string, receiptId: Id<"receipts">, txnId: Id<"bankTransactions">, meta: LinkMeta,
): Promise<void> {
  const receipt = await load(ctx, orgId, "receipts", receiptId);
  const txn = await load(ctx, orgId, "bankTransactions", txnId);
  if (txn.direction !== "out" || txn.removed) throw new ConvexError("Receipts can only match money going out.");
  if (receipt.bankTransactionId === txnId && txn.receiptId === receiptId) return;
  if (receipt.bankTransactionId && receipt.bankTransactionId !== txnId) throw new ConvexError("That receipt is already matched to another bank line.");
  if (txn.receiptId && txn.receiptId !== receiptId) throw new ConvexError("That bank line already has a receipt.");

  await ctx.db.patch(receiptId, { bankTransactionId: txnId });
  await ctx.db.patch(txnId, { receiptId, updatedAt: Date.now() });
  await financeLog(ctx, orgId, {
    action: linkAction(meta), actorType: meta.actorType, actorName: meta.actorName,
    receiptId, bankTransactionId: txnId, score: meta.score, reasons: meta.reasons, detail: "receipt to bank line",
  });

  const r = (await ctx.db.get(receiptId))!;
  const t = (await ctx.db.get(txnId))!;
  if (t.expenseId && !r.expenseId) {
    await linkReceiptExpense(ctx, orgId, receiptId, t.expenseId, chainMeta(meta));
  } else if (r.expenseId && !t.expenseId) {
    await linkExpenseTransaction(ctx, orgId, r.expenseId, txnId, chainMeta(meta));
  }
}

export async function linkExpenseTransaction(
  ctx: MutationCtx, orgId: string, expenseId: Id<"expenses">, txnId: Id<"bankTransactions">, meta: LinkMeta,
): Promise<void> {
  const expense = await load(ctx, orgId, "expenses", expenseId);
  const txn = await load(ctx, orgId, "bankTransactions", txnId);
  if (txn.direction !== "out" || txn.removed) throw new ConvexError("Expenses can only match money going out.");
  if (expense.bankTransactionId === txnId && txn.expenseId === expenseId) return;
  if (expense.bankTransactionId && expense.bankTransactionId !== txnId) throw new ConvexError("That expense is already matched to another bank line.");
  if (txn.expenseId && txn.expenseId !== expenseId) throw new ConvexError("That bank line is already in the books.");

  await ctx.db.patch(expenseId, { bankTransactionId: txnId });
  await ctx.db.patch(txnId, { expenseId, updatedAt: Date.now() });
  await financeLog(ctx, orgId, {
    action: linkAction(meta), actorType: meta.actorType, actorName: meta.actorName,
    expenseId, bankTransactionId: txnId, score: meta.score, reasons: meta.reasons, detail: "expense to bank line",
  });

  const e = (await ctx.db.get(expenseId))!;
  const t = (await ctx.db.get(txnId))!;
  if (e.receiptDocId && !t.receiptId) {
    await linkReceiptTransaction(ctx, orgId, e.receiptDocId, txnId, chainMeta(meta));
  } else if (t.receiptId && !e.receiptDocId) {
    await linkReceiptExpense(ctx, orgId, t.receiptId, expenseId, chainMeta(meta));
  }
}

export type LinkPair =
  | { kind: "receipt_expense"; receiptId: Id<"receipts">; expenseId: Id<"expenses"> }
  | { kind: "receipt_transaction"; receiptId: Id<"receipts">; bankTransactionId: Id<"bankTransactions"> }
  | { kind: "expense_transaction"; expenseId: Id<"expenses">; bankTransactionId: Id<"bankTransactions"> };

/** Undo one link. Nothing is deleted; both sides go back to unmatched. */
export async function unlink(ctx: MutationCtx, orgId: string, pair: LinkPair, actor: Actor, detail?: string): Promise<void> {
  if (pair.kind === "receipt_expense") {
    const r = await load(ctx, orgId, "receipts", pair.receiptId);
    const e = await load(ctx, orgId, "expenses", pair.expenseId);
    if (r.expenseId !== pair.expenseId) throw new ConvexError("Those two are not matched.");
    await ctx.db.patch(pair.receiptId, { expenseId: undefined });
    await ctx.db.patch(pair.expenseId, {
      receiptDocId: undefined,
      ...(e.receiptId === r.storageId ? { receiptId: undefined } : {}),
    });
    await financeLog(ctx, orgId, { action: "match.undone", ...actor, receiptId: pair.receiptId, expenseId: pair.expenseId, detail: detail ?? "receipt to expense" });
  } else if (pair.kind === "receipt_transaction") {
    const r = await load(ctx, orgId, "receipts", pair.receiptId);
    if (r.bankTransactionId !== pair.bankTransactionId) throw new ConvexError("Those two are not matched.");
    await ctx.db.patch(pair.receiptId, { bankTransactionId: undefined });
    await ctx.db.patch(pair.bankTransactionId, { receiptId: undefined, updatedAt: Date.now() });
    await financeLog(ctx, orgId, { action: "match.undone", ...actor, receiptId: pair.receiptId, bankTransactionId: pair.bankTransactionId, detail: detail ?? "receipt to bank line" });
  } else {
    const e = await load(ctx, orgId, "expenses", pair.expenseId);
    if (e.bankTransactionId !== pair.bankTransactionId) throw new ConvexError("Those two are not matched.");
    await ctx.db.patch(pair.expenseId, { bankTransactionId: undefined });
    await ctx.db.patch(pair.bankTransactionId, { expenseId: undefined, updatedAt: Date.now() });
    await financeLog(ctx, orgId, { action: "match.undone", ...actor, expenseId: pair.expenseId, bankTransactionId: pair.bankTransactionId, detail: detail ?? "expense to bank line" });
  }
}
