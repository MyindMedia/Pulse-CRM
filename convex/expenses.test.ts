import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { plSummary, monthlyRunRateCents } from "./lib/pnl";

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

describe("expenses backend", () => {
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

  it("computes a P&L: paid invoices + non-invoiced session payments, de-duped", async () => {
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
      // Session B: billed by a paid invoice + ALSO has a payment -> counts ONCE
      // (via the invoice); the payment is de-duped out.
      const sessB = await mk("B");
      await ctx.db.insert("payments", {
        orgId: org, sessionId: sessB, kind: "deposit", amountCents: 9_999,
        provider: "stripe", status: "paid", paidAt: 1_000_000,
      });
      await ctx.db.insert("invoices", {
        orgId: org, number: "INV-1", artistId, sessionId: sessB, status: "paid",
        lineItems: [{ label: "session", amountCents: 30_000 }], amountCents: 30_000,
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
    expect(pl.revenueFromInvoicesCents).toBe(50_000); // 30k session-linked + 20k ad-hoc
    expect(pl.revenueFromPaymentsCents).toBe(50_000); // session A only; session B's 9,999 de-duped
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
