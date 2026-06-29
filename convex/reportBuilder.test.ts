import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { buildReport, findSource, type NormRecord } from "./lib/reportEngine";

const ORG = "pulse-demo";
const DAY = 86_400_000;
const HOUR = 3_600_000;

/* ── Pure engine (no ctx) ── */
describe("reportEngine.buildReport - pure aggregation", () => {
  const src = findSource("sessions")!;
  const recs: NormRecord[] = [
    { ts: 1000, dims: { room: "A" }, nums: { revenue: 10000, hours: 2 } },
    { ts: 2000, dims: { room: "A" }, nums: { revenue: 30000, hours: 4 } },
    { ts: 3000, dims: { room: "B" }, nums: { revenue: 20000, hours: 1 } },
  ];

  it("groups, sums, totals and sorts by the first metric desc", () => {
    const out = buildReport(recs, { source: "sessions", groupBy: "room", metrics: ["sessions", "revenue", "hours"] }, src);
    expect(out.rows.map((r) => r.group)).toEqual(["A", "B"]); // A has 2 sessions, B has 1
    const a = out.rows[0];
    expect(a.values.sessions).toBe(2);
    expect(a.values.revenue).toBe(40000);
    expect(a.values.hours).toBe(6);
    expect(out.totals.sessions).toBe(3);
    expect(out.totals.revenue).toBe(60000);
    expect(out.totals.hours).toBe(7);
  });

  it("computes ratio metrics (avg per session)", () => {
    const out = buildReport(recs, { source: "sessions", groupBy: "room", metrics: ["avgRevenue"] }, src);
    const byRoom = Object.fromEntries(out.rows.map((r) => [r.group, r.values.avgRevenue]));
    expect(byRoom.A).toBe(20000); // (10000 + 30000) / 2
    expect(byRoom.B).toBe(20000); // 20000 / 1
    expect(out.totals.avgRevenue).toBe(20000); // 60000 / 3
  });

  it("honors a date window and a top-N limit", () => {
    const out = buildReport(
      recs,
      { source: "sessions", from: 1500, to: 3000, groupBy: "room", metrics: ["revenue"], limit: 1 },
      src,
    );
    // ts 1000 is excluded by the window; A=30000, B=20000 -> limit 1 keeps A.
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].group).toBe("A");
    expect(out.rows[0].values.revenue).toBe(30000);
  });

  it("throws on an unknown dimension or empty metrics", () => {
    expect(() => buildReport(recs, { source: "sessions", groupBy: "nope", metrics: ["revenue"] }, src)).toThrow();
    expect(() => buildReport(recs, { source: "sessions", groupBy: "room", metrics: [] }, src)).toThrow();
  });
});

