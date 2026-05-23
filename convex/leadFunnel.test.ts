import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* The anonymous demo viewer resolves to this org with owner caps, so the
   public booking + pipeline mutations operate on this seeded org. */
const ORG = "pulse-demo";
const HOUR = 3_600_000;

describe("lead -> booking funnel", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
  });

  async function seedRoom(over: Record<string, unknown> = {}): Promise<Id<"rooms">> {
    return t.run(async (ctx) =>
      ctx.db.insert("rooms", {
        orgId: ORG,
        name: "Live Room A",
        status: "available",
        bookable: true,
        hourlyRateCents: 10000,
        minimumHours: 2,
        depositPct: 30,
        ...over,
      }),
    );
  }

  async function seedArtist(over: Record<string, unknown> = {}): Promise<Id<"artists">> {
    return t.run(async (ctx) =>
      ctx.db.insert("artists", {
        orgId: ORG,
        name: "Pipeline Artist",
        type: "artist",
        genres: [],
        tags: [],
        status: "lead",
        lifetimeValueCents: 0,
        sessionCount: 0,
        reliability: "solid",
        ...over,
      }),
    );
  }

  it("public booking creates a lead artist, an inquiry opportunity, and a held session", async () => {
    const roomId = await seedRoom();
    const startTime = Date.now() + 3 * 24 * HOUR;

    const result = await t.mutation(api.booking.createBooking, {
      roomId,
      clientName: "Jordan Rivers",
      clientEmail: "Jordan@Example.com",
      clientPhone: "5550100",
      startTime,
      durationHours: 3,
      serviceType: "mixing",
    });

    expect(result.sessionId).toBeDefined();
    // 3h * $100 = $300, 30% deposit = $90
    expect(result.rateCents).toBe(30000);
    expect(result.depositCents).toBe(9000);

    const { artist, session, opps } = await t.run(async (ctx) => {
      const session = await ctx.db.get(result.sessionId);
      const artist = await ctx.db.get(session!.artistId);
      const opps = await ctx.db
        .query("opportunities")
        .collect();
      return { artist, session, opps };
    });

    // Lead artist stamped with source.
    expect(artist?.status).toBe("lead");
    expect(artist?.source).toBe("web_booking");

    // Held session retained (tentative + unpaid).
    expect(session?.status).toBe("tentative");
    expect(session?.depositPaid).toBe(false);
    expect(session?.source).toBe("public_booking");

    // Inquiry opportunity created, linked to the same artist, value carried over.
    expect(opps).toHaveLength(1);
    expect(opps[0].stage).toBe("inquiry");
    expect(opps[0].artistId).toBe(session?.artistId);
    expect(opps[0].serviceType).toBe("mixing");
    expect(opps[0].valueCents).toBe(30000);
    expect(opps[0].source).toBe("web_booking");
  });

  it("public booking honors a custom source and matches an existing artist by email", async () => {
    const roomId = await seedRoom();
    const existing = await seedArtist({
      name: "Repeat Client",
      email: "repeat@example.com",
      source: "referral",
    });
    const startTime = Date.now() + 4 * 24 * HOUR;

    const result = await t.mutation(api.booking.createBooking, {
      roomId,
      clientName: "Repeat Client",
      clientEmail: "repeat@example.com",
      startTime,
      durationHours: 2,
      serviceType: "recording",
      source: "instagram",
    });

    const { artists, opps, session } = await t.run(async (ctx) => {
      const artists = await ctx.db
        .query("artists")
        .collect();
      const opps = await ctx.db
        .query("opportunities")
        .collect();
      const session = await ctx.db.get(result.sessionId);
      return { artists, opps, session };
    });

    // No duplicate artist created.
    expect(artists).toHaveLength(1);
    expect(artists[0]._id).toBe(existing);
    // First-touch source wins on an existing artist.
    expect(artists[0].source).toBe("referral");
    // One inquiry opportunity linked to the existing artist.
    expect(opps).toHaveLength(1);
    expect(opps[0].artistId).toBe(existing);
    expect(session?.artistId).toBe(existing);
  });

  it("convertToBooking creates a held session and moves the opp to booked", async () => {
    const roomId = await seedRoom();
    const artistId = await seedArtist({ name: "Deal Artist" });
    const oppId = await t.run(async (ctx) =>
      ctx.db.insert("opportunities", {
        orgId: ORG,
        title: "EP mix package",
        artistId,
        stage: "qualified",
        valueCents: 45000,
        serviceType: "mixing",
        probability: 0.25,
        updatedAt: Date.now(),
      }),
    );
    const startTime = Date.now() + 5 * 24 * HOUR;

    const out = await t.mutation(api.opportunities.convertToBooking, {
      id: oppId,
      roomId,
      startTime,
      durationHours: 4,
    });

    expect(out.sessionId).toBeDefined();
    expect(out.opportunityId).toBe(oppId);

    const { opp, session } = await t.run(async (ctx) => {
      const opp = await ctx.db.get(oppId);
      const session = await ctx.db.get(out.sessionId);
      return { opp, session };
    });

    // Opp advanced to booked.
    expect(opp?.stage).toBe("booked");
    expect(opp?.probability).toBe(0.7);

    // Session created from the deal: tentative hold, rate from opp value,
    // linked to the same artist + room + service type.
    expect(session?.status).toBe("tentative");
    expect(session?.depositPaid).toBe(false);
    expect(session?.artistId).toBe(artistId);
    expect(session?.roomId).toBe(roomId);
    expect(session?.serviceType).toBe("mixing");
    expect(session?.rateCents).toBe(45000);
    expect(session?.startTime).toBe(startTime);
    expect(session?.endTime).toBe(startTime + 4 * HOUR);
  });

  it("convertToBooking refuses a closed deal", async () => {
    const artistId = await seedArtist();
    const oppId = await t.run(async (ctx) =>
      ctx.db.insert("opportunities", {
        orgId: ORG,
        title: "Lost deal",
        artistId,
        stage: "lost",
        valueCents: 10000,
        serviceType: "recording",
        probability: 0,
        updatedAt: Date.now(),
      }),
    );

    await expect(
      t.mutation(api.opportunities.convertToBooking, {
        id: oppId,
        startTime: Date.now() + 24 * HOUR,
        durationHours: 2,
      }),
    ).rejects.toThrow(/already closed/);
  });
});
