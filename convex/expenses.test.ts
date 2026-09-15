import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { plSummary, monthlyRunRateCents } from "./lib/pnl";
import type { Doc } from "./_generated/dataModel";

describe("P&L math (pure)", () => {
  it("rolls revenue + expenses into net, margin, and sorted categories", () => {
    const s = plSummary(100_000, [
      { category: "rent", amountCents: 60_000 },
      { category: "gear", amountCents: 40_000 },
      { category: "rent", amountCents: 10_000 },
    ]);
    expect(s.expensesCents).toBe(110_000);
    expect(s.netCents).toBe(-10_000);
    expect(s.marginPct).toBeCloseTo(-0.1, 5);
    expect(s.byCategory[0]).toEqual({ category: "rent", amountCents: 70_000 });
    expect(s.byCategory[1]).toEqual({ category: "gear", amountCents: 40_000 });
  });

  it("never divides by zero revenue", () => {
    expect(plSummary(0, []).marginPct).toBe(0);
  });

  it("annualizes recurring run-rate to a monthly figure", () => {
    expect(monthlyRunRateCents(12_000, "annual")).toBe(1_000);
    expect(monthlyRunRateCents(12_000, "monthly")).toBe(12_000);
    expect(monthlyRunRateCents(12_000)).toBe(0);
  });
});

