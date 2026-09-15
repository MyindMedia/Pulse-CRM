import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const date = Date.parse("2026-09-01T00:00:00Z");
afterEach(() => { vi.unstubAllEnvs(); });

async function fixture() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Studio", slug: "studio", plan: "studio", status: "active" });
    for (const [subject, name, role] of [["owner", "Olu", "owner"], ["manager", "Mo", "manager"], ["engineer", "Ellis", "engineer"]] as const) {
      await ctx.db.insert("members", { orgId: "pulse-demo", clerkUserId: subject, name, role, email: `${subject}@studio.test`, skills: [] });
    }
  });
  const owner = t.withIdentity({ subject: "owner", name: "Olu" });
  const manager = t.withIdentity({ subject: "manager", name: "Mo" });
  const engineer = t.withIdentity({ subject: "engineer", name: "Ellis" });
  const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" })));
  const uploaded = await manager.mutation(api.receipts.attach, { storageId, fileName: "supplies.jpg" });
  if (!uploaded.ok) throw new Error(uploaded.message);
  const receiptId = uploaded.receiptId;
  await t.mutation(internal.receipts._saveExtraction, {
    receiptId, model: "gpt-5-mini", vendor: "Studio Supplies", date: "2026-09-01", total: 20, confidence: 0.94,
  });
  const expenseId = await manager.mutation(api.expenses.create, { category: "supplies", vendor: "Studio Supplies", date, amountCents: 2000 });
  await manager.mutation(api.reconcile.confirm, {
    a: { kind: "receipt", id: receiptId }, b: { kind: "expense", id: expenseId }, score: 96, reasons: ["amount matches", "same vendor"],
  });
  return { t, owner, manager, engineer, storageId, receiptId, expenseId };
}

