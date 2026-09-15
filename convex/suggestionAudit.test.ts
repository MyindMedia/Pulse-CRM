import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const date = Date.parse("2026-09-02T00:00:00Z");

async function fixture() {
  const t = convexTest(schema);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Studio", slug: "studio", plan: "studio", status: "active" });
    for (const [subject, name, role] of [["owner", "Olu", "owner"], ["manager", "Mo", "manager"], ["engineer", "Ellis", "engineer"]] as const) {
      await ctx.db.insert("members", {
        orgId: "pulse-demo", clerkUserId: subject, name, role, email: `${subject}@studio.test`, skills: [],
      });
    }
    const storageId = await ctx.storage.store(new Blob(["receipt"], { type: "image/jpeg" }));
    const receiptId = await ctx.db.insert("receipts", {
      orgId: "pulse-demo", storageId, fileName: "receipt.jpg", fileType: "image/jpeg", sizeBytes: 7,
      uploadedBy: "Mo", uploadedAt: Date.now(), status: "ready", vendor: "Spotify", date, totalCents: 2000,
    });
    // Existing audit rows need no backfill when the optional dedupe key is added.
    await ctx.db.insert("financeAudit", {
      orgId: "pulse-demo", at: Date.now(), action: "receipt.uploaded", actorType: "user", actorName: "Mo", receiptId,
    });
    const expenses = [];
    for (let i = 0; i < 5; i++) {
      expenses.push(await ctx.db.insert("expenses", {
        orgId: "pulse-demo", vendor: "Spotify", date, amountCents: 2000, category: "software",
      }));
    }
    const foreignId = await ctx.db.insert("expenses", {
      orgId: "another-studio", vendor: "Spotify", date, amountCents: 2000, category: "software",
    });
    return { receiptId, expenses, foreignId };
  });
  return {
    t, ...ids,
    manager: t.withIdentity({ subject: "manager", name: "Mo" }),
    owner: t.withIdentity({ subject: "owner", name: "Olu" }),
    engineer: t.withIdentity({ subject: "engineer", name: "Ellis" }),
  };
}

async function shownRows(s: Awaited<ReturnType<typeof fixture>>) {
  return await s.t.run(async (ctx) => (await ctx.db.query("financeAudit").collect()).filter((row) => row.action === "suggestion.shown"));
}

async function displayed(s: Awaited<ReturnType<typeof fixture>>, indexes = [0]) {
  const suggestions = await s.manager.query(api.reconcile.suggestions, { kind: "receipt", id: s.receiptId });
  return {
    kind: "receipt" as const, id: s.receiptId,
    candidates: indexes.map((index) => {
      const candidate = suggestions.find((row) => row.id === s.expenses[index])!;
      return { kind: candidate.kind, id: candidate.id, displayVersion: candidate.displayVersion };
    }),
  };
}