describe("bank activity in the P&L", () => {
  it("keeps bank cash flow separate from profit and counts only the period's actionable records", async () => {
    const t = convexTest(schema);
    const orgId = "pulse-demo";
    const start = Date.UTC(2026, 8, 1);
    const end = Date.UTC(2026, 9, 1);
    await t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId, plaidItemId: "live", institutionName: "Test Bank", status: "active", createdAt: start,
      });
      const revokedId = await ctx.db.insert("bankConnections", {
        orgId, plaidItemId: "revoked", institutionName: "Old Bank", status: "revoked", createdAt: start,
      });
      const account = {
        orgId, connectionId, name: "Checking", type: "depository", currency: "USD", balanceAsOf: end,
      };
      const accountId = await ctx.db.insert("bankAccounts", { ...account, plaidAccountId: "checking", currentCents: 100_000 });
      await ctx.db.insert("bankAccounts", {
        ...account, plaidAccountId: "card", type: "credit", currentCents: 12_500, balanceAsOf: end - 1_000,
      });
      await ctx.db.insert("bankAccounts", { ...account, plaidAccountId: "hidden", currentCents: 999_999, hidden: true });
      await ctx.db.insert("bankAccounts", { ...account, connectionId: revokedId, plaidAccountId: "old", currentCents: 888_888 });
      await ctx.db.insert("bankAccounts", { ...account, orgId: "other", plaidAccountId: "other", currentCents: 777_777 });

      const storageId = await ctx.storage.store(new Blob(["synthetic receipt"], { type: "image/png" }));
      const bankExpenseId = await ctx.db.insert("expenses", { orgId, category: "rent", amountCents: 30_000, date: start, source: "bank" });
      const receiptExpenseId = await ctx.db.insert("expenses", {
        orgId, category: "software", amountCents: 1_000, date: start, source: "receipt", receiptId: storageId,
      });
      await ctx.db.insert("expenses", { orgId, category: "utilities", amountCents: 4_000, date: start });
      await ctx.db.insert("expenses", { orgId, category: "payroll", amountCents: 5_000, date: start });
      await ctx.db.insert("expenses", { orgId, category: "adjustment", amountCents: 500, date: start });
      await ctx.db.insert("expenses", { orgId, category: "gear", amountCents: 900_000, date: end });
      await ctx.db.insert("expenses", { orgId: "other", category: "gear", amountCents: 900_000, date: start });

      const artistId = await ctx.db.insert("artists", {
        orgId, name: "Artist", type: "artist", status: "active", genres: [], tags: [],
        sessionCount: 0, reliability: "solid", lifetimeValueCents: 0,
      });
      await ctx.db.insert("invoices", {
        orgId, artistId, number: "P&L-1", status: "paid", amountCents: 100_000,
        lineItems: [{ label: "Collected work", amountCents: 100_000 }], paidAt: start, dueDate: start,
      });

      const transaction = (plaidTransactionId: string, patch: Partial<Doc<"bankTransactions">> = {}) =>
        ctx.db.insert("bankTransactions", {
          orgId, connectionId, accountId, plaidTransactionId, date: start, amountCents: 10_000,
          direction: "out", currency: "USD", name: plaidTransactionId, pending: false, updatedAt: start, ...patch,
        });
      await transaction("rent", { amountCents: 30_000, category: "rent", expenseId: bankExpenseId });
      const waitingTransactionId = await transaction("waiting", { amountCents: 2_500 });
      await transaction("income", { amountCents: 200_000, direction: "in" });
      await transaction("transfer", { amountCents: 250_000, excluded: true, excludeReason: "transfer" });
      await transaction("card-payment", { excluded: true, excludeReason: "card_payment" });
      await transaction("loan-payment", { excluded: true, excludeReason: "loan" });
      await transaction("personal", { excluded: true, excludeReason: "personal" });
      await transaction("pending", { pending: true });
      await transaction("removed", { removed: true });
      await transaction("before-period", { date: start - 1 });
      await transaction("after-period", { date: end });
      await transaction("other-studio", { orgId: "other" });

      const receipt = {
        orgId, storageId, fileName: "test.png", fileType: "image/png", sizeBytes: 17,
        uploadedBy: "Test", uploadedAt: start, date: start, status: "ready" as const,
      };
      await ctx.db.insert("receipts", receipt);
      // A bank match alone still leaves a receipt waiting to enter the books,
      // matching the Receipt Inbox's "Waiting" count.
      await ctx.db.insert("receipts", { ...receipt, bankTransactionId: waitingTransactionId });
      await ctx.db.insert("receipts", { ...receipt, expenseId: receiptExpenseId });
      await ctx.db.insert("receipts", { ...receipt, date: undefined, status: "needs_review" });
      await ctx.db.insert("receipts", { ...receipt, status: "needs_review" });
      await ctx.db.insert("receipts", { ...receipt, date: end });
      await ctx.db.insert("receipts", { ...receipt, orgId: "other" });
    });

    const report = await t.query(api.expenses.plReport, { start, end });
    expect(report.revenueCents).toBe(100_000);
    expect(report.expensesCents).toBe(40_500);
    expect(report.netCents).toBe(59_500);
    expect(report.expenseCount).toBe(5);
    expect(report.bank).toMatchObject({
      connected: true, inCents: 200_000, outCents: 32_500, netCents: 167_500,
      cashOnHandCents: 100_000, cardOwedCents: 12_500, balanceAsOf: end - 1_000,
      outByCategory: [
        { category: "rent", amountCents: 30_000 },
        { category: "uncategorized", amountCents: 2_500 },
      ],
    });
    expect(report.reconciliation).toEqual({
      unmatchedOutflows: 1, receiptsUnmatched: 3, receiptsToBook: 2, receiptsNeedingReview: 2, expensesWithoutReceipt: 2,
    });
  });

  it("includes first and last bank dates without shifting late-night collected revenue or upload timestamps", async () => {
    const t = convexTest(schema);
    const orgId = "pulse-demo";
    const bankStart = Date.UTC(2026, 8, 1);
    const bankEnd = Date.UTC(2026, 9, 1);
    // September in America/Los_Angeles starts seven hours after its UTC date.
    const start = bankStart + 7 * 3_600_000;
    const end = bankEnd + 7 * 3_600_000;
    await t.run(async (ctx) => {
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId, plaidItemId: "calendar", institutionName: "Calendar Bank", status: "active", createdAt: start,
      });
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId, connectionId, plaidAccountId: "checking", name: "Checking", type: "depository", currency: "USD", balanceAsOf: end,
      });
      for (const date of [bankStart - 86_400_000, bankStart, bankEnd - 86_400_000, bankEnd]) {
        await ctx.db.insert("bankTransactions", {
          orgId, connectionId, accountId, plaidTransactionId: String(date), date, amountCents: 100,
          direction: "out", currency: "USD", name: "Boundary charge", pending: false, updatedAt: start,
        });
      }
      const storageId = await ctx.storage.store(new Blob(["receipt"], { type: "image/png" }));
      const receipt = {
        orgId, storageId, fileName: "date.png", fileType: "image/png", sizeBytes: 7,
        uploadedBy: "Test", uploadedAt: start, status: "ready" as const,
      };
      await ctx.db.insert("receipts", { ...receipt, date: bankStart });
      await ctx.db.insert("receipts", { ...receipt, date: bankEnd - 86_400_000 });
      await ctx.db.insert("receipts", { ...receipt, date: bankEnd });
      await ctx.db.insert("receipts", { ...receipt, uploadedAt: start - 1, status: "needs_review" });
      await ctx.db.insert("receipts", { ...receipt, uploadedAt: end - 1, status: "needs_review" });
      await ctx.db.insert("expenses", {
        orgId, category: "rent", amountCents: 100, date: bankStart + 12 * 3_600_000, source: "bank",
      });
      await ctx.db.insert("expenses", { orgId, category: "payroll", amountCents: 200, date: end - 1 });
      const artistId = await ctx.db.insert("artists", {
        orgId, name: "Artist", type: "artist", status: "active", genres: [], tags: [],
        sessionCount: 0, reliability: "solid", lifetimeValueCents: 0,
      });
      for (const paidAt of [start - 1, end - 1]) {
        await ctx.db.insert("invoices", {
          orgId, artistId, number: String(paidAt), status: "paid", amountCents: 1_000,
          lineItems: [{ label: "Work", amountCents: 1_000 }], paidAt, dueDate: start,
        });
      }
    });
    const report = await t.query(api.expenses.plReport, { start, end, bankStart, bankEnd });
    expect(report.bank.outCents).toBe(200);
    expect(report.reconciliation).toMatchObject({ receiptsUnmatched: 3, receiptsToBook: 2, receiptsNeedingReview: 1 });
    expect(report.revenueCents).toBe(1_000);
    expect(report.expensesCents).toBe(300);
    expect(report.netCents).toBe(700);
  });

  it("rejects an invalid report period instead of presenting misleading totals", async () => {
    const t = convexTest(schema);
    await expect(t.query(api.expenses.plReport, { start: 200, end: 100 })).rejects.toThrow("Choose a valid report period");
    await expect(t.query(api.expenses.plReport, { start: 100, end: 200, bankStart: 400, bankEnd: 300 })).rejects.toThrow("Choose a valid report period");
  });
});

