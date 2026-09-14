import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* The bank feed (openspec add-bank-sync-receipts, finance/bank-sync).
   Plaid is stubbed at fetch, so these run the real actions and mutations:
   who may connect, what is stored, how syncs apply, and what the P&L counts. */

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 7)));
const realFetch = globalThis.fetch;
const env = { ...process.env };

type PlaidHandler = (path: string, body: Record<string, unknown>) => unknown;

function stubPlaid(handler: PlaidHandler) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path: url.pathname, body });
    const out = handler(url.pathname, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

async function studio() {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    for (const [name, role, subject] of [
      ["Olu", "owner", "user_owner"],
      ["Mo", "manager", "user_manager"],
      ["Ellis", "engineer", "user_engineer"],
    ] as const) {
      await ctx.db.insert("members", { orgId: "pulse-demo", name, role, email: `${subject}@demo.com`, skills: [], clerkUserId: subject });
    }
  });
  return {
    t,
    owner: t.withIdentity({ subject: "user_owner", name: "Olu" }),
    manager: t.withIdentity({ subject: "user_manager", name: "Mo" }),
    engineer: t.withIdentity({ subject: "user_engineer", name: "Ellis" }),
  };
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function plaidTxn(id: string, amount: number, date: string, extra: Record<string, unknown> = {}) {
  return {
    transaction_id: id, account_id: "acc-checking", amount, iso_currency_code: "USD", date,
    name: `NAME ${id}`, merchant_name: `Merchant ${id}`, pending: false, pending_transaction_id: null,
    personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE" },
    ...extra,
  };
}

