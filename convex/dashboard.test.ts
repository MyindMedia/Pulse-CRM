import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* The hardware overview's figures: booked hours and deposits held on the
   month tiles, the booking revenue series, and the deposits feed. Money stays
   with money roles. */

const ORG = "pulse-demo";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("hardware overview data", () => {
  let t: ReturnType<typeof convexTest>;
  let artistId: Id<"artists">;
  let roomId: Id<"rooms">;

  beforeEach(async () => {
    t = convexTest(schema);
    ({ artistId, roomId } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "growth", status: "active" });
      await ctx.db.insert("members", { orgId: ORG, name: "Eng Ellis", role: "engineer", clerkUserId: "u_eng", skills: [] });
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova Vega", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const roomId = await ctx.db.insert("rooms", { orgId: ORG, name: "Studio A", status: "available", hourlyRateCents: 10000 });
      return { artistId, roomId };
    }));
  });

  const session = (start: number, hours: number, extra: Record<string, unknown> = {}) =>
    t.run((ctx) =>
      ctx.db.insert("sessions", {
        orgId: ORG, title: "Tracking", artistId, roomId, serviceType: "recording",
        startTime: start, endTime: start + hours * HOUR, status: "confirmed",
        rateCents: 60000, depositCents: 20000, depositPaid: false, intakeCompleted: false,
        ...extra,
      }),
    );

  it("counts this month's booked hours (not cancelled ones) and the deposits held on bookings still to come", async () => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const inMonth = Math.max(monthStart.getTime() + HOUR, Date.now() - 2 * DAY);
    await session(inMonth, 4);
    await session(inMonth + 5 * HOUR, 3, { status: "cancelled" });
    const future = Date.now() + 2 * DAY;
    await session(future, 2, { depositPaid: true });

    const o = await t.query(api.dashboard.overview, {});
    const nextMonth = new Date(monthStart);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    const futureInMonth = future + 2 * HOUR <= nextMonth.getTime() ? 2 : 0;
    expect(o.kpis.bookedHoursThisMonth).toBe(4 + futureInMonth);
    expect(o.kpis.depositsHeldCents).toBe(20000);
    expect(o.kpis.depositsHeldCount).toBe(1);
  });

  it("keeps deposits held from someone who may not see money", async () => {
    await session(Date.now() + DAY, 2, { depositPaid: true });
    const o = await t.withIdentity({ subject: "u_eng", orgId: ORG }).query(api.dashboard.overview, {});
    expect(o.kpis.depositsHeldCents).toBeNull();
    expect(o.kpis.bookedHoursThisMonth).toBeTypeOf("number");
  });

  it("buckets collected revenue by day for 30 days, and gives no points without money sight", async () => {
    await t.run(async (ctx) => {
      const inv = (amountCents: number, paidAt: number) =>
        ctx.db.insert("invoices", {
          orgId: ORG, number: `INV-${amountCents}`, artistId, status: "paid",
          lineItems: [{ label: "Session", amountCents }], amountCents, dueDate: paidAt, paidAt,
        });
      await inv(45000, Date.now() - 60_000);
      await inv(10000, Date.now() - 3 * DAY);
      await inv(99900, Date.now() - 45 * DAY); // outside 30 days
    });
    const r = await t.query(api.dashboard.revenueSeries, { range: "30d" });
    expect(r.points).toHaveLength(30);
    expect(r.points.at(-1)!.cents).toBe(45000);
    expect(r.points.reduce((s, p) => s + p.cents, 0)).toBe(55000);

    const ninety = await t.query(api.dashboard.revenueSeries, { range: "90d" });
    expect(ninety.points).toHaveLength(13);
    expect(ninety.points.reduce((s, p) => s + p.cents, 0)).toBe(154900);

    const hidden = await t.withIdentity({ subject: "u_eng", orgId: ORG }).query(api.dashboard.revenueSeries, { range: "30d" });
    expect(hidden.points).toEqual([]);
  });

  it("lists the latest paid deposits with their client and room, newest first", async () => {
    const sid = await session(Date.now() + DAY, 3);
    await t.run(async (ctx) => {
      await ctx.db.insert("payments", { orgId: ORG, sessionId: sid, kind: "deposit", amountCents: 22500, provider: "stripe", status: "paid", paidAt: Date.now() - HOUR });
      await ctx.db.insert("payments", { orgId: ORG, sessionId: sid, kind: "deposit", amountCents: 9000, provider: "simulated", status: "paid", paidAt: Date.now() - 2 * HOUR });
      await ctx.db.insert("payments", { orgId: ORG, sessionId: sid, kind: "balance", amountCents: 40000, provider: "stripe", status: "paid", paidAt: Date.now() });
      await ctx.db.insert("payments", { orgId: ORG, sessionId: sid, kind: "deposit", amountCents: 5000, provider: "stripe", status: "failed", paidAt: Date.now() });
    });
    const feed = await t.query(api.payments.recentDeposits, {});
    expect(feed.map((f) => f.amountCents)).toEqual([22500, 9000]);
    expect(feed[0]).toMatchObject({ clientName: "Nova Vega", roomName: "Studio A", provider: "stripe" });

    await expect(t.withIdentity({ subject: "u_eng", orgId: ORG }).query(api.payments.recentDeposits, {})).rejects.toThrow(/invoices\.read/);
  });
});
