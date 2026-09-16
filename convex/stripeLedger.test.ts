import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

describe("Stripe payout reconciliation", () => {
  it("matches one exact bank deposit and keeps the payout out of revenue", async () => {
    const t = convexTest(schema);
    const arrivalDate = Date.UTC(2026, 8, 14);
    const bankTransactionId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", stripeAccountId: "acct_studio",
      });
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId: "pulse-demo", plaidItemId: "item", institutionName: "Bank", status: "active", createdAt: arrivalDate,
      });
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId: "pulse-demo", connectionId, plaidAccountId: "checking", name: "Checking",
        type: "depository", currency: "USD", balanceAsOf: arrivalDate,
      });
      return ctx.db.insert("bankTransactions", {
        orgId: "pulse-demo", connectionId, accountId, plaidTransactionId: "deposit", date: arrivalDate,
        amountCents: 9_700, direction: "in", currency: "USD", name: "STRIPE PAYOUT",
        pending: false, updatedAt: arrivalDate,
      });
    });

    const args = {
      orgId: "pulse-demo",
      stripeAccountId: "acct_studio",
      stripePayoutId: "po_1",
      amountCents: 9_700,
      currency: "USD",
      status: "paid" as const,
      arrivalDate,
      reconciliationStatus: "ready" as const,
      entries: [{
        balanceTransactionId: "txn_1", type: "charge", reportingCategory: "charge",
        grossCents: 10_000, feeCents: 300, netCents: 9_700, currency: "USD", occurredAt: arrivalDate - 86_400_000,
      }],
    };
    await t.mutation(internal.stripeLedger._upsertPayout, args);
    await t.mutation(internal.stripeLedger._upsertPayout, args);

    const state = await t.run(async (ctx) => ({
      transaction: await ctx.db.get(bankTransactionId),
      payouts: await ctx.db.query("stripePayouts").collect(),
      ledger: await ctx.db.query("stripeLedgerEntries").collect(),
    }));
    expect(state.payouts).toHaveLength(1);
    expect(state.ledger).toHaveLength(1);
    expect(state.payouts[0]).toMatchObject({ reconciliationStatus: "matched", bankTransactionId });
    expect(state.transaction).toMatchObject({ moneyInKind: "stripe_payout", excluded: true });

    const report = await t.query(api.expenses.plReport, { start: 0, end: arrivalDate + 1 });
    expect(report.revenueCents).toBe(0);
    // Clearing fees are informational until a Stripe balance row is linked to
    // a Pulse sale. Unrelated connected-account activity must not alter P&L.
    expect(report.expensesCents).toBe(0);
    expect(report.stripe).toMatchObject({ grossSalesCents: 10_000, feesCents: 300, clearingNetCents: 9_700, payoutsCents: 9_700, unmatchedPayouts: 0 });
    expect(report.bank.cashInCents).toBe(9_700);
  });

  it("matches a ready payout when the bank deposit arrives later", async () => {
    const t = convexTest(schema);
    const arrivalDate = Date.UTC(2026, 8, 14);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", stripeAccountId: "acct_studio",
      });
    });
    await t.mutation(internal.stripeLedger._upsertPayout, {
      orgId: "pulse-demo", stripeAccountId: "acct_studio", stripePayoutId: "po_late",
      amountCents: 5_000, currency: "USD", status: "paid", arrivalDate,
      reconciliationStatus: "ready", entries: [],
    });
    const bankTransactionId = await t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId: "pulse-demo", plaidItemId: "item-late", institutionName: "Bank", status: "active", createdAt: arrivalDate,
      });
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId: "pulse-demo", connectionId, plaidAccountId: "checking-late", name: "Checking",
        type: "depository", currency: "USD", balanceAsOf: arrivalDate,
      });
      return ctx.db.insert("bankTransactions", {
        orgId: "pulse-demo", connectionId, accountId, plaidTransactionId: "deposit-late", date: arrivalDate,
        amountCents: 5_000, direction: "in", currency: "USD", name: "STRIPE PAYOUT",
        pending: false, updatedAt: arrivalDate,
      });
    });

    expect(await t.mutation(internal.stripeLedger.matchReadyPayouts, { orgId: "pulse-demo" })).toEqual({ matched: 1 });
    const transaction = await t.run(async (ctx) => ctx.db.get(bankTransactionId));
    expect(transaction).toMatchObject({ moneyInKind: "stripe_payout", excluded: true });
  });

  it("does not claim an unrelated same-amount deposit", async () => {
    const t = convexTest(schema);
    const arrivalDate = Date.UTC(2026, 8, 14);
    const bankTransactionId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", stripeAccountId: "acct_studio",
      });
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId: "pulse-demo", plaidItemId: "item-ach", institutionName: "Bank", status: "active", createdAt: arrivalDate,
      });
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId: "pulse-demo", connectionId, plaidAccountId: "checking-ach", name: "Checking",
        type: "depository", currency: "USD", balanceAsOf: arrivalDate,
      });
      return ctx.db.insert("bankTransactions", {
        orgId: "pulse-demo", connectionId, accountId, plaidTransactionId: "client-ach", date: arrivalDate,
        amountCents: 5_000, direction: "in", currency: "USD", name: "CLIENT ACH PAYMENT",
        pending: false, updatedAt: arrivalDate,
      });
    });
    await t.mutation(internal.stripeLedger._upsertPayout, {
      orgId: "pulse-demo", stripeAccountId: "acct_studio", stripePayoutId: "po_unverified",
      amountCents: 5_000, currency: "USD", status: "paid", arrivalDate,
      reconciliationStatus: "ready", entries: [],
    });
    const state = await t.run(async (ctx) => ({
      bank: await ctx.db.get(bankTransactionId),
      payout: await ctx.db.query("stripePayouts").withIndex("by_account_payout", (q) => q.eq("stripeAccountId", "acct_studio").eq("stripePayoutId", "po_unverified")).first(),
    }));
    expect(state.bank?.moneyInKind).toBeUndefined();
    expect(state.bank?.excluded).not.toBe(true);
    expect(state.payout).toMatchObject({ reconciliationStatus: "needs_review" });
  });
});
