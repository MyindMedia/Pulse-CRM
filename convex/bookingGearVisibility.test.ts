import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* The gear list is the studio's call. Off means the list is not RENDERED and
   not SENT: a list hidden with CSS is one devtools panel away from published,
   and a studio that turned it off has usually turned it off for a reason -
   half the kit is in storage, or they would rather have the conversation. */

async function studio(t: ReturnType<typeof convexTest>, showGearOnBooking?: boolean) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "Studio", slug: "studio", plan: "studio", status: "active",
      ...(showGearOnBooking === undefined ? {} : { showGearOnBooking }),
    } as never);
    const room = await ctx.db.insert("rooms", {
      orgId: "org1", name: "Room A", status: "available", bookable: true,
      hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
    } as never);
    await ctx.db.insert("equipment", {
      orgId: "org1", name: "Neumann U47", category: "mic", status: "available",
      quantity: 1, purchaseCents: 800000, currentValueCents: 600000,
      installedInRoomId: room,
    } as never);
    return room;
  });
}

describe("gear on the booking page", () => {
  it("is listed by default - a studio that never touched the switch keeps its gear", async () => {
    const t = convexTest(schema);
    const roomId = await studio(t, undefined);
    const room = await t.query(api.booking.room, { roomId });
    expect(room?.showGear).toBe(true);
    expect(room?.equipment.map((e) => e.name)).toEqual(["Neumann U47"]);
  });

  it("is listed when the studio has switched it on", async () => {
    const t = convexTest(schema);
    const roomId = await studio(t, true);
    const room = await t.query(api.booking.room, { roomId });
    expect(room?.showGear).toBe(true);
    expect(room?.equipment).toHaveLength(1);
  });

  it("is not sent at all when the studio has switched it off", async () => {
    const t = convexTest(schema);
    const roomId = await studio(t, false);
    const room = await t.query(api.booking.room, { roomId });
    expect(room?.showGear).toBe(false);
    expect(room?.equipment).toEqual([]);
  });

  it("still returns the room itself - the switch hides gear, not the booking", async () => {
    const t = convexTest(schema);
    const roomId = await studio(t, false);
    const room = await t.query(api.booking.room, { roomId });
    expect(room?.name).toBe("Room A");
    expect(room?.hourlyRateCents).toBe(10000);
  });
});
