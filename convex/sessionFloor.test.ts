import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const newT = () => convexTest(schema);
type TestConvex = ReturnType<typeof newT>;

const HOUR = 3_600_000;

/* Seed a studio with an owner + an intern, returning both identities. */
async function seedStudio(t: TestConvex, org: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: org,
      name: "Floor Studio",
      slug: `floor-${org}`,
      plan: "studio",
      status: "active",
    });
    await ctx.db.insert("members", {
      orgId: org,
      name: "Owner",
      role: "owner",
      skills: [],
      clerkUserId: "u_own",
    });
    await ctx.db.insert("members", {
      orgId: org,
      name: "Intern",
      role: "intern",
      skills: [],
      clerkUserId: "u_int",
    });
  });
  return {
    asOwner: t.withIdentity({ subject: "u_own", orgId: org }),
    asIntern: t.withIdentity({ subject: "u_int", orgId: org }),
  };
}

function makeRoom(t: TestConvex, org: string, name = "Room A"): Promise<Id<"rooms">> {
  return t.run((ctx) =>
    ctx.db.insert("rooms", {
      orgId: org,
      name,
      status: "available",
      bookable: true,
      hourlyRateCents: 10_000,
      minimumHours: 1,
      depositPct: 30,
    }),
  );
}

function makeMic(t: TestConvex, org: string): Promise<Id<"equipment">> {
  return t.run((ctx) =>
    ctx.db.insert("equipment", {
      orgId: org,
      name: "Neumann U47",
      category: "mic",
      status: "available",
      quantity: 1,
      purchaseCents: 800_000,
      currentValueCents: 600_000,
      rentable: true,
      rentalPriceCents: 7_500,
    }),
  );
}

function makeArtist(t: TestConvex, org: string): Promise<Id<"artists">> {
  return t.run((ctx) =>
    ctx.db.insert("artists", {
      orgId: org,
      name: "Client",
      type: "artist",
      email: "client@example.com",
      genres: [],
      tags: [],
      status: "active",
      lifetimeValueCents: 0,
      sessionCount: 0,
      reliability: "solid",
    }),
  );
}

async function makeSession(
  t: TestConvex,
  org: string,
  artistId: Id<"artists">,
  over: Record<string, unknown> = {},
): Promise<Id<"sessions">> {
  return t.run((ctx) =>
    ctx.db.insert("sessions", {
      orgId: org,
      title: "Client - Room A",
      artistId,
      serviceType: "recording",
      startTime: Date.now() + 2 * HOUR,
      endTime: Date.now() + 4 * HOUR, // 2h default
      status: "in_progress",
      rateCents: 20_000,
      depositCents: 6_000,
      depositPaid: true,
      amountPaidCents: 6_000,
      intakeCompleted: true,
      ...over,
    }),
  );
}