const accounts = {
  accounts: [
    { account_id: "acc-checking", name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", balances: { current: 1250.5, available: 1200, iso_currency_code: "USD" } },
    { account_id: "acc-card", name: "Plaid Credit Card", mask: "3333", type: "credit", subtype: "credit card", balances: { current: 410, limit: 2000, iso_currency_code: "USD" } },
  ],
};

beforeEach(() => {
  process.env.PLAID_CLIENT_ID = "client";
  process.env.PLAID_SECRET = "secret";
  process.env.PLAID_TOKEN_KEY = KEY;
  process.env.PLAID_ENV = "sandbox";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
  vi.restoreAllMocks();
});

async function connect(s: Awaited<ReturnType<typeof studio>>) {
  stubPlaid((path) => {
    if (path === "/item/public_token/exchange") return { access_token: "access-sandbox-SECRET-TOKEN", item_id: "item-123" };
    if (path === "/item/get") return { item: { item_id: "item-123", institution_id: "ins_109508" } };
    if (path === "/institutions/get_by_id") return { institution: { name: "First Platypus Bank" } };
    return {};
  });
  return await s.owner.action(api.banking.exchangePublicToken, { publicToken: "public-sandbox-abc" });
}

describe("who may touch the bank feed", () => {
  it("only an owner can start Plaid Link", async () => {
    const s = await studio();
    stubPlaid(() => ({ link_token: "link-sandbox-x", expiration: "2030-01-01T00:00:00Z" }));
    await expect(s.manager.action(api.banking.createLinkToken, {})).rejects.toThrow();
    await expect(s.engineer.action(api.banking.createLinkToken, {})).rejects.toThrow();
    const ok = await s.owner.action(api.banking.createLinkToken, {});
    expect(ok.linkToken).toBe("link-sandbox-x");
  });

  it("an engineer cannot read banking; a manager can", async () => {
    const s = await studio();
    await expect(s.engineer.query(api.banking.overview, {})).rejects.toThrow();
    const o = await s.manager.query(api.banking.overview, {});
    expect(o.canManage).toBe(false);
    expect(o.canEdit).toBe(true);
  });
});

describe("connecting", () => {
  it("stores the access token sealed and never returns it", async () => {
    const s = await studio();
    const { connectionId, institutionName } = await connect(s);
    expect(institutionName).toBe("First Platypus Bank");

    const row = await s.t.run(async (ctx) => await ctx.db.get(connectionId));
    expect(row!.tokenCiphertext).toBeTruthy();
    expect(row!.tokenCiphertext).not.toContain("SECRET-TOKEN");

    const overview = JSON.stringify(await s.owner.query(api.banking.overview, {}));
    expect(overview).not.toContain("SECRET-TOKEN");
    expect(overview).not.toContain(row!.tokenCiphertext!);
    expect(overview).not.toContain("item-123");
    expect(overview).not.toContain("cursor");

    const audit = await s.t.run(async (ctx) => await ctx.db.query("financeAudit").collect());
    expect(audit.map((a) => a.action)).toContain("bank.connected");
  });
});

describe("syncing", () => {
  it("imports accounts, balances and transactions, and a repeat changes nothing", async () => {
    const s = await studio();
    const { connectionId } = await connect(s);
    const page = {
      added: [plaidTxn("t1", 45, "2026-09-02"), plaidTxn("t2", -900, "2026-09-03", { personal_finance_category: { primary: "INCOME", detailed: "INCOME_OTHER_INCOME" } })],
      modified: [], removed: [], next_cursor: "cursor-1", has_more: false,
    };
    stubPlaid((path) => (path === "/transactions/sync" ? page : path === "/accounts/get" ? accounts : {}));
    await s.t.action(internal.banking.syncConnection, { connectionId });
    await s.t.action(internal.banking.syncConnection, { connectionId });

    const txns = await s.t.run(async (ctx) => await ctx.db.query("bankTransactions").collect());
    expect(txns).toHaveLength(2);
    const out = txns.find((x) => x.plaidTransactionId === "t1")!;
    expect(out).toMatchObject({ amountCents: 4500, direction: "out" });

    const o = await s.owner.query(api.banking.overview, {});
    expect(o.cashOnHandCents).toBe(125050);
    expect(o.cardOwedCents).toBe(41000);
    const conn = await s.t.run(async (ctx) => await ctx.db.get(connectionId));
    expect(conn!.cursor).toBe("cursor-1");
    expect(conn!.status).toBe("active");
  });

  it("a posted charge replaces its pending version and keeps the match", async () => {
    const s = await studio();
    const { connectionId } = await connect(s);
    stubPlaid((path) => path === "/accounts/get" ? accounts : path === "/transactions/sync"
      ? { added: [plaidTxn("pend", 60, "2026-09-05", { pending: true })], modified: [], removed: [], next_cursor: "c1", has_more: false }
      : {});
    await s.t.action(internal.banking.syncConnection, { connectionId });
    const pending = await s.t.run(async (ctx) => await ctx.db.query("bankTransactions").first());
    const expenseId = await s.manager.mutation(api.banking.addToBooks, { id: pending!._id, category: "supplies" });

    stubPlaid((path) => path === "/accounts/get" ? accounts : path === "/transactions/sync"
      ? { added: [plaidTxn("posted", 60, "2026-09-06", { pending_transaction_id: "pend" })], modified: [], removed: [{ transaction_id: "pend" }], next_cursor: "c2", has_more: false }
      : {});
    await s.t.action(internal.banking.syncConnection, { connectionId });

    const rows = await s.t.run(async (ctx) => await ctx.db.query("bankTransactions").collect());
    const live = rows.filter((r) => !r.removed);
    expect(live).toHaveLength(1);
    expect(live[0].plaidTransactionId).toBe("posted");
    expect(live[0].expenseId).toBe(expenseId);
    const expense = await s.t.run(async (ctx) => await ctx.db.get(expenseId as Id<"expenses">));
    expect(expense!.bankTransactionId).toBe(live[0]._id);
  });

  it("login required pauses the connection and says so", async () => {
    const s = await studio();
    const { connectionId } = await connect(s);
    stubPlaid((path) => path === "/transactions/sync"
      ? new Response(JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", error_message: "login required" }), { status: 400 })
      : {});
    await s.t.action(internal.banking.syncConnection, { connectionId });
    const conn = await s.t.run(async (ctx) => await ctx.db.get(connectionId));
    expect(conn!.status).toBe("login_required");
  });
});

describe("webhooks", () => {
  it("revoked at the bank destroys the token", async () => {
    const s = await studio();
    const { connectionId } = await connect(s);
    await s.t.mutation(internal.banking._handleWebhook, { itemId: "item-123", type: "ITEM", code: "USER_PERMISSION_REVOKED" });
    const conn = await s.t.run(async (ctx) => await ctx.db.get(connectionId));
    expect(conn!.status).toBe("revoked");
    expect(conn!.tokenCiphertext).toBeUndefined();
  });

  it("an unknown item changes nothing", async () => {
    const s = await studio();
    await connect(s);
    const res = await s.t.mutation(internal.banking._handleWebhook, { itemId: "someone-else", type: "TRANSACTIONS", code: "SYNC_UPDATES_AVAILABLE" });
    expect(res.handled).toBe(false);
  });
});

describe("the books", () => {
  it("adds an outflow once, keeps transfers out of spending, and counts it once in the P&L", async () => {
    const s = await studio();
    const { connectionId } = await connect(s);
    stubPlaid((path) => path === "/accounts/get" ? accounts : path === "/transactions/sync"
      ? {
          added: [
            plaidTxn("rent", 300, "2026-09-01", { personal_finance_category: { primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" } }),
            plaidTxn("xfer", 2000, "2026-09-02", { personal_finance_category: { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" } }),
            plaidTxn("gig", -1500, "2026-09-03", { personal_finance_category: { primary: "INCOME", detailed: "INCOME_OTHER_INCOME" } }),
          ],
          modified: [], removed: [], next_cursor: "c", has_more: false,
        }
      : {});
    await s.t.action(internal.banking.syncConnection, { connectionId });
    const rows = await s.t.run(async (ctx) => await ctx.db.query("bankTransactions").collect());
    const rent = rows.find((r) => r.plaidTransactionId === "rent")!;
    const xfer = rows.find((r) => r.plaidTransactionId === "xfer")!;
    expect(rent.category).toBe("rent");
    expect(xfer).toMatchObject({ excluded: true, excludeReason: "transfer" });

    await expect(s.engineer.mutation(api.banking.addToBooks, { id: rent._id, category: "rent" })).rejects.toThrow();
    const expenseId = await s.manager.mutation(api.banking.addToBooks, { id: rent._id, category: "rent" });
    await expect(s.manager.mutation(api.banking.addToBooks, { id: rent._id, category: "rent" })).rejects.toThrow(/already in the books/);
    await expect(s.manager.mutation(api.banking.addToBooks, { id: xfer._id, category: "other" })).rejects.toThrow();

    const pl = await s.owner.query(api.expenses.plReport, { start: day("2026-09-01"), end: day("2026-10-01") });
    expect(pl.expensesCents).toBe(30000);
    expect(pl.bank.outCents).toBe(30000);
    expect(pl.bank.inCents).toBe(150000);
    expect(pl.reconciliation.unmatchedOutflows).toBe(0);

    const audit = await s.owner.query(api.reconcile.history, { expenseId: expenseId as Id<"expenses"> });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["expense.created_from_transaction", "match.confirmed"]));
  });
});

describe("disconnecting", () => {
  it("removes the item at Plaid, destroys the token, and can delete history", async () => {
    const s = await studio();
    const { connectionId } = await connect(s);
    stubPlaid((path) => path === "/accounts/get" ? accounts : path === "/transactions/sync"
      ? { added: [plaidTxn("t1", 12, "2026-09-02")], modified: [], removed: [], next_cursor: "c", has_more: false }
      : {});
    await s.t.action(internal.banking.syncConnection, { connectionId });

    const calls = stubPlaid(() => ({ request_id: "r" }));
    await expect(s.manager.action(api.banking.disconnect, { connectionId, keepHistory: false })).rejects.toThrow();
    await s.owner.action(api.banking.disconnect, { connectionId, keepHistory: false });
    expect(calls.map((c) => c.path)).toContain("/item/remove");
    const conn = await s.t.run(async (ctx) => await ctx.db.get(connectionId));
    expect(conn).toMatchObject({ status: "revoked" });
    expect(conn!.tokenCiphertext).toBeUndefined();
    const txns = await s.t.run(async (ctx) => await ctx.db.query("bankTransactions").collect());
    expect(txns).toHaveLength(0);
  });
});

describe("sandbox helper", () => {
  it("refuses to run against production Plaid", async () => {
    const s = await studio();
    process.env.PLAID_ENV = "production";
    const calls = stubPlaid(() => ({}));
    await expect(s.t.action(internal.banking.connectSandboxForOrg, { orgId: "pulse-demo" })).rejects.toThrow(/sandbox/);
    expect(calls).toHaveLength(0);
  });
});
