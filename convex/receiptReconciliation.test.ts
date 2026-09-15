import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { linkExpenseTransaction, linkReceiptExpense, linkReceiptTransaction } from "./lib/financeLinks";

const day = Date.parse("2026-09-02T00:00:00Z");
const actor = { actorType: "system" as const, automatic: true };

async function fixture() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    const orgId = "pulse-demo";
    await ctx.db.insert("orgs", { orgId, name: "Demo", slug: "demo", plan: "studio", status: "active" });
    await ctx.db.insert("members", {
      orgId, name: "Manager", role: "manager", email: "manager@demo.com", skills: [], clerkUserId: "manager",
    });
    const connectionId = await ctx.db.insert("bankConnections", {
      orgId, plaidItemId: "item", institutionName: "Bank", status: "active", createdAt: Date.now(),
    });
    const accountId = await ctx.db.insert("bankAccounts", {
      orgId, connectionId, plaidAccountId: "account", name: "Checking", type: "depository",
      currency: "USD", balanceAsOf: Date.now(),
    });
    const receipts = [];
    const expenses = [];
    const transactions = [];
    for (let i = 0; i < 2; i++) {
      const amountCents = 999 + i * 10_000;
      const storageId = await ctx.storage.store(new Blob(["receipt"], { type: "image/jpeg" }));
      receipts.push(await ctx.db.insert("receipts", {
        orgId, storageId, fileName: "receipt.jpg", fileType: "image/jpeg", sizeBytes: 7,
        uploadedBy: "Manager", uploadedAt: Date.now(), status: "ready", vendor: "Spotify",
        date: day, totalCents: amountCents,
      }));
      expenses.push(await ctx.db.insert("expenses", {
        orgId, category: "software", vendor: "Spotify", date: day, amountCents,
      }));
      transactions.push(await ctx.db.insert("bankTransactions", {
        orgId, connectionId, accountId, plaidTransactionId: `transaction-${i}`, date: day,
        amountCents, currency: "USD", direction: "out", name: "Spotify", pending: false, updatedAt: Date.now(),
      }));
    }
    return { receipts, expenses, transactions };
  });
  return { t, manager: t.withIdentity({ subject: "manager", name: "Manager" }), ...ids };
}

describe("one receipt, expense and bank transaction per chain", () => {
  it.each(["receipt_transaction", "receipt_expense", "expense_transaction"] as const)(
    "refuses to merge conflicting %s chains without changing rows or audit",
    async (pair) => {
      const s = await fixture();
      const [r1, r2] = s.receipts;
      const [e1, e2] = s.expenses;
      const [t1, t2] = s.transactions;
      await s.t.run(async (ctx) => {
        if (pair === "receipt_transaction") {
          await linkReceiptExpense(ctx, "pulse-demo", r1, e1, actor);
          await linkExpenseTransaction(ctx, "pulse-demo", e2, t1, actor);
        } else if (pair === "receipt_expense") {
          await linkReceiptTransaction(ctx, "pulse-demo", r1, t1, actor);
          await linkExpenseTransaction(ctx, "pulse-demo", e1, t2, actor);
        } else {
          await linkReceiptExpense(ctx, "pulse-demo", r1, e1, actor);
          await linkReceiptTransaction(ctx, "pulse-demo", r2, t1, actor);
        }
      });
      const snapshot = () => s.t.run(async (ctx) => ({
        receipts: await ctx.db.query("receipts").collect(),
        expenses: await ctx.db.query("expenses").collect(),
        transactions: await ctx.db.query("bankTransactions").collect(),
        audit: await ctx.db.query("financeAudit").collect(),
      }));
      const before = await snapshot();
      const a = pair === "expense_transaction" ? { kind: "expense" as const, id: e1 } : { kind: "receipt" as const, id: r1 };
      const b = pair === "receipt_expense" ? { kind: "expense" as const, id: e1 } : { kind: "transaction" as const, id: t1 };
      await expect(s.manager.mutation(api.reconcile.confirm, { a, b })).rejects.toThrow(/different matches/);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("skips a conflicting automatic candidate and still matches an unrelated receipt", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await linkReceiptExpense(ctx, "pulse-demo", s.receipts[0], s.expenses[0], actor);
      await linkExpenseTransaction(ctx, "pulse-demo", s.expenses[1], s.transactions[0], actor);
    });
    await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
    const [first, second] = await s.t.run(async (ctx) => Promise.all(s.receipts.map((id) => ctx.db.get(id))));
    expect(first?.bankTransactionId).toBeUndefined();
    expect(second?.bankTransactionId).toBe(s.transactions[1]);
    const suggestions = await s.manager.query(api.reconcile.suggestions, { kind: "receipt", id: s.receipts[0] });
    expect(suggestions.find((candidate) => candidate.id === s.transactions[0])).toBeUndefined();
  });

  it("ignores an incompatible best score when the next candidate is a unique strong match", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await linkReceiptExpense(ctx, "pulse-demo", s.receipts[0], s.expenses[0], actor);
      await linkExpenseTransaction(ctx, "pulse-demo", s.expenses[1], s.transactions[0], actor);
      await ctx.db.patch(s.transactions[1], { amountCents: 999, date: day + 86_400_000 });
    });
    const suggestions = await s.manager.query(api.reconcile.suggestions, { kind: "receipt", id: s.receipts[0] });
    expect(suggestions.filter((candidate) => candidate.kind === "transaction").map((candidate) => candidate.id)).toEqual([s.transactions[1]]);
    await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
    expect(await s.t.run(async (ctx) => ctx.db.get(s.receipts[0]))).toMatchObject({
      expenseId: s.expenses[0], bankTransactionId: s.transactions[1],
    });
    expect((await s.t.run(async (ctx) => ctx.db.get(s.transactions[0])))?.expenseId).toBe(s.expenses[1]);
  });

  it("checks indirect links left by an undo before attaching a different bank line", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await linkReceiptExpense(ctx, "pulse-demo", s.receipts[0], s.expenses[0], actor);
      await linkExpenseTransaction(ctx, "pulse-demo", s.expenses[0], s.transactions[0], actor);
    });
    await s.manager.mutation(api.reconcile.unmatch, {
      a: { kind: "receipt", id: s.receipts[0] }, b: { kind: "transaction", id: s.transactions[0] },
    });
    await expect(s.manager.mutation(api.reconcile.confirm, {
      a: { kind: "receipt", id: s.receipts[0] }, b: { kind: "transaction", id: s.transactions[1] },
    })).rejects.toThrow(/different matches/);
    const receipt = await s.t.run(async (ctx) => ctx.db.get(s.receipts[0]));
    expect(receipt?.bankTransactionId).toBeUndefined();
    expect(receipt?.expenseId).toBe(s.expenses[0]);
  });
});

