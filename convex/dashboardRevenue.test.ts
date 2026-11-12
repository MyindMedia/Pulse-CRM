import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Truth audit B3 (money-reporting-money-came-in): "How much money came in:
   the month's total, whether it is going up or down." The dashboard tile,
   its trend and the revenue chart counted paid invoices only, so deposits and
   pay-in-full bookings (the payments ledger), packages, memberships and bank
   income were missing. A studio paid in full at booking saw almost nothing.
   They now count what Reports > Financials counts. */

const ORG = "pulse-demo";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("dashboard revenue counts every collection", () => {
  let t: ReturnType<typeof convexTest>;
  let artistId: Id<"artists">;
  let sessionId: Id<"sessions">;

  beforeEach(async () => {
    t = convexTest(schema);
    ({ artistId, sessionId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "growth", status: "active" });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova Vega", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const sessionId = await ctx.db.insert("sessions", {
        orgId: ORG, title: "Tracking", artistId, serviceType: "recording",
        startTime: Date.now() - 2 * HOUR, endTime: Date.now() - HOUR, status: "completed",
        rateCents: 60000, depositCents: 60000, depositPaid: true, intakeCompleted: false, amountPaidCents: 60000,
      });
      return { artistId, sessionId };
    }));
  });

  const monthStart = () => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  it("adds booking payments, packages and bank income to paid invoices, and leaves out failed payments", async () => {
    const at = Math.max(monthStart() + 60_000, Date.now() - 60_000);
    const todayUtc = Math.floor(Date.now() / DAY) * DAY;
    await t.run(async (ctx) => {
      await ctx.db.insert("invoices", {
        orgId: ORG, number: "INV-1", artistId, status: "paid",
        lineItems: [{ label: "Mix", amountCents: 10000 }], amountCents: 10000, dueDate: at, paidAt: at,
      });
      // Paid in full at booking: lands in payments, never as a paid invoice.
      await ctx.db.insert("payments", { orgId: ORG, sessionId, kind: "full", amountCents: 60000, provider: "stripe", status: "paid", paidAt: at });
      await ctx.db.insert("payments", { orgId: ORG, sessionId, kind: "deposit", amountCents: 7777, provider: "stripe", status: "failed", paidAt: at });
      await ctx.db.insert("revenueEntries", {
        orgId: ORG, sourceType: "package", sourceId: "pkg1", provider: "stripe",
        incomeCategory: "packages_prepaid", amountCents: 25000, currency: "usd", collectedAt: at,
      });
      const connectionId = await ctx.db.insert("bankConnections", {
        orgId: ORG, plaidItemId: "item", institutionName: "Bank", status: "active", createdAt: 0,
      } as never);
      const accountId = await ctx.db.insert("bankAccounts", {
        orgId: ORG, connectionId, plaidAccountId: "acc", name: "Checking", type: "depository", currency: "USD", balanceAsOf: 0,
      } as never);
      const bank = (id: string, amountCents: number, extra: Record<string, unknown>) =>
        ctx.db.insert("bankTransactions", {
          orgId: ORG, connectionId, accountId, plaidTransactionId: id, date: todayUtc, amountCents,
          direction: "in", currency: "USD", name: id, pending: false, updatedAt: 0, ...extra,
        } as never);
      await bank("gig", 5000, { moneyInKind: "income", incomeCategory: "recording_sessions" });
      await bank("payout", 99999, { moneyInKind: "stripe_payout" }); // cash movement, not revenue
    });

    // Today's bank line counts once its day is inside this month.
    const bankCounts = Math.min(todayUtc + 12 * HOUR, Date.now()) >= monthStart();
    const expected = 10000 + 60000 + 25000 + (bankCounts ? 5000 : 0);

    const o = await t.query(api.dashboard.overview, {});
    expect(o.kpis.revenueThisMonth).toBe(expected);
    expect(o.kpis.revenueDelta).toBe(1); // nothing last month, something now

    const series = await t.query(api.dashboard.revenueSeries, { range: "30d" });
    expect(series.points.reduce((s, p) => s + p.cents, 0)).toBe(10000 + 60000 + 25000 + 5000);

    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const k = await t.query(api.dashboard.periodKpis, { start: dayStart, end: dayStart + DAY, prevStart: dayStart - DAY, prevEnd: dayStart });
    const paidToday = at >= dayStart ? 10000 + 60000 + 25000 : 0;
    const bankToday = Math.min(todayUtc + 12 * HOUR, Date.now()) >= dayStart ? 5000 : 0;
    expect(k.revenueCents).toBe(paidToday + bankToday);
  });

  it("compares like for like: last month's booking payments drive the trend", async () => {
    const ms = monthStart();
    const last = new Date(ms);
    last.setMonth(last.getMonth() - 1);
    const elapsed = Date.now() - ms;
    await t.run(async (ctx) => {
      // Same point in last month, paid through the booking page.
      await ctx.db.insert("payments", {
        orgId: ORG, sessionId, kind: "deposit", amountCents: 20000, provider: "stripe", status: "paid",
        paidAt: last.getTime() + Math.max(0, elapsed - 60_000),
      });
      await ctx.db.insert("payments", {
        orgId: ORG, sessionId, kind: "balance", amountCents: 30000, provider: "stripe", status: "paid",
        paidAt: Math.max(ms, Date.now() - 30_000),
      });
    });
    const o = await t.query(api.dashboard.overview, {});
    expect(o.kpis.revenueThisMonth).toBe(30000);
    expect(o.kpis.revenueDelta).toBeCloseTo(0.5);
    const trendTotal = o.charts.revenueTrend.reduce((s, p) => s + p.revenue, 0);
    expect(trendTotal).toBe(500); // dollars: 200 last month + 300 this month
  });
});
