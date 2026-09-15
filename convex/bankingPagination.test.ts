import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

const DATE = Date.parse("2025-09-01T00:00:00Z");
type TransactionPage = FunctionReturnType<typeof api.banking.transactionsPage>;

async function fixture(count: number, sparse = false) {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    for (const [role, name] of [["owner", "Owner"], ["manager", "Manager"], ["engineer", "Engineer"]] as const) {
      await ctx.db.insert("members", { orgId: "pulse-demo", name, role, email: `${role}@demo.test`, skills: [], clerkUserId: role });
    }
    const connectionId = await ctx.db.insert("bankConnections", {
      orgId: "pulse-demo", plaidItemId: "private-item", institutionName: "Test Bank",
      status: "active", createdAt: DATE, connectedBy: "Owner", tokenCiphertext: "private-token", tokenIv: "private-iv",
    });
    const accountId = await ctx.db.insert("bankAccounts", {
      orgId: "pulse-demo", connectionId, plaidAccountId: "private-account", name: "Checking", type: "depository", mask: "1234", currency: "USD", balanceAsOf: DATE,
    });
    const base: Omit<Doc<"bankTransactions">, "_id" | "_creationTime"> = {
      orgId: "pulse-demo", connectionId, accountId, plaidTransactionId: "", date: DATE,
      amountCents: 540, direction: "out", currency: "USD", name: "Expense", pending: false, updatedAt: DATE,
    };
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("bankTransactions", {
        ...base, plaidTransactionId: `row-${i}`, name: i === 0 ? "Oldest studio receipt" : `Expense ${i}`,
        excluded: sparse && i !== 0,
      });
    }
    await ctx.db.insert("bankTransactions", { ...base, plaidTransactionId: "removed", removed: true });
    await ctx.db.insert("bankTransactions", { ...base, plaidTransactionId: "another-studio", orgId: "another-studio" });
    await ctx.db.insert("bankTransactions", { ...base, plaidTransactionId: "outside-period", date: DATE - 1 });
  });
  return {
    t,
    owner: t.withIdentity({ subject: "owner", name: "Owner" }),
    manager: t.withIdentity({ subject: "manager", name: "Manager" }),
    engineer: t.withIdentity({ subject: "engineer", name: "Engineer" }),
  };
}

const bounds = { start: DATE, end: DATE + 86_400_000 };

describe("bank history pagination", () => {
  it("reaches every imported row beyond 1,000 without duplicates or private data", async () => {
    const { manager } = await fixture(1205);
    const ids = new Set<string>();
    let cursor: string | null = null;
    let done = false;
    for (let pages = 0; pages < 30 && !done; pages++) {
      const result: TransactionPage = await manager.query(api.banking.transactionsPage, { ...bounds, filter: "all", paginationOpts: { cursor, numItems: 100 } });
      expect(result.page.length).toBeLessThanOrEqual(100);
      for (const row of result.page) {
        expect(ids.has(row._id)).toBe(false);
        ids.add(row._id);
      }
      expect(JSON.stringify(result.page)).not.toMatch(/private-|plaidTransactionId|tokenCiphertext|tokenIv|orgId/);
      cursor = result.continueCursor;
      done = result.isDone;
    }
    expect(done).toBe(true);
    expect(ids.size).toBe(1205);
  });

  it("continues sparse search and attention filters past an empty bounded scan", async () => {
    const { owner } = await fixture(1100, true);
    let cursor: string | null = null;
    let done = false;
    let firstPage = true;
    const names: string[] = [];
    for (let pages = 0; pages < 10 && !done; pages++) {
      const result: TransactionPage = await owner.query(api.banking.transactionsPage, {
        ...bounds, filter: "attention", search: "STUDIO RECEIPT", paginationOpts: { cursor, numItems: 50 },
      });
      if (firstPage) {
        expect(result.page).toEqual([]);
        expect(result.isDone).toBe(false);
        firstPage = false;
      }
      names.push(...result.page.map((row) => row.name));
      cursor = result.continueCursor;
      done = result.isDone;
    }
    expect(done).toBe(true);
    expect(names).toEqual(["Oldest studio receipt"]);
  });

  it("enforces financial access and rejects invalid date bounds", async () => {
    const { owner, engineer } = await fixture(1);
    await expect(engineer.query(api.banking.transactionsPage, { ...bounds, paginationOpts: { cursor: null, numItems: 50 } })).rejects.toThrow();
    await expect(owner.query(api.banking.transactionsPage, { start: DATE, end: DATE, paginationOpts: { cursor: null, numItems: 50 } })).rejects.toThrow("Choose a valid period");
  });

  it("preserves loaded boundaries when new transactions arrive and earlier rows are removed", async () => {
    const { t, owner } = await fixture(25);
    const args = { ...bounds, filter: "all" as const };
    const first = await owner.query(api.banking.transactionsPage, { ...args, paginationOpts: { cursor: null, numItems: 10 } });
    const secondArgs = { ...args, paginationOpts: { cursor: first.continueCursor, numItems: 10 } };
    const second = await owner.query(api.banking.transactionsPage, secondArgs);
    const originalIds = [...first.page, ...second.page].map((row) => row._id);
    expect(new Set(originalIds).size).toBe(20);

    // convex-helpers/react pins a loaded page's end when the next page opens.
    // That boundary must survive reactive inserts/removals; a fixed page size
    // would drop the old last row or duplicate the next page's first row.
    const firstArgs = { ...args, paginationOpts: { cursor: null, endCursor: first.continueCursor, numItems: 10 } };
    const insertedId = await t.run(async (ctx) => {
      const source = (await ctx.db.get(first.page[0]._id))!;
      return await ctx.db.insert("bankTransactions", {
        orgId: source.orgId, connectionId: source.connectionId, accountId: source.accountId,
        plaidTransactionId: "newest-import", name: "New imported charge", date: DATE + 1,
        amountCents: 1200, currency: "USD", direction: "out", pending: false, updatedAt: DATE + 1,
      });
    });
    const afterInsert = await owner.query(api.banking.transactionsPage, firstArgs);
    const secondAfterInsert = await owner.query(api.banking.transactionsPage, secondArgs);
    const insertedIds = [...afterInsert.page, ...secondAfterInsert.page].map((row) => row._id);
    expect(afterInsert.page).toHaveLength(11);
    expect(afterInsert.continueCursor).toBe(first.continueCursor);
    expect(insertedIds).toEqual([insertedId, ...originalIds]);
    expect(new Set(insertedIds).size).toBe(insertedIds.length);

    const removedIds = first.page.slice(0, 2).map((row) => row._id);
    await t.run(async (ctx) => {
      for (const id of removedIds) await ctx.db.patch(id, { removed: true });
    });
    const afterRemove = await owner.query(api.banking.transactionsPage, firstArgs);
    const secondAfterRemove = await owner.query(api.banking.transactionsPage, secondArgs);
    const remainingIds = [...afterRemove.page, ...secondAfterRemove.page].map((row) => row._id);
    expect(afterRemove.page).toHaveLength(9);
    expect(afterRemove.continueCursor).toBe(first.continueCursor);
    expect(remainingIds).toEqual(insertedIds.filter((id) => !removedIds.includes(id)));
    expect(new Set(remainingIds).size).toBe(remainingIds.length);
  });
});