describe("receipt corrections", () => {
  it("detaches impossible old matches and can find the corrected bank amount without changing the ledger", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await linkReceiptExpense(ctx, "pulse-demo", s.receipts[0], s.expenses[0], actor);
      await linkExpenseTransaction(ctx, "pulse-demo", s.expenses[0], s.transactions[0], actor);
      await ctx.db.patch(s.transactions[1], { amountCents: 9990 });
    });
    await s.manager.mutation(api.receipts.update, { id: s.receipts[0], totalCents: 9990 });
    const corrected = await s.t.run(async (ctx) => ({
      receipt: await ctx.db.get(s.receipts[0]),
      expense: await ctx.db.get(s.expenses[0]),
      transaction: await ctx.db.get(s.transactions[0]),
      audit: await ctx.db.query("financeAudit").collect(),
    }));
    expect(corrected.receipt?.expenseId).toBeUndefined();
    expect(corrected.receipt?.bankTransactionId).toBeUndefined();
    expect(corrected.expense).toMatchObject({ amountCents: 999, bankTransactionId: s.transactions[0] });
    expect(corrected.expense?.receiptDocId).toBeUndefined();
    expect(corrected.transaction?.expenseId).toBe(s.expenses[0]);
    expect(corrected.transaction?.receiptId).toBeUndefined();
    expect(corrected.audit.filter((row) => row.action === "match.undone")).toHaveLength(2);
    expect(corrected.audit.find((row) => row.action === "receipt.corrected")).toMatchObject({
      actorName: "Manager", before: { totalCents: 999 }, after: { totalCents: 9990 },
    });
    await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
    expect((await s.t.run(async (ctx) => ctx.db.get(s.receipts[0])))?.bankTransactionId).toBe(s.transactions[1]);
  });

  it("keeps a still-compatible chain when only tax or vendor capitalization is corrected", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await linkReceiptExpense(ctx, "pulse-demo", s.receipts[0], s.expenses[0], actor);
      await linkExpenseTransaction(ctx, "pulse-demo", s.expenses[0], s.transactions[0], actor);
    });
    await s.manager.mutation(api.receipts.update, { id: s.receipts[0], vendor: "SPOTIFY", taxCents: 90 });
    expect(await s.t.run(async (ctx) => ctx.db.get(s.receipts[0]))).toMatchObject({
      expenseId: s.expenses[0], bankTransactionId: s.transactions[0], taxCents: 90,
    });
  });
});