describe("permanent finance history", () => {
  it("keeps upload, AI read and confirmation evidence on an expense after unmatch and receipt deletion", async () => {
    const s = await fixture();
    const before = await s.owner.query(api.reconcile.history, { expenseId: s.expenseId });
    expect(before.find((row) => row.action === "receipt.uploaded")).toMatchObject({ actorType: "user", actorName: "Mo" });
    expect(before.find((row) => row.action === "receipt.read")).toMatchObject({
      actorType: "ai", model: "gpt-5-mini", after: { vendor: "Studio Supplies", date, totalCents: 2000, confidence: 0.94 },
    });
    expect(before.find((row) => row.action === "match.confirmed")).toMatchObject({
      actorType: "user", actorName: "Mo", score: 96, reasons: ["amount matches", "same vendor"],
    });

    await s.manager.mutation(api.reconcile.unmatch, {
      a: { kind: "receipt", id: s.receiptId }, b: { kind: "expense", id: s.expenseId },
    });
    expect((await s.t.run(async (ctx) => await ctx.db.get(s.expenseId)))!.receiptDocId).toBeUndefined();
    const unmatched = await s.owner.query(api.reconcile.history, { expenseId: s.expenseId });
    expect(unmatched.map((row) => row._id)).toEqual(expect.arrayContaining(before.map((row) => row._id)));
    expect(unmatched.some((row) => row.action === "match.undone")).toBe(true);

    await s.manager.mutation(api.receipts.remove, { id: s.receiptId });
    expect(await s.t.run(async (ctx) => await ctx.db.get(s.receiptId))).toBeNull();
    expect(await s.t.run(async (ctx) => await ctx.db.system.get(s.storageId))).toBeNull();
    const after = await s.owner.query(api.reconcile.history, { expenseId: s.expenseId });
    expect(after.map((row) => row._id)).toEqual(expect.arrayContaining(unmatched.map((row) => row._id)));
    expect(after.find((row) => row.action === "receipt.deleted")).toMatchObject({ actorName: "Mo", before: { fileName: "supplies.jpg", totalCents: 2000 } });
    expect(new Set(after.map((row) => row._id)).size).toBe(after.length);
    expect(after.map((row) => row.at)).toEqual(after.map((row) => row.at).sort((a, b) => b - a));

    // IDs in immutable events remain usable after the document is gone.
    const deletedReceiptHistory = await s.owner.query(api.reconcile.history, { receiptId: s.receiptId });
    expect(deletedReceiptHistory.map((row) => row.action)).toEqual(expect.arrayContaining([
      "receipt.uploaded", "receipt.read", "match.confirmed", "match.undone", "receipt.deleted",
    ]));
  });

  it("does not pull an old receipt's later expense history or a rejected candidate's private history", async () => {
    const s = await fixture();
    await s.manager.mutation(api.reconcile.unmatch, {
      a: { kind: "receipt", id: s.receiptId }, b: { kind: "expense", id: s.expenseId },
    });
    const laterExpenseId = await s.manager.mutation(api.expenses.create, { category: "supplies", date, amountCents: 2000 });
    await s.manager.mutation(api.reconcile.confirm, {
      a: { kind: "receipt", id: s.receiptId }, b: { kind: "expense", id: laterExpenseId },
    });
    const { unrelatedExpenseId, laterEventId, rejectedEventId } = await s.t.run(async (ctx) => {
      const unrelatedExpenseId = await ctx.db.insert("expenses", { orgId: "pulse-demo", category: "supplies", amountCents: 2000, date });
      const laterEventId = await ctx.db.insert("financeAudit", {
        orgId: "pulse-demo", at: Date.now(), action: "expense.corrected", actorType: "user", expenseId: laterExpenseId, detail: "Only belongs to the later expense",
      });
      const rejectedEventId = await ctx.db.insert("financeAudit", {
        orgId: "pulse-demo", at: Date.now(), action: "expense.corrected", actorType: "user", expenseId: unrelatedExpenseId, detail: "Only belongs to the rejected candidate",
      });
      return { unrelatedExpenseId, laterEventId, rejectedEventId };
    });
    await s.manager.mutation(api.reconcile.reject, {
      a: { kind: "expense", id: s.expenseId }, b: { kind: "transaction", id: await transaction(s.t, "pulse-demo") },
    });
    // A rejected receipt/expense pair is evidence of rejection, not of a link.
    await s.manager.mutation(api.reconcile.reject, {
      a: { kind: "receipt", id: s.receiptId }, b: { kind: "expense", id: unrelatedExpenseId },
    });
    const history = await s.owner.query(api.reconcile.history, { expenseId: s.expenseId });
    expect(history.map((row) => row.action)).toContain("receipt.read");
    expect(history.map((row) => row._id)).not.toContain(laterEventId);
    expect(history.map((row) => row._id)).not.toContain(rejectedEventId);
    const receiptHistory = await s.owner.query(api.reconcile.history, { receiptId: s.receiptId });
    expect(receiptHistory.map((row) => row._id)).toContain(laterEventId);
    expect(receiptHistory.map((row) => row._id)).not.toContain(rejectedEventId);
  });

  it("never follows foreign audit references and denies users without financial access", async () => {
    const s = await fixture();
    const foreign = await s.t.run(async (ctx) => {
      const foreignExpenseId = await ctx.db.insert("expenses", { orgId: "other-studio", category: "gear", amountCents: 8000, date });
      const unrelatedReceiptId = await ctx.db.insert("receipts", {
        orgId: "pulse-demo", storageId: s.storageId, fileName: "unrelated.jpg", fileType: "image/jpeg", sizeBytes: 4,
        uploadedBy: "Olu", uploadedAt: Date.now(), status: "ready", totalCents: 5000, date,
      });
      const unrelatedEventId = await ctx.db.insert("financeAudit", { orgId: "pulse-demo", at: Date.now(), action: "receipt.uploaded", actorType: "user", receiptId: unrelatedReceiptId });
      const foreignMatchId = await ctx.db.insert("financeAudit", {
        orgId: "other-studio", at: Date.now(), action: "match.confirmed", actorType: "user", expenseId: s.expenseId, receiptId: unrelatedReceiptId, detail: "Foreign event sharing IDs",
      });
      await ctx.db.insert("financeAudit", { orgId: "other-studio", at: Date.now(), action: "expense.corrected", actorType: "user", expenseId: foreignExpenseId });
      return { foreignExpenseId, foreignMatchId, unrelatedEventId };
    });
    const history = await s.owner.query(api.reconcile.history, { expenseId: s.expenseId });
    expect(history.map((row) => row._id)).not.toContain(foreign.foreignMatchId);
    expect(history.map((row) => row._id)).not.toContain(foreign.unrelatedEventId);
    expect(await s.owner.query(api.reconcile.history, { expenseId: foreign.foreignExpenseId })).toEqual([]);
    expect(await s.owner.query(api.reconcile.history, { expenseId: foreign.foreignExpenseId, receiptId: s.receiptId })).toEqual([]);
    await s.t.run(async (ctx) => { await ctx.db.delete(foreign.foreignExpenseId); });
    expect(await s.owner.query(api.reconcile.history, { expenseId: foreign.foreignExpenseId })).toEqual([]);
    await expect(s.engineer.query(api.reconcile.history, { expenseId: s.expenseId })).rejects.toThrow();
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.studio.test");
    vi.stubEnv("PULSE_DEMO_MODE", "0");
    await expect(s.t.query(api.reconcile.history, { expenseId: s.expenseId })).rejects.toThrow();
  });

  it("uses a chained match as permanent evidence when the live chain has been cleared", async () => {
    const s = await fixture();
    const bankTransactionId = await transaction(s.t, "pulse-demo");
    await s.manager.mutation(api.reconcile.confirm, {
      a: { kind: "expense", id: s.expenseId }, b: { kind: "transaction", id: bankTransactionId },
    });
    const rootEvents = await s.t.run(async (ctx) => await ctx.db.query("financeAudit").withIndex("by_transaction", (q) => q.eq("bankTransactionId", bankTransactionId)).collect());
    expect(rootEvents.filter((row) => row.receiptId === s.receiptId).map((row) => row.action)).toEqual(["match.chained"]);
    // Legacy cleanup can leave the immutable chain event as the only evidence.
    await s.t.run(async (ctx) => {
      await ctx.db.patch(bankTransactionId, { receiptId: undefined, expenseId: undefined });
      await ctx.db.patch(s.receiptId, { bankTransactionId: undefined, expenseId: undefined });
      await ctx.db.patch(s.expenseId, { bankTransactionId: undefined, receiptDocId: undefined, receiptId: undefined });
    });
    const history = await s.owner.query(api.reconcile.history, { bankTransactionId });
    expect(history.map((row) => row.action)).toEqual(expect.arrayContaining(["receipt.uploaded", "receipt.read", "match.chained"]));
  });
});

async function transaction(t: ReturnType<typeof convexTest>, orgId: string): Promise<Id<"bankTransactions">> {
  return await t.run(async (ctx) => {
    const connectionId = await ctx.db.insert("bankConnections", { orgId, plaidItemId: "history-test", institutionName: "Fixture Bank", status: "active", createdAt: Date.now() });
    const accountId = await ctx.db.insert("bankAccounts", { orgId, connectionId, plaidAccountId: "history-test", name: "Checking", type: "depository", currency: "USD", balanceAsOf: Date.now() });
    return await ctx.db.insert("bankTransactions", { orgId, connectionId, accountId, plaidTransactionId: "history-test", date, amountCents: 2000, direction: "out", currency: "USD", name: "Supplies", pending: false, updatedAt: Date.now() });
  });
}
