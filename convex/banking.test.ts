import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { toTransactionRow } from "./lib/plaid";
import { seal } from "./lib/secretBox";
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
    const out = await handler(url.pathname, body);
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

  it("adds the fixed native callback only for iOS Link tokens", async () => {
    const s = await studio();
    const calls = stubPlaid(() => ({ link_token: "link-sandbox-x", expiration: "2030-01-01T00:00:00Z" }));
    await s.owner.action(api.banking.createLinkToken, {});
    expect(calls[0].body.redirect_uri).toBeUndefined();
    await s.owner.action(api.banking.createLinkToken, { platform: "ios" });
    expect(calls[1].body.redirect_uri).toBe("https://studiopulse.tech/plaid/oauth");
    await expect(s.manager.action(api.banking.createLinkToken, { platform: "ios" })).rejects.toThrow();
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

  it("checks back while a new bank is still pulling history, and stops once it is ready", async () => {
    // Fake timers hold every scheduled sync, so only the calls below run.
    vi.useFakeTimers();
    try {
      const s = await studio();
      const { connectionId } = await connect(s);
      // Only the check-backs carry an attempt number; the sync the connect itself schedules does not.
      const retries = async () =>
        (await s.t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect()))
          .filter((f) => f.name.includes("syncConnection") && (f.args[0] as { attempt?: number }).attempt !== undefined);

      stubPlaid((path) => path === "/accounts/get" ? accounts : path === "/transactions/sync"
        ? { added: [], modified: [], removed: [], next_cursor: "c0", has_more: false, transactions_update_status: "NOT_READY" }
        : {});
      await s.t.action(internal.banking.syncConnection, { connectionId });
      const first = await retries();
      expect(first).toHaveLength(1);
      expect(first[0].args[0]).toMatchObject({ connectionId, attempt: 1 });
      expect(first[0].scheduledTime - first[0]._creationTime).toBeGreaterThanOrEqual(59_000);

      // The tenth check-back is the last.
      await s.t.action(internal.banking.syncConnection, { connectionId, attempt: 10 });
      expect(await retries()).toHaveLength(1);

      stubPlaid((path) => path === "/accounts/get" ? accounts : path === "/transactions/sync"
        ? { added: [plaidTxn("t1", 45, "2026-09-02")], modified: [], removed: [], next_cursor: "c1", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" }
        : {});
      await s.t.action(internal.banking.syncConnection, { connectionId, attempt: 1 });
      expect(await retries()).toHaveLength(1);
      const txns = await s.t.run(async (ctx) => await ctx.db.query("bankTransactions").collect());
      expect(txns).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a posted charge replaces its pending version and keeps the match", async () => {
    const s = await studio();
    const { connectionId } = await connect(s);
    stubPlaid((path) => path === "/accounts/get" ? accounts : path === "/transactions/sync"
      ? { added: [plaidTxn("pend", 60, "2026-09-05", { pending: true })], modified: [], removed: [], next_cursor: "c1", has_more: false }
      : {});
    await s.t.action(internal.banking.syncConnection, { connectionId });
    const pending = await s.t.run(async (ctx) => await ctx.db.query("bankTransactions").first());
    await expect(s.manager.mutation(api.banking.addToBooks, { id: pending!._id, category: "supplies" })).rejects.toThrow(/Wait for this charge to post/);
    // Legacy links still migrate when a charge posts, even though new pending
    // charges can no longer be added to books before their final amount is known.
    const expenseId = await s.t.run(async (ctx) => {
      const id = await ctx.db.insert("expenses", {
        orgId: "pulse-demo", category: "supplies", amountCents: 6000,
        date: day("2026-09-05"), vendor: "Merchant", bankTransactionId: pending!._id,
      });
      await ctx.db.patch(pending!._id, { expenseId: id });
      return id;
    });

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
  it("keeps Stripe-labeled deposits in review until a payout is verified", () => {
    const row = toTransactionRow(plaidTxn("stripe-looking", -97, "2026-09-03", {
      name: "STRIPE TRANSFER",
      merchant_name: "STRIPE",
    }));
    expect(row).not.toHaveProperty("moneyInKind");
    expect(row.excluded).not.toBe(true);
  });

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
    const gig = rows.find((r) => r.plaidTransactionId === "gig")!;
    expect(rent.category).toBe("rent");
    expect(xfer).toMatchObject({ excluded: true, excludeReason: "transfer" });

    await expect(s.engineer.mutation(api.banking.addToBooks, { id: rent._id, category: "rent" })).rejects.toThrow();
    const expenseId = await s.manager.mutation(api.banking.addToBooks, { id: rent._id, category: "rent" });
    await expect(s.manager.mutation(api.banking.addToBooks, { id: rent._id, category: "rent" })).rejects.toThrow(/already in the books/);
    await expect(s.manager.mutation(api.banking.addToBooks, { id: xfer._id, category: "other" })).rejects.toThrow();
    await s.manager.mutation(api.banking.classifyMoneyIn, {
      id: gig._id,
      kind: "income",
      incomeCategory: "recording_sessions",
      note: "Walk-in session",
    });

    const pl = await s.owner.query(api.expenses.plReport, { start: day("2026-09-01"), end: day("2026-10-01") });
    expect(pl.revenueCents).toBe(150000);
    expect(pl.revenueFromBankCents).toBe(150000);
    expect(pl.byIncomeCategory).toEqual([{ category: "recording_sessions", amountCents: 150000 }]);
    expect(pl.expensesCents).toBe(30000);
    expect(pl.bank.outCents).toBe(30000);
    expect(pl.bank.inCents).toBe(150000);
    expect(pl.reconciliation.unmatchedOutflows).toBe(0);
    expect(pl.reconciliation.unmatchedInflows).toBe(0);

    const audit = await s.owner.query(api.reconcile.history, { expenseId: expenseId as Id<"expenses"> });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["expense.created_from_transaction", "match.confirmed"]));
  });

  it("matches a bank deposit to one recorded payment without counting revenue twice", async () => {
    const s = await studio();
    const date = day("2026-09-10");
    const transactionId = await s.t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId: "pulse-demo", plaidItemId: "recorded-item", institutionName: "Bank", status: "active", createdAt: date,
      });
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId: "pulse-demo", connectionId, plaidAccountId: "recorded-checking", name: "Checking",
        type: "depository", currency: "USD", balanceAsOf: date,
      });
      const artistId = await ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Nova", type: "artist", status: "active", genres: [], tags: [],
        sessionCount: 0, reliability: "solid", lifetimeValueCents: 0,
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: "pulse-demo", title: "Studio session", artistId, serviceType: "recording",
        startTime: date, endTime: date + 3_600_000, status: "completed", rateCents: 5_000,
        depositCents: 0, depositPaid: false, intakeCompleted: true,
      });
      await ctx.db.insert("payments", {
        orgId: "pulse-demo", sessionId, kind: "full", amountCents: 5_000,
        provider: "stripe", status: "paid", paidAt: date,
      });
      return ctx.db.insert("bankTransactions", {
        orgId: "pulse-demo", connectionId, accountId, plaidTransactionId: "recorded-deposit", date,
        amountCents: 5_000, direction: "in", currency: "USD", name: "Client payment", pending: false, updatedAt: date,
      });
    });

    const candidates = await s.manager.query(api.banking.moneyInCandidates, { id: transactionId });
    expect(candidates).toHaveLength(1);
    await s.manager.mutation(api.banking.classifyMoneyIn, { id: transactionId, kind: "recorded_payment" });
    const transaction = await s.t.run(async (ctx) => ctx.db.get(transactionId));
    expect(transaction).toMatchObject({
      moneyInKind: "recorded_payment", linkedRevenueType: "payment", linkedRevenueId: candidates[0].sourceId, excluded: true,
    });
    const report = await s.owner.query(api.expenses.plReport, { start: date, end: date + 86_400_000 });
    expect(report.revenueCents).toBe(5_000);
    expect(report.bank.cashInCents).toBe(5_000);

    const secondTransactionId = await s.t.run(async (ctx) => {
      const original = await ctx.db.get(transactionId);
      return ctx.db.insert("bankTransactions", {
        orgId: "pulse-demo", connectionId: original!.connectionId, accountId: original!.accountId,
        plaidTransactionId: "recorded-deposit-2", date: date + 86_400_000,
        amountCents: 5_000, direction: "in", currency: "USD", name: "Second deposit",
        pending: false, updatedAt: date + 86_400_000,
      });
    });
    expect(await s.manager.query(api.banking.moneyInCandidates, { id: secondTransactionId })).toEqual([]);
    await expect(s.manager.mutation(api.banking.classifyMoneyIn, {
      id: secondTransactionId, kind: "recorded_payment",
    })).rejects.toThrow(/No matching recorded payment/);
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