describe("reconciliation continuation", () => {
  it("reaches a new receipt after more than 300 older receipts with no possible match", async () => {
    vi.useFakeTimers();
    try {
      const s = await fixture();
      const receiptId = await s.t.run(async (ctx) => {
        const base = (await ctx.db.get(s.receipts[0]))!;
        const { _id, _creationTime, ...fields } = base;
        void _id; void _creationTime;
        for (let i = 0; i < 305; i++) {
          await ctx.db.insert("receipts", { ...fields, totalCents: 1_000_000 + i });
        }
        await ctx.db.patch(s.transactions[0], { amountCents: 12345 });
        return await ctx.db.insert("receipts", { ...fields, totalCents: 12345 });
      });
      await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
      expect((await s.t.run(async (ctx) => ctx.db.get(receiptId)))?.bankTransactionId).toBeUndefined();
      await s.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await s.t.run(async (ctx) => ctx.db.get(receiptId)))?.bankTransactionId).toBe(s.transactions[0]);
      const pending = await s.t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(pending.every((job) => job.state.kind === "success")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues into expenses and reaches a match after more than 1000 unmatchable expenses", async () => {
    vi.useFakeTimers();
    try {
      const s = await fixture();
      const expenseId = await s.t.run(async (ctx) => {
        for (let i = 0; i < 1005; i++) {
          await ctx.db.insert("expenses", {
            orgId: "pulse-demo", category: "software", vendor: "Spotify", date: day, amountCents: 1_000_000 + i,
          });
        }
        await ctx.db.patch(s.transactions[0], { amountCents: 12345 });
        return await ctx.db.insert("expenses", {
          orgId: "pulse-demo", category: "software", vendor: "Spotify", date: day, amountCents: 12345,
        });
      });
      await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
      expect((await s.t.run(async (ctx) => ctx.db.get(expenseId)))?.bankTransactionId).toBeUndefined();
      await s.t.finishAllScheduledFunctions(vi.runAllTimers);
      expect((await s.t.run(async (ctx) => ctx.db.get(expenseId)))?.bankTransactionId).toBe(s.transactions[0]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("reciprocal automatic-match confidence", () => {
  it.each([0, -86_400_000])("leaves two competing receipts unlinked when their dates differ by %i ms", async (offset) => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await ctx.db.delete(s.expenses[0]);
      await ctx.db.delete(s.expenses[1]);
      await ctx.db.delete(s.transactions[1]);
      await ctx.db.patch(s.receipts[1], { totalCents: 999, date: day + offset });
    });
    await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
    const receipts = await s.t.run(async (ctx) => Promise.all(s.receipts.map((id) => ctx.db.get(id))));
    expect(receipts.every((receipt) => !receipt?.bankTransactionId)).toBe(true);
    expect((await s.t.run(async (ctx) => ctx.db.get(s.transactions[0])))?.receiptId).toBeUndefined();
    const suggestions = await s.manager.query(api.reconcile.suggestions, { kind: "transaction", id: s.transactions[0] });
    expect(suggestions.filter((candidate) => candidate.kind === "receipt")).toHaveLength(2);
    await s.manager.mutation(api.reconcile.confirm, {
      a: { kind: "receipt", id: s.receipts[1] }, b: { kind: "transaction", id: s.transactions[0] },
    });
    expect((await s.t.run(async (ctx) => ctx.db.get(s.transactions[0])))?.receiptId).toBe(s.receipts[1]);
  });

  it("leaves two equal expenses competing for one charge available for manual confirmation", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await ctx.db.delete(s.receipts[0]);
      await ctx.db.delete(s.receipts[1]);
      await ctx.db.delete(s.transactions[1]);
      await ctx.db.patch(s.expenses[1], { amountCents: 999 });
    });
    await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
    const expenses = await s.t.run(async (ctx) => Promise.all(s.expenses.map((id) => ctx.db.get(id))));
    expect(expenses.every((expense) => !expense?.bankTransactionId)).toBe(true);
    const suggestions = await s.manager.query(api.reconcile.suggestions, { kind: "transaction", id: s.transactions[0] });
    expect(suggestions.filter((candidate) => candidate.kind === "expense")).toHaveLength(2);
    await s.manager.mutation(api.reconcile.confirm, {
      a: { kind: "expense", id: s.expenses[1] }, b: { kind: "transaction", id: s.transactions[0] },
    });
    expect((await s.t.run(async (ctx) => ctx.db.get(s.transactions[0])))?.expenseId).toBe(s.expenses[1]);
  });

  it("does not choose arbitrarily between two receipts for the same expense", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await ctx.db.delete(s.transactions[0]);
      await ctx.db.delete(s.transactions[1]);
      await ctx.db.delete(s.expenses[1]);
      await ctx.db.patch(s.receipts[1], { totalCents: 999 });
    });
    await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
    const receipts = await s.t.run(async (ctx) => Promise.all(s.receipts.map((id) => ctx.db.get(id))));
    expect(receipts.every((receipt) => !receipt?.expenseId)).toBe(true);
  });

  it("completes the unique existing chain even when a separate receipt has the same score", async () => {
    const s = await fixture();
    await s.t.run(async (ctx) => {
      await linkReceiptExpense(ctx, "pulse-demo", s.receipts[0], s.expenses[0], actor);
      await ctx.db.patch(s.expenses[0], { bankTransactionId: s.transactions[0] });
      await ctx.db.patch(s.transactions[0], { expenseId: s.expenses[0] });
      await ctx.db.patch(s.receipts[1], { totalCents: 999 });
    });
    await s.t.mutation(internal.reconcile.autoMatch, { orgId: "pulse-demo" });
    expect(await s.t.run(async (ctx) => ctx.db.get(s.receipts[0]))).toMatchObject({
      expenseId: s.expenses[0], bankTransactionId: s.transactions[0],
    });
    expect((await s.t.run(async (ctx) => ctx.db.get(s.receipts[1])))?.bankTransactionId).toBeUndefined();
  });
});