/* ── Convex query (org-scoped gather + aggregate) ── */
describe("reportBuilder.generate - org-scoped reports", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
  });

  async function artist(name: string): Promise<Id<"artists">> {
    return t.run((ctx) =>
      ctx.db.insert("artists", {
        orgId: ORG, name, type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      }),
    );
  }
  async function room(name: string): Promise<Id<"rooms">> {
    return t.run((ctx) => ctx.db.insert("rooms", { orgId: ORG, name, status: "available" }));
  }
  async function session(artistId: Id<"artists">, over: Record<string, unknown>): Promise<Id<"sessions">> {
    return t.run((ctx) =>
      ctx.db.insert("sessions", {
        orgId: ORG, title: "S", artistId, serviceType: "recording",
        startTime: Date.now() - DAY, endTime: Date.now() - DAY + HOUR,
        status: "completed", rateCents: 0, depositCents: 0, depositPaid: false, intakeCompleted: true,
        ...over,
      }),
    );
  }

  it("aggregates sessions by room with hours, revenue and collected", async () => {
    const a = await artist("Nova");
    const now = Date.now();
    const roomA = await room("Room A");
    const roomB = await room("Room B");

    await session(a, { roomId: roomA, status: "completed", rateCents: 50000, amountPaidCents: 50000, startTime: now - 5 * DAY, endTime: now - 5 * DAY + 2 * HOUR });
    await session(a, { roomId: roomA, status: "confirmed", rateCents: 30000, amountPaidCents: 0, startTime: now - 4 * DAY, endTime: now - 4 * DAY + HOUR });
    await session(a, { roomId: roomB, status: "completed", rateCents: 40000, amountPaidCents: 20000, startTime: now - 3 * DAY, endTime: now - 3 * DAY + 4 * HOUR });
    // cancelled -> counted as a session row but contributes no hours/revenue
    await session(a, { roomId: roomA, status: "cancelled", rateCents: 99999, startTime: now - 2 * DAY, endTime: now - 2 * DAY + 3 * HOUR });
    // comped -> counts + has hours, but zero revenue, captured comped value
    await session(a, { roomId: roomB, status: "confirmed", rateCents: 0, comped: true, compedValueCents: 25000, startTime: now - DAY, endTime: now - DAY + HOUR });

    const out = await t.query(api.reportBuilder.generate, {
      source: "sessions", groupBy: "room",
      metrics: ["sessions", "hours", "revenue", "collected", "compedValue"],
    });

    const byRoom = Object.fromEntries(out.rows.map((r) => [r.group, r.values]));
    expect(byRoom["Room A"].sessions).toBe(3);
    expect(byRoom["Room A"].hours).toBe(3); // 2 + 1 + 0 (cancelled)
    expect(byRoom["Room A"].revenue).toBe(80000);
    expect(byRoom["Room A"].collected).toBe(50000);
    expect(byRoom["Room B"].revenue).toBe(40000);
    expect(byRoom["Room B"].compedValue).toBe(25000);

    expect(out.totals.sessions).toBe(5);
    expect(out.totals.hours).toBe(8);
    expect(out.totals.revenue).toBe(120000);
    expect(out.totals.collected).toBe(70000);
    expect(out.sourceLabel).toBe("Sessions & bookings");
  });

  it("filters by the requested date window", async () => {
    const a = await artist("Indie");
    const now = Date.now();
    await session(a, { rateCents: 10000, startTime: now - 100 * DAY, endTime: now - 100 * DAY + HOUR });
    await session(a, { rateCents: 20000, startTime: now - 2 * DAY, endTime: now - 2 * DAY + HOUR });

    const out = await t.query(api.reportBuilder.generate, {
      source: "sessions", groupBy: "client", metrics: ["sessions", "revenue"],
      from: now - 10 * DAY, to: now,
    });
    expect(out.totals.sessions).toBe(1); // the 100-day-old one is excluded
    expect(out.totals.revenue).toBe(20000);
  });

  it("aggregates the payments ledger by type (cleared only)", async () => {
    const a = await artist("Payer");
    const sId = await session(a, { rateCents: 50000 });
    const mk = (over: Record<string, unknown>) =>
      t.run((ctx) => ctx.db.insert("payments", {
        orgId: ORG, sessionId: sId, kind: "deposit", amountCents: 0, provider: "simulated", status: "paid", ...over,
      }));
    await mk({ kind: "deposit", amountCents: 15000, status: "paid" });
    await mk({ kind: "balance", amountCents: 35000, status: "paid" });
    await mk({ kind: "balance", amountCents: 99999, status: "pending" }); // excluded

    const out = await t.query(api.reportBuilder.generate, {
      source: "payments", groupBy: "kind", metrics: ["payments", "amount"],
    });
    const byKind = Object.fromEntries(out.rows.map((r) => [r.group, r.values]));
    expect(byKind["Deposit"].amount).toBe(15000);
    expect(byKind["Balance"].amount).toBe(35000);
    expect(out.totals.payments).toBe(2);
    expect(out.totals.amount).toBe(50000);
  });

  it("rejects an unknown source", async () => {
    await expect(
      t.query(api.reportBuilder.generate, { source: "bogus", groupBy: "x", metrics: ["y"] }),
    ).rejects.toThrow(/unknown report source/i);
  });
});
