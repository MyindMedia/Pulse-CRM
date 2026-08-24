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

/* Three switches, most specific last: the studio can publish no gear at all,
   one room can stay quiet while the others list theirs, and any single piece
   can sit out. None of it is SENT when it is not shown - a list hidden with
   CSS is one devtools panel away from published. */
describe("choosing what gear a room publishes", () => {
  async function room(
    t: ReturnType<typeof convexTest>,
    opts: { orgShows?: boolean; roomShows?: boolean; hidePiece?: boolean } = {},
  ) {
    return await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Studio", slug: "studio-g", plan: "studio", status: "active",
        ...(opts.orgShows === undefined ? {} : { showGearOnBooking: opts.orgShows }),
      } as never);
      const r = await ctx.db.insert("rooms", {
        orgId: "pulse-demo", name: "Room A", status: "available", bookable: true,
        hourlyRateCents: 10000, minimumHours: 2, depositPct: 25,
        ...(opts.roomShows === undefined ? {} : { showGear: opts.roomShows }),
      } as never);
      const gear = (name: string, hide?: boolean) =>
        ctx.db.insert("equipment", {
          orgId: "pulse-demo", name, category: "mic", status: "available", quantity: 1,
          purchaseCents: 1000, currentValueCents: 1000, installedInRoomId: r,
          ...(hide ? { hideOnBooking: true } : {}),
        } as never);
      await gear("Neumann U47");
      await gear("Patch cable", opts.hidePiece);
      return r;
    });
  }

  it("lists everything installed by default", async () => {
    const t = convexTest(schema);
    const roomId = await room(t);
    const page = await t.query(api.booking.room, { roomId });
    expect(page?.showGear).toBe(true);
    expect(page?.equipment.map((e) => e.name).sort()).toEqual(["Neumann U47", "Patch cable"]);
  });

  it("drops a piece the studio held back, and does not send it", async () => {
    const t = convexTest(schema);
    const roomId = await room(t, { hidePiece: true });
    const page = await t.query(api.booking.room, { roomId });
    expect(page?.equipment.map((e) => e.name)).toEqual(["Neumann U47"]);
    expect(JSON.stringify(page?.equipment)).not.toContain("Patch cable");
  });

  it("keeps one room quiet while the studio still publishes gear", async () => {
    const t = convexTest(schema);
    const roomId = await room(t, { roomShows: false });
    const page = await t.query(api.booking.room, { roomId });
    expect(page?.showGear).toBe(false);
    expect(page?.equipment).toEqual([]);
  });

  it("lets the studio-wide switch win over a room that wants to publish", async () => {
    const t = convexTest(schema);
    const roomId = await room(t, { orgShows: false, roomShows: true });
    const page = await t.query(api.booking.room, { roomId });
    expect(page?.showGear).toBe(false);
    expect(page?.equipment).toEqual([]);
  });

  it("sets the whole list in one write, and flips pieces back on", async () => {
    const t = convexTest(schema);
    const roomId = await room(t);
    const ids = await t.run((ctx) => ctx.db.query("equipment").collect());
    const cable = ids.find((e) => e.name === "Patch cable")!._id;

    await t.mutation(api.equipment.setBookingVisibility, { roomId, hiddenIds: [cable] });
    let page = await t.query(api.booking.room, { roomId });
    expect(page?.equipment.map((e) => e.name)).toEqual(["Neumann U47"]);

    await t.mutation(api.equipment.setBookingVisibility, { roomId, hiddenIds: [] });
    page = await t.query(api.booking.room, { roomId });
    expect(page?.equipment).toHaveLength(2);
  });
});