describe("bank lifecycle regressions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const emptyPage = { added: [], modified: [], removed: [], next_cursor: "c1", has_more: false };
  const bankError = (code: string, status = 500) => new Response(JSON.stringify({
    error_code: code, error_type: "API_ERROR", error_message: "Bank unavailable",
  }), { status });

  async function imported() {
    const s = await studio();
    const { connectionId } = await connect(s);
    stubPlaid((path) => path === "/accounts/get" ? accounts : {
      ...emptyPage, added: [plaidTxn("t1", 12, "2026-09-02")],
    });
    await s.t.action(internal.banking.syncConnection, { connectionId });
    return { ...s, connectionId };
  }

  it("coalesces overlapping requests and keeps a follow-up pass", async () => {
    const s = await imported();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const calls = stubPlaid(async (path) => {
      if (path === "/accounts/get") return accounts;
      entered();
      await blocked;
      return { ...emptyPage, next_cursor: "c2" };
    });
    const first = s.t.action(internal.banking.syncConnection, { connectionId: s.connectionId });
    await started;
    await s.t.action(internal.banking.syncConnection, { connectionId: s.connectionId });
    expect(calls.filter((c) => c.path === "/transactions/sync")).toHaveLength(1);
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.syncRequested).toBe(true);
    release();
    await first;
    const state = await s.t.run(async (ctx) => ({
      connection: await ctx.db.get(s.connectionId),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(state.connection).toMatchObject({ cursor: "c2", status: "active" });
    expect(state.connection?.syncStartedAt).toBeUndefined();
    // Initial connect plus the coalesced follow-up (reconciliation jobs excluded).
    expect(state.scheduled.filter((f) => f.name.includes("syncConnection"))).toHaveLength(2);
  });

  it("refuses writes from an expired worker after a newer sync finishes", async () => {
    const s = await imported();
    const old = (await s.t.mutation(internal.banking._claimSync, { connectionId: s.connectionId }))!;
    vi.setSystemTime(Date.now() + 12 * 60_000);
    const next = (await s.t.mutation(internal.banking._claimSync, { connectionId: s.connectionId }))!;
    expect(next.generation).toBeGreaterThan(old.generation);
    await s.t.mutation(internal.banking._removeTransactions, {
      connectionId: s.connectionId, generation: next.generation, plaidTransactionIds: ["t1"],
    });
    await s.t.mutation(internal.banking._finishSync, {
      connectionId: s.connectionId, generation: next.generation, cursor: "c2", added: 0, modified: 0, removed: 1,
    });
    await s.t.mutation(internal.banking._applyTransactions, {
      connectionId: s.connectionId, generation: old.generation, rows: [toTransactionRow(plaidTxn("t1", 15, "2026-09-02"))],
    });
    await s.t.mutation(internal.banking._finishSync, {
      connectionId: s.connectionId, generation: old.generation, cursor: "c1", added: 0, modified: 1, removed: 0,
    });
    await s.t.mutation(internal.banking._syncFailed, {
      connectionId: s.connectionId, generation: old.generation, status: "error", message: "late failure",
    });
    const c = await s.t.run((ctx) => ctx.db.get(s.connectionId));
    const txn = await s.t.run((ctx) => ctx.db.query("bankTransactions").first());
    expect(c).toMatchObject({ cursor: "c2", status: "active" });
    expect(txn).toMatchObject({ removed: true, amountCents: 1200 });
  });

  it("does not restore rows or report a sync after disconnect during a bank response", async () => {
    const s = await imported();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    stubPlaid(async (path) => {
      if (path === "/item/remove") return { request_id: "removed" };
      if (path === "/accounts/get") return accounts;
      entered();
      await blocked;
      return { ...emptyPage, added: [plaidTxn("late", 99, "2026-09-03")] };
    });
    const running = s.t.action(internal.banking.syncConnection, { connectionId: s.connectionId });
    await started;
    const generation = (await s.t.run((ctx) => ctx.db.get(s.connectionId)))!.syncGeneration!;
    await s.owner.action(api.banking.disconnect, { connectionId: s.connectionId, keepHistory: false });
    release();
    await running;
    await s.t.mutation(internal.banking._syncFailed, { connectionId: s.connectionId, generation, status: "error", message: "late" });
    const state = await s.t.run(async (ctx) => ({
      connection: await ctx.db.get(s.connectionId),
      accounts: await ctx.db.query("bankAccounts").collect(),
      txns: await ctx.db.query("bankTransactions").collect(),
      audit: await ctx.db.query("financeAudit").collect(),
    }));
    expect(state.connection?.status).toBe("revoked");
    expect(state.connection?.cursor).toBeUndefined();
    expect(state.accounts).toHaveLength(0);
    expect(state.txns).toHaveLength(0);
    expect(state.audit.at(-1)?.action).toBe("bank.disconnected");
  });

  it("retains credentials and history when Plaid removal fails, then allows retry", async () => {
    const s = await imported();
    stubPlaid(() => bankError("INTERNAL_SERVER_ERROR"));
    await expect(s.owner.action(api.banking.disconnect, { connectionId: s.connectionId, keepHistory: false })).rejects.toThrow(/could not be disconnected/);
    const c = await s.t.run((ctx) => ctx.db.get(s.connectionId));
    expect(c?.tokenCiphertext).toBeTruthy();
    expect(c?.status).toBe("active");
    expect(await s.t.run((ctx) => ctx.db.query("bankTransactions").collect())).toHaveLength(1);
    stubPlaid(() => ({ request_id: "removed" }));
    await s.owner.action(api.banking.disconnect, { connectionId: s.connectionId, keepHistory: true });
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.tokenCiphertext).toBeUndefined();
    expect(await s.t.run((ctx) => ctx.db.query("bankTransactions").collect())).toHaveLength(1);
  });

  it("can forget an Item Plaid has already removed", async () => {
    const s = await imported();
    stubPlaid(() => bankError("ITEM_NOT_FOUND", 400));
    await s.owner.action(api.banking.disconnect, { connectionId: s.connectionId, keepHistory: true });
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.status).toBe("revoked");
  });

  it("preserves expiry warnings across successful sync and clears them after Link", async () => {
    const s = await imported();
    await s.t.mutation(internal.banking._handleWebhook, { itemId: "item-123", type: "ITEM", code: "PENDING_DISCONNECT" });
    await s.t.action(internal.banking.syncConnection, { connectionId: s.connectionId });
    expect((await s.owner.query(api.banking.overview, {})).connections[0].status).toBe("expiring");
    await s.owner.mutation(api.banking.refresh, { connectionId: s.connectionId });
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.status).toBe("expiring");
    await s.owner.mutation(api.banking.refresh, { connectionId: s.connectionId, linkCompleted: true });
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.status).toBe("active");
  });

  it("keeps other accounts connected after account-level revocation", async () => {
    const s = await imported();
    await s.t.mutation(internal.banking._handleWebhook, {
      itemId: "item-123", type: "ITEM", code: "USER_ACCOUNT_REVOKED", accountId: "acc-card",
    });
    const c = await s.t.run((ctx) => ctx.db.get(s.connectionId));
    const view = await s.owner.query(api.banking.overview, {});
    expect(c?.tokenCiphertext).toBeTruthy();
    expect(c?.status).toBe("active");
    expect(view.cashOnHandCents).toBe(125050);
    expect(view.cardOwedCents).toBe(0);
    expect(view.connections[0].newAccountsAvailable).toBe(true);
    stubPlaid((path) => path === "/accounts/get" ? { accounts: [accounts.accounts[0]] } : emptyPage);
    await s.t.action(internal.banking.syncConnection, { connectionId: s.connectionId });
    expect((await s.owner.query(api.banking.overview, {})).cardOwedCents).toBe(0);
  });

  it("requests account selection in update mode, and clears the flag only on completion", async () => {
    const s = await imported();
    await s.t.mutation(internal.banking._handleWebhook, { itemId: "item-123", type: "ITEM", code: "NEW_ACCOUNTS_AVAILABLE" });
    const calls = stubPlaid(() => ({ link_token: "link-update", expiration: "2030-01-01" }));
    await s.owner.action(api.banking.createUpdateLinkToken, { connectionId: s.connectionId });
    expect(calls[0].body).toMatchObject({ access_token: "access-sandbox-SECRET-TOKEN", update: { account_selection_enabled: true } });
    expect(calls[0].body.products).toBeUndefined();
    expect(calls[0].body.redirect_uri).toBeUndefined();
    await s.owner.action(api.banking.createUpdateLinkToken, { connectionId: s.connectionId, platform: "ios" });
    expect(calls[1].body.redirect_uri).toBe("https://studiopulse.tech/plaid/oauth");
    expect(calls[1].body.update).toEqual({ account_selection_enabled: true });
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.newAccountsAvailable).toBe(true);
    await s.owner.mutation(api.banking.refresh, { connectionId: s.connectionId, linkCompleted: true });
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.newAccountsAvailable).toBeUndefined();
  });

  it("continues polling after the initial history arrives and stops at its bound", async () => {
    const s = await imported();
    stubPlaid((path) => path === "/accounts/get" ? accounts : { ...emptyPage, transactions_update_status: "INITIAL_UPDATE_COMPLETE" });
    await s.t.action(internal.banking.syncConnection, { connectionId: s.connectionId });
    expect((await s.t.run((ctx) => ctx.db.get(s.connectionId)))?.status).toBe("syncing");
    await s.t.action(internal.banking.syncConnection, { connectionId: s.connectionId, attempt: 10 });
    const c = await s.t.run((ctx) => ctx.db.get(s.connectionId));
    expect(c?.status).toBe("error");
    expect(c?.lastSyncError).toContain("still preparing");
    expect(c?.syncStartedAt).toBeUndefined();
  });

  it("retries only failed workspace cleanup items and surfaces an exhausted retry", async () => {
    const s = await studio();
    const ok = await seal("ok-token");
    const failed = await seal("retry-token");
    stubPlaid((_path, body) => body.access_token === "retry-token" ? bankError("INTERNAL_SERVER_ERROR") : { request_id: "ok" });
    await s.t.action(internal.banking.removeItems, { sealed: [ok, failed] });
    const jobs = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    const retry = jobs.find((f) => f.name.includes("removeItems"))!;
    expect(retry.args[0]).toEqual({ sealed: [failed], attempt: 1 });
    expect(retry.scheduledTime - retry._creationTime).toBeGreaterThanOrEqual(59_000);
    await expect(s.t.action(internal.banking.removeItems, { sealed: [failed], attempt: 5 })).rejects.toThrow(/cleanup failed/);
    const calls = stubPlaid(() => ({ request_id: "recovered" }));
    await s.t.action(internal.banking.removeItems, { sealed: [failed], attempt: 1 });
    expect(calls).toHaveLength(1);
  });

  it("cron recovers expired workers and skips live, revoked and login-required connections", async () => {
    const s = await studio();
    const ids = await s.t.run(async (ctx) => {
      const ids: Id<"bankConnections">[] = [];
      for (const status of ["active", "error", "expiring", "syncing", "syncing", "revoked", "login_required"] as const) {
        const index = ids.length;
        ids.push(await ctx.db.insert("bankConnections", {
          orgId: "pulse-demo", plaidItemId: `item-${index}`, institutionName: "Bank", status,
          tokenCiphertext: "sealed", tokenIv: "iv", createdAt: Date.now(),
          ...(status === "syncing" ? { syncStartedAt: Date.now() - (index === 3 ? 12 * 60_000 : 0) } : {}),
        }));
      }
      return ids;
    });
    await s.t.mutation(internal.banking.syncAll, {});
    const jobs = await s.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.map((f) => (f.args[0] as { connectionId: string }).connectionId)).toEqual(ids.slice(0, 4));
  });
});