describe("expenses backend", () => {
  it("counts a real deposit and its remaining-balance invoice consistently across months", async () => {
    const t = convexTest(schema);
    const august = Date.UTC(2026, 7, 1);
    const september = Date.UTC(2026, 8, 1);
    const october = Date.UTC(2026, 9, 1);
    const sessionId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "pulse-demo", name: "Calendar Client", type: "artist", status: "active",
        genres: [], tags: [], sessionCount: 0, reliability: "solid", lifetimeValueCents: 0,
      });
      return await ctx.db.insert("sessions", {
        orgId: "pulse-demo", title: "Deposit plus balance", artistId, serviceType: "recording",
        startTime: september, endTime: september + 3_600_000, status: "tentative",
        rateCents: 30_000, depositCents: 10_000, depositPaid: false, intakeCompleted: true,
      });
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(august + 10 * 86_400_000);
    try {
      await t.mutation(api.sessions.payDeposit, { id: sessionId });
      clock.mockReturnValue(september + 10 * 86_400_000);
      await t.mutation(api.sessions.setStatus, { id: sessionId, status: "completed" });
      const invoice = await t.run(async (ctx) => ctx.db.query("invoices").first());
      expect(invoice?.amountCents).toBe(20_000); // actual writer credits the $100 deposit
      await t.mutation(api.invoices.setStatus, { id: invoice!._id, status: "paid", paymentMethod: "cash" });

      const [augustReport, septemberReport, combined] = await Promise.all([
        t.query(api.expenses.plReport, { start: august, end: september }),
        t.query(api.expenses.plReport, { start: september, end: october }),
        t.query(api.expenses.plReport, { start: august, end: october }),
      ]);
      expect(augustReport.revenueCents).toBe(10_000);
      expect(septemberReport.revenueCents).toBe(20_000);
      expect(combined.revenueCents).toBe(30_000);
      expect(combined.revenueCents).toBe(augustReport.revenueCents + septemberReport.revenueCents);
      expect(combined.netCents).toBe(30_000);
      expect(combined.paymentsByMethod).toEqual([
        { method: "cash", amountCents: 20_000 },
        { method: "unrecorded", amountCents: 10_000 },
      ]);
    } finally {
      clock.mockRestore();
    }
  });

  it("creates + lists an expense within the org", async () => {
    const t = convexTest(schema);
    await t.mutation(api.expenses.create, {
      category: "utilities",
      amountCents: 8_000,
      date: 1_000_000,
      vendor: "Power Co",
    });
    const rows = await t.query(api.expenses.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("utilities");
    expect(rows[0].vendor).toBe("Power Co");
  });

  it("computes a P&L from paid invoices and separate booking payments", async () => {
    const t = convexTest(schema);
    const org = "pulse-demo"; // the no-identity demo viewer resolves here
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: org, name: "A", type: "artist", status: "active",
        genres: [], tags: [], sessionCount: 0, reliability: "solid", lifetimeValueCents: 0,
      } as never);
      const mk = (title: string) =>
        ctx.db.insert("sessions", {
          orgId: org, title, artistId, serviceType: "recording",
          startTime: 1_000_000, endTime: 1_010_000, status: "completed",
          rateCents: 30_000, depositCents: 0, depositPaid: false, intakeCompleted: true,
        } as never);
      // Session A: collected via a payment, NEVER invoiced -> counts via payment.
      const sessA = await mk("A");
      await ctx.db.insert("payments", {
        orgId: org, sessionId: sessA, kind: "full", amountCents: 50_000,
        provider: "stripe", status: "paid", paidAt: 1_000_000,
      });
      // Session B: a deposit and a separate invoice for the remaining balance.
      // Sharing a session does not make these two collections duplicates.
      const sessB = await mk("B");
      await ctx.db.insert("payments", {
        orgId: org, sessionId: sessB, kind: "deposit", amountCents: 9_999,
        provider: "stripe", status: "paid", paidAt: 1_000_000,
      });
      await ctx.db.insert("invoices", {
        orgId: org, number: "INV-1", artistId, sessionId: sessB, status: "paid",
        lineItems: [{ label: "session balance", amountCents: 20_001 }], amountCents: 20_001,
        dueDate: 1_000_000, paidAt: 1_000_000,
      });
      // Ad-hoc invoice, no session -> counts.
      await ctx.db.insert("invoices", {
        orgId: org, number: "INV-2", artistId, status: "paid",
        lineItems: [{ label: "mix", amountCents: 20_000 }], amountCents: 20_000,
        dueDate: 1_000_000, paidAt: 1_000_000,
      });
    });
    await t.mutation(api.expenses.create, { category: "rent", amountCents: 100_000, date: 1_000_000, recurring: "monthly" });
    await t.mutation(api.expenses.create, { category: "software", amountCents: 12_000, date: 1_000_000, recurring: "annual" });

    const pl = await t.query(api.expenses.plReport, { start: 1, end: 9_999_999_999_999 });
    expect(pl.revenueFromInvoicesCents).toBe(40_001); // remaining balance + ad-hoc invoice
    expect(pl.revenueFromPaymentsCents).toBe(59_999); // session A + session B's actual deposit
    expect(pl.revenueCents).toBe(100_000);
    expect(pl.expensesCents).toBe(112_000);
    expect(pl.netCents).toBe(-12_000);
    expect(pl.byCategory[0].category).toBe("rent");
    expect(pl.monthlyRecurringCents).toBe(101_000); // rent 100k + software 12k/12
  });

  it("does not leak another org's expenses", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("expenses", { orgId: "other-org", category: "rent", amountCents: 999_999, date: 1_000_000 });
    });
    await t.mutation(api.expenses.create, { category: "supplies", amountCents: 4_000, date: 1_000_000 });
    const rows = await t.query(api.expenses.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].category).toBe("supplies");
    const pl = await t.query(api.expenses.plReport, { start: 1, end: 9_999_999_999_999 });
    expect(pl.expensesCents).toBe(4_000); // other-org's 999,999 not included
  });
});
