import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("booking add-ons: engineer + conflict-aware gear", () => {
  let t: ReturnType<typeof convexTest>;
  let roomA: Id<"rooms">;
  let roomB: Id<"rooms">;
  let mic: Id<"equipment">;
  let start: number;

  beforeEach(async () => {
    t = convexTest(schema);
    start = Date.now() + 7 * DAY; // a future slot
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org1", name: "Studio", slug: "studio", plan: "studio", status: "active" });
      const mkRoom = (name: string) =>
        ctx.db.insert("rooms", {
          orgId: "org1", name, status: "available", bookable: true,
          hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
        });
      const a = await mkRoom("Room A");
      const b = await mkRoom("Room B");
      const m = await ctx.db.insert("equipment", {
        orgId: "org1", name: "Neumann U47", category: "mic", status: "available",
        quantity: 1, purchaseCents: 800000, currentValueCents: 600000,
        rentable: true, rentalPriceCents: 7500,
      });
      return { a, b, m };
    });
    roomA = ids.a;
    roomB = ids.b;
    mic = ids.m;
  });

  it("folds the rental price into the session total + deposit", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: roomA,
      clientName: "Nova",
      clientEmail: "nova@x.com",
      startTime: start,
      durationHours: 2,
      addOnEquipmentIds: [mic],
    });
    // 2h * $100 + $75 mic = $275; deposit 30% = $82.50
    expect(res.rateCents).toBe(20000 + 7500);
    expect(res.addOnTotalCents).toBe(7500);
    expect(res.depositCents).toBe(Math.round(27500 * 0.3));

    const session = await t.run((ctx) => ctx.db.get(res.sessionId));
    expect(session?.addOns?.[0]?.equipmentId).toBe(mic);
    expect(session?.addOns?.[0]?.priceCents).toBe(7500);
  });

  it("shows the mic unavailable for an overlapping window once it's booked", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Nova", clientEmail: "nova@x.com",
      startTime: start, durationHours: 3, addOnEquipmentIds: [mic],
    });
    const opts = await t.query(api.booking.addOnOptions, {
      roomId: roomB, startTime: start + HOUR, durationHours: 1,
    });
    const micOpt = opts.gear.find((g) => g.id === mic);
    expect(micOpt?.available).toBe(false);
    expect(micOpt?.bookedUnits).toBe(1);
  });

  it("rejects a second overlapping booking of the same single mic", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Nova", clientEmail: "nova@x.com",
      startTime: start, durationHours: 3, addOnEquipmentIds: [mic],
    });
    // Different room, overlapping time, same mic -> must fail on the gear, not the room.
    await expect(
      t.mutation(api.booking.createBooking, {
        roomId: roomB, clientName: "Max", clientEmail: "max@x.com",
        startTime: start + HOUR, durationHours: 1, addOnEquipmentIds: [mic],
      }),
    ).rejects.toThrow(/just booked/i);
  });

  it("allows the same mic at a non-overlapping time", async () => {
    await t.mutation(api.booking.createBooking, {
      roomId: roomA, clientName: "Nova", clientEmail: "nova@x.com",
      startTime: start, durationHours: 2, addOnEquipmentIds: [mic],
    });
    const res = await t.mutation(api.booking.createBooking, {
      roomId: roomB, clientName: "Max", clientEmail: "max@x.com",
      startTime: start + 5 * HOUR, durationHours: 1, addOnEquipmentIds: [mic],
    });
    expect(res.addOnTotalCents).toBe(7500);
  });
});
