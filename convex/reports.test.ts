import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* The anonymous demo viewer resolves to this org with owner caps, so
   calling the public report queries directly reads this seeded data. */
const ORG = "pulse-demo";
const DAY = 86_400_000;

describe("reports - Revenue Command Center", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
  });

  async function seedArtist(over: Record<string, unknown> = {}): Promise<Id<"artists">> {
    return t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: ORG,
        name: "Test Artist",
        type: "artist",
        genres: [],
        tags: [],
        status: "active",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
        ...over,
      }),
    );
  }

  async function seedRoom(name: string, over: Record<string, unknown> = {}): Promise<Id<"rooms">> {
    return t.run(async (ctx) =>
      ctx.db.insert("rooms", { orgId: ORG, name, status: "available", ...over }),
    );
  }

  async function seedSession(
    artistId: Id<"artists">,
    over: Record<string, unknown> = {},
  ): Promise<Id<"sessions">> {
    return t.run(async (ctx) =>
      ctx.db.insert("sessions", {
        orgId: ORG,
        title: "Session",
        artistId,
        serviceType: "recording",
        startTime: Date.now() - DAY,
        endTime: Date.now() - DAY + 3_600_000,
        status: "completed",
        rateCents: 50000,
        depositCents: 15000,
        depositPaid: true,
        intakeCompleted: true,
        ...over,
      }),
    );
  }

  it("unpaidAging buckets balances by session age and totals them", async () => {
    const a = await seedArtist({ name: "Owes Money" });
    const now = Date.now();
    // 10 days old, $300 owed (rate 500, paid 200)
    await seedSession(a, { startTime: now - 10 * DAY, endTime: now - 10 * DAY + 3_600_000, rateCents: 50000, amountPaidCents: 20000 });
    // 75 days old, $500 fully owed -> 61-90 bucket
    await seedSession(a, { startTime: now - 75 * DAY, endTime: now - 75 * DAY + 3_600_000, rateCents: 50000, amountPaidCents: 0 });
    // future session -> excluded
    await seedSession(a, { startTime: now + 5 * DAY, endTime: now + 5 * DAY + 3_600_000, rateCents: 90000, amountPaidCents: 0 });
    // fully paid -> excluded
    await seedSession(a, { startTime: now - 5 * DAY, endTime: now - 5 * DAY + 3_600_000, rateCents: 40000, amountPaidCents: 40000 });

    const out = await t.query(api.reports.unpaidAging, {});
    expect(out.rows).toHaveLength(1);
    const row = out.rows[0];
    expect(row.b0).toBe(30000); // 0-30d bucket
    expect(row.b60).toBe(50000); // 61-90d bucket
    expect(row.b30).toBe(0);
    expect(row.total).toBe(80000);
    expect(out.totals.total).toBe(80000);
    expect(out.totals.b0).toBe(30000);
    expect(out.totals.b60).toBe(50000);
  });

  it("roomUtilization computes booked vs available hours per room", async () => {
    const a = await seedArtist();
    const r = await seedRoom("Live Room", { roomType: "Live" });
    await seedRoom("Retired Suite", { status: "retired" }); // excluded
    const now = Date.now();
    // 6h booked within the last 30 days
    await seedSession(a, {
      roomId: r,
      startTime: now - 3 * DAY,
      endTime: now - 3 * DAY + 6 * 3_600_000,
      status: "completed",
    });
    // cancelled session contributes nothing
    await seedSession(a, {
      roomId: r,
      startTime: now - 2 * DAY,
      endTime: now - 2 * DAY + 4 * 3_600_000,
      status: "cancelled",
    });

    const out = await t.query(api.reports.roomUtilization, {});
    expect(out.windowDays).toBe(30);
    expect(out.rows).toHaveLength(1); // retired room dropped
    const row = out.rows[0];
    expect(row.roomName).toBe("Live Room");
    expect(row.bookedHours).toBe(6);
    expect(row.availableHours).toBe(30 * 12);
    expect(row.utilization).toBeCloseTo(6 / 360, 5);
  });

  it("dormantClients lists 60d+ quiet clients ranked by lifetime value", async () => {
    const now = Date.now();
    const quietBig = await seedArtist({ name: "Big Quiet", lifetimeValueCents: 500000, sessionCount: 5 });
    const quietSmall = await seedArtist({ name: "Small Quiet", lifetimeValueCents: 100000, sessionCount: 2 });
    const active = await seedArtist({ name: "Active", lifetimeValueCents: 300000, sessionCount: 3 });
    await seedArtist({ name: "Never Booked", lifetimeValueCents: 0, sessionCount: 0 });

    await seedSession(quietBig, { startTime: now - 100 * DAY, endTime: now - 100 * DAY + 3_600_000 });
    await seedSession(quietSmall, { startTime: now - 70 * DAY, endTime: now - 70 * DAY + 3_600_000 });
    await seedSession(active, { startTime: now - 5 * DAY, endTime: now - 5 * DAY + 3_600_000 });
    // newbie has no session at all

    const out = await t.query(api.reports.dormantClients, {});
    const names = out.rows.map((r) => r.artistName);
    expect(names).toEqual(["Big Quiet", "Small Quiet"]); // ranked by LTV desc, active + newbie excluded
    expect(out.count60).toBe(2);
    expect(out.count90).toBe(1); // only Big Quiet is 90+
    expect(out.dormantValueCents).toBe(600000);
    expect(out.rows[0].band).toBe("90+");
  });

  it("noShowRisk scores reliability + no-show sessions", async () => {
    const flagged = await seedArtist({ name: "Flagged", reliability: "flagged", sessionCount: 4 });
    await seedArtist({ name: "Watch", reliability: "watch", sessionCount: 2 });
    const solid = await seedArtist({ name: "Solid", reliability: "solid", sessionCount: 3 });
    await seedArtist({ name: "Clean", reliability: "solid", sessionCount: 1 }); // excluded

    await seedSession(flagged, { status: "no_show" });
    await seedSession(solid, { status: "no_show" }); // solid but a no-show -> surfaces

    const out = await t.query(api.reports.noShowRisk, {});
    const byName = Object.fromEntries(out.rows.map((r) => [r.artistName, r]));
    expect(byName["Flagged"].riskScore).toBe(80); // 60 + 1*20
    expect(byName["Flagged"].band).toBe("high");
    expect(byName["Watch"].riskScore).toBe(30); // 30 + 0
    expect(byName["Solid"].riskScore).toBe(20); // 0 + 1*20
    expect(byName["Clean"]).toBeUndefined(); // solid, no no-shows
    expect(out.flaggedCount).toBe(1);
    expect(out.watchCount).toBe(1);
    expect(out.totalNoShows).toBe(2);
  });

  it("leadSourceRoi groups by source with conversion + won value", async () => {
    const igConverted = await seedArtist({ name: "IG Won", source: "instagram", lifetimeValueCents: 200000, sessionCount: 3 });
    await seedArtist({ name: "IG Lead", source: "instagram", lifetimeValueCents: 0, sessionCount: 0 });
    const refConverted = await seedArtist({ name: "Referral", source: "referral", lifetimeValueCents: 400000, sessionCount: 5 });
    await seedArtist({ name: "No Source", lifetimeValueCents: 0, sessionCount: 0 }); // -> Unattributed

    // A won opportunity attributed to instagram
    await t.run(async (ctx) =>
      ctx.db.insert("opportunities", {
        orgId: ORG,
        title: "Mix deal",
        artistId: igConverted,
        stage: "won",
        valueCents: 75000,
        serviceType: "mixing",
        probability: 1,
        source: "instagram",
        updatedAt: Date.now(),
      }),
    );
    // A booked opportunity inheriting its artist's source (referral)
    await t.run(async (ctx) =>
      ctx.db.insert("opportunities", {
        orgId: ORG,
        title: "Tracking",
        artistId: refConverted,
        stage: "booked",
        valueCents: 50000,
        serviceType: "recording",
        probability: 0.9,
        updatedAt: Date.now(),
      }),
    );

    const out = await t.query(api.reports.leadSourceRoi, {});
    const bySource = Object.fromEntries(out.rows.map((r) => [r.source, r]));

    expect(bySource["instagram"].leads).toBe(2);
    expect(bySource["instagram"].converted).toBe(1);
    expect(bySource["instagram"].conversionRate).toBeCloseTo(0.5, 5);
    expect(bySource["instagram"].wonValueCents).toBe(75000);

    expect(bySource["referral"].leads).toBe(1);
    expect(bySource["referral"].converted).toBe(1);
    expect(bySource["referral"].wonValueCents).toBe(50000); // booked opp inherited source

    expect(bySource["Unattributed"].leads).toBe(1);
    expect(out.totalLeads).toBe(4);
    expect(out.totalWonValueCents).toBe(125000);
  });
});