describe("session floor actions", () => {
  it("extend moves the end time and recomputes the by-duration rate", async () => {
    const t = convexTest(schema);
    const org = "floor_ext";
    const { asOwner } = await seedStudio(t, org);
    const room = await makeRoom(t, org);
    const artistId = await makeArtist(t, org);
    const id = await makeSession(t, org, artistId, { roomId: room });

    const before = await t.run((ctx) => ctx.db.get(id));
    const res = await asOwner.mutation(api.sessions.extend, { id, addMinutes: 60 });

    // 2h -> 3h => 1.5x the $200 rate = $300; deposit/amountPaid untouched.
    expect(res.rateCents).toBe(30_000);
    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after!.endTime).toBe(before!.endTime + 60 * 60_000);
    expect(after!.rateCents).toBe(30_000);
    expect(after!.depositCents).toBe(6_000);
    expect(after!.amountPaidCents).toBe(6_000);
  });

  it("preserves comp / discount proportionality when extending", async () => {
    const t = convexTest(schema);
    const org = "floor_comp";
    const { asOwner } = await seedStudio(t, org);
    const room = await makeRoom(t, org);
    const artistId = await makeArtist(t, org);
    // 25% off: list $200, charged $150 over 2h.
    const id = await makeSession(t, org, artistId, {
      roomId: room,
      compType: "discounted",
      listValueCents: 20_000,
      rateCents: 15_000,
    });

    await asOwner.mutation(api.sessions.extend, { id, addMinutes: 60 });

    const after = await t.run((ctx) => ctx.db.get(id));
    // list scales to $300, charged keeps the 0.75 ratio => $225.
    expect(after!.listValueCents).toBe(30_000);
    expect(after!.rateCents).toBe(22_500);
  });

  it("reschedule rejects a window that clashes with another room booking", async () => {
    const t = convexTest(schema);
    const org = "floor_clash";
    const { asOwner } = await seedStudio(t, org);
    const room = await makeRoom(t, org);
    const artistId = await makeArtist(t, org);
    const base = Date.now() + 10 * HOUR;
    const a = await makeSession(t, org, artistId, {
      roomId: room,
      startTime: base,
      endTime: base + 2 * HOUR,
    });
    await makeSession(t, org, artistId, {
      roomId: room,
      startTime: base + 5 * HOUR,
      endTime: base + 7 * HOUR,
    });

    // Move A on top of B -> buffer conflict.
    await expect(
      asOwner.mutation(api.sessions.reschedule, {
        id: a,
        startTime: base + 5 * HOUR,
        endTime: base + 7 * HOUR,
      }),
    ).rejects.toThrow(/conflicts/i);
  });

  it("addGear folds the rental price into the rate", async () => {
    const t = convexTest(schema);
    const org = "floor_gear";
    const { asOwner } = await seedStudio(t, org);
    const room = await makeRoom(t, org);
    const mic = await makeMic(t, org);
    const artistId = await makeArtist(t, org);
    const id = await makeSession(t, org, artistId, { roomId: room });

    const res = await asOwner.mutation(api.sessions.addGear, { id, equipmentId: mic });
    expect(res.rateCents).toBe(20_000 + 7_500);
    expect(res.addOnTotalCents).toBe(7_500);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after!.addOns?.[0]?.equipmentId).toBe(mic);
    expect(after!.addOns?.[0]?.priceCents).toBe(7_500);
    expect(after!.rateCents).toBe(27_500);
  });

  it("addGear rejects a single-unit mic already booked on an overlapping session", async () => {
    const t = convexTest(schema);
    const org = "floor_double";
    const { asOwner } = await seedStudio(t, org);
    const roomA = await makeRoom(t, org, "Room A");
    const roomB = await makeRoom(t, org, "Room B");
    const mic = await makeMic(t, org);
    const artistId = await makeArtist(t, org);
    const base = Date.now() + 10 * HOUR;
    // Session A already holds the one mic.
    await makeSession(t, org, artistId, {
      roomId: roomA,
      startTime: base,
      endTime: base + 3 * HOUR,
      addOns: [{ equipmentId: mic, name: "Neumann U47", priceCents: 7_500 }],
    });
    // Session B overlaps in a different room.
    const b = await makeSession(t, org, artistId, {
      roomId: roomB,
      startTime: base + HOUR,
      endTime: base + 2 * HOUR,
    });

    await expect(
      asOwner.mutation(api.sessions.addGear, { id: b, equipmentId: mic }),
    ).rejects.toThrow(/overlapping/i);
  });

  it("addGear allows the same mic on a non-overlapping session", async () => {
    const t = convexTest(schema);
    const org = "floor_free";
    const { asOwner } = await seedStudio(t, org);
    const roomA = await makeRoom(t, org, "Room A");
    const roomB = await makeRoom(t, org, "Room B");
    const mic = await makeMic(t, org);
    const artistId = await makeArtist(t, org);
    const base = Date.now() + 10 * HOUR;
    await makeSession(t, org, artistId, {
      roomId: roomA,
      startTime: base,
      endTime: base + 2 * HOUR,
      addOns: [{ equipmentId: mic, name: "Neumann U47", priceCents: 7_500 }],
    });
    const b = await makeSession(t, org, artistId, {
      roomId: roomB,
      startTime: base + 5 * HOUR,
      endTime: base + 7 * HOUR,
    });

    const res = await asOwner.mutation(api.sessions.addGear, { id: b, equipmentId: mic });
    expect(res.addOnTotalCents).toBe(7_500);
  });

  it("is gated: an intern cannot extend or add gear", async () => {
    const t = convexTest(schema);
    const org = "floor_authz";
    const { asIntern } = await seedStudio(t, org);
    const room = await makeRoom(t, org);
    const mic = await makeMic(t, org);
    const artistId = await makeArtist(t, org);
    const id = await makeSession(t, org, artistId, { roomId: room });

    await expect(
      asIntern.mutation(api.sessions.extend, { id, addMinutes: 60 }),
    ).rejects.toThrow();
    await expect(
      asIntern.mutation(api.sessions.addGear, { id, equipmentId: mic }),
    ).rejects.toThrow();
  });
});
