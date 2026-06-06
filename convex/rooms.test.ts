import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

async function ownerOf(t: ReturnType<typeof convexTest>, orgId: string, user: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, plan: "studio", status: "active" });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", clerkUserId: user, skills: [] });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

describe("rooms.remove (delete retired rooms)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("deletes a retired room", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const roomId = await t.run((ctx) =>
      ctx.db.insert("rooms", { orgId: "org_a", name: "Old Room", status: "retired", bookable: false }),
    );
    await owner.mutation(api.rooms.remove, { id: roomId });
    const rooms = await owner.query(api.rooms.list, {});
    expect(rooms).toHaveLength(0);
  });

  it("rejects deleting a room that is not retired", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const roomId = await t.run((ctx) =>
      ctx.db.insert("rooms", { orgId: "org_a", name: "Active", status: "available", bookable: true }),
    );
    await expect(owner.mutation(api.rooms.remove, { id: roomId })).rejects.toThrow();
    // still there
    expect(await owner.query(api.rooms.list, {})).toHaveLength(1);
  });

  it("detaches gear (back to storage) and removes room-bound calendars", async () => {
    const owner = await ownerOf(t, "org_a", "u_a");
    const { roomId, gearId } = await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", {
        orgId: "org_a", name: "Tracking", status: "retired", bookable: false,
      });
      const gearId = await ctx.db.insert("equipment", {
        orgId: "org_a", name: "U87", category: "mic", status: "available",
        installedInRoomId: roomId, purchaseCents: 350000, currentValueCents: 300000,
      });
      const calId = await ctx.db.insert("externalCalendars", {
        orgId: "org_a", roomId, label: "Room iCal", source: "ical",
        icalUrl: "https://x/cal.ics", active: true,
      });
      await ctx.db.insert("externalCalendarEvents", {
        orgId: "org_a", calendarId: calId, roomId, externalUid: "u1",
        title: "Busy", startTime: 1, endTime: 2,
      });
      return { roomId, gearId };
    });

    await owner.mutation(api.rooms.remove, { id: roomId });

    await t.run(async (ctx) => {
      // Room gone
      expect(await ctx.db.get(roomId)).toBeNull();
      // Gear preserved but detached (back to storage)
      const gear = await ctx.db.get(gearId);
      expect(gear).not.toBeNull();
      expect(gear!.installedInRoomId).toBeUndefined();
      // Room-bound calendars + events removed
      expect(await ctx.db.query("externalCalendars").collect()).toHaveLength(0);
      expect(await ctx.db.query("externalCalendarEvents").collect()).toHaveLength(0);
    });
  });

  it("tenant isolation: org B cannot delete org A's retired room", async () => {
    const a = await ownerOf(t, "org_a", "u_a");
    const b = await ownerOf(t, "org_b", "u_b");
    const roomId = await t.run((ctx) =>
      ctx.db.insert("rooms", { orgId: "org_a", name: "A room", status: "retired", bookable: false }),
    );
    await expect(b.mutation(api.rooms.remove, { id: roomId })).rejects.toThrow();
    expect(await a.query(api.rooms.list, {})).toHaveLength(1);
  });
});