describe("durable suggestion display audit", () => {
  it("records exactly the displayed subset with server-derived score, reasons and item references", async () => {
    const s = await fixture();
    const args = await displayed(s, [0, 1]);
    expect(await s.manager.mutation(api.reconcile.recordSuggestionsShown, args)).toEqual({ recorded: 2 });
    const rows = await shownRows(s);
    expect(rows.map((row) => row.expenseId)).toEqual(s.expenses.slice(0, 2));
    expect(rows[0]).toMatchObject({
      receiptId: s.receiptId, actorType: "user", actorName: "Mo", score: 100,
      reasons: ["amount matches", "same day", "vendor matches"],
      after: { label: "Spotify", amountCents: 2000, date },
    });
    expect(rows[0].suggestionKey).toMatch(/^[a-f0-9]{64}$/);
    expect((await s.manager.query(api.reconcile.history, { receiptId: s.receiptId })).filter((row) => row.action === "suggestion.shown")).toHaveLength(2);
    expect((await s.manager.query(api.reconcile.history, { expenseId: s.expenses[0] })).filter((row) => row.action === "suggestion.shown")).toHaveLength(1);
    // Clients cannot provide a forged score or reasons, even alongside valid IDs.
    await expect(s.manager.mutation(api.reconcile.recordSuggestionsShown, {
      ...args, candidates: [{ ...args.candidates[0], score: 1, reasons: ["forged"] }],
    } as never)).rejects.toThrow();
    expect(await shownRows(s)).toHaveLength(2);
  });

  it("deduplicates rerenders, repeated candidates, remounts and concurrent requests", async () => {
    const s = await fixture();
    const shown = await displayed(s);
    const candidate = shown.candidates[0];
    const args = { ...shown, candidates: [candidate, candidate] };
    await Promise.all([
      s.manager.mutation(api.reconcile.recordSuggestionsShown, args),
      s.manager.mutation(api.reconcile.recordSuggestionsShown, args),
    ]);
    expect(await s.manager.mutation(api.reconcile.recordSuggestionsShown, { ...args, candidates: [candidate] })).toEqual({ recorded: 0 });
    expect(await shownRows(s)).toHaveLength(1);
  });

  it("attributes another viewer separately and records a changed suggestion version once", async () => {
    const s = await fixture();
    const args = await displayed(s);
    await s.manager.mutation(api.reconcile.recordSuggestionsShown, args);
    await s.owner.mutation(api.reconcile.recordSuggestionsShown, args);
    expect((await shownRows(s)).map((row) => row.actorName).sort()).toEqual(["Mo", "Olu"]);
    await s.t.run(async (ctx) => ctx.db.patch(s.expenses[0], { date: date + 86_400_000, vendor: "SPOTIFY" }));
    // Same IDs are insufficient: the earlier render did not display the changed values.
    expect(await s.manager.mutation(api.reconcile.recordSuggestionsShown, args)).toEqual({ recorded: 0 });
    const updated = await displayed(s);
    expect(updated.candidates[0].displayVersion).not.toBe(args.candidates[0].displayVersion);
    expect(await s.manager.mutation(api.reconcile.recordSuggestionsShown, updated)).toEqual({ recorded: 1 });
    expect(await s.manager.mutation(api.reconcile.recordSuggestionsShown, updated)).toEqual({ recorded: 0 });
    const rows = await shownRows(s);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ actorName: "Mo", score: 95, after: { label: "SPOTIFY", date: date + 86_400_000 } });
  });

  it("refuses foreign IDs, wrong-kind IDs and users without financial read access", async () => {
    const s = await fixture();
    const args = await displayed(s);
    await expect(s.engineer.mutation(api.reconcile.recordSuggestionsShown, args)).rejects.toThrow();
    await expect(s.manager.mutation(api.reconcile.recordSuggestionsShown, { ...args, candidates: [{ kind: "expense", id: s.foreignId, displayVersion: "forged" }] })).rejects.toThrow();
    await expect(s.manager.mutation(api.reconcile.recordSuggestionsShown, { ...args, kind: "expense", id: s.foreignId })).rejects.toThrow();
    await expect(s.manager.mutation(api.reconcile.recordSuggestionsShown, { ...args, candidates: [{ kind: "transaction", id: s.expenses[0], displayVersion: "forged" }] })).rejects.toThrow();
    expect(await shownRows(s)).toHaveLength(0);
  });

  it("ignores stale rejected or no-longer-eligible candidates", async () => {
    const s = await fixture();
    const args = await displayed(s, [0, 1]);
    await s.manager.mutation(api.reconcile.reject, {
      a: { kind: "receipt", id: s.receiptId }, b: { kind: "expense", id: s.expenses[0] },
    });
    await s.t.run(async (ctx) => ctx.db.patch(s.expenses[1], { amountCents: 50_000 }));
    expect(await s.manager.mutation(api.reconcile.recordSuggestionsShown, args)).toEqual({ recorded: 0 });
    expect(await shownRows(s)).toHaveLength(0);
  });

  it("accepts the Banking view's direction without expanding a suggestion into a historical match", async () => {
    const s = await fixture();
    const transactionId = await s.t.run(async (ctx) => {
      for (const id of s.expenses) await ctx.db.delete(id);
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId: "pulse-demo", plaidItemId: "item", institutionName: "Bank", status: "active", createdAt: Date.now(),
      });
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId: "pulse-demo", connectionId, plaidAccountId: "account", name: "Checking", type: "depository",
        currency: "USD", balanceAsOf: Date.now(),
      });
      return await ctx.db.insert("bankTransactions", {
        orgId: "pulse-demo", connectionId, accountId, plaidTransactionId: "charge", date, amountCents: 2000,
        currency: "USD", direction: "out", name: "Spotify", pending: false, updatedAt: Date.now(),
      });
    });
    const [candidate] = await s.manager.query(api.reconcile.suggestions, { kind: "transaction", id: transactionId });
    await s.manager.mutation(api.reconcile.recordSuggestionsShown, {
      kind: "transaction", id: transactionId,
      candidates: [{ kind: "receipt", id: s.receiptId, displayVersion: candidate.displayVersion }],
    });
    const history = await s.manager.query(api.reconcile.history, { bankTransactionId: transactionId });
    expect(history.map((row) => row.action)).toEqual(["suggestion.shown"]);
  });
});
