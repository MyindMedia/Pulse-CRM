import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { blockRange, blockValueCents, localMidnight } from "./lib/roomBlockRange";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = "America/Los_Angeles";

type T = ReturnType<typeof convexTest>;

async function setup(t: T, opts: { switchOn?: boolean } = {}) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: "org1", name: "Studio", slug: "studio", tier: "growth", status: "active",
      timezone: TZ,
      ...(opts.switchOn === false ? {} : { bookingFeatures: { roomBlocks: true } }),
    });
    await ctx.db.insert("members", { orgId: "org1", name: "Owner", role: "owner", clerkUserId: "u_owner", skills: [] });
    await ctx.db.insert("members", { orgId: "org1", name: "Mgr", role: "manager", clerkUserId: "u_mgr", skills: [] });
    await ctx.db.insert("members", { orgId: "org1", name: "Eng", role: "engineer", clerkUserId: "u_eng", skills: [] });
    const roomId = await ctx.db.insert("rooms", {
      orgId: "org1", name: "Room A", status: "available", bookable: true,
      hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
    });
    return { roomId };
  });
}
const as = (t: T, user: string) => t.withIdentity({ subject: user, name: user, orgId: "org1" });

describe("roomBlockRange math", () => {
  it("day: whole local days inclusive", () => {
    const r = blockRange("day", "2027-03-02", "2027-03-03", TZ);
    expect(r.startTime).toBe(localMidnight(2027, 3, 2, TZ));
    expect(r.endTime).toBe(localMidnight(2027, 3, 4, TZ));
    expect(blockValueCents(10000, r.startTime, r.endTime)).toBe(48 * 10000);
  });
  it("week: Sunday-anchored whole weeks", () => {
    // 2027-03-03 is a Wednesday; its week is Sun 02-28 .. Sat 03-06.
    const r = blockRange("week", "2027-03-03", "2027-03-03", TZ);
    expect(r.startTime).toBe(localMidnight(2027, 2, 28, TZ));
    expect(r.endTime).toBe(localMidnight(2027, 3, 7, TZ));
    expect(blockValueCents(10000, r.startTime, r.endTime)).toBe(7 * 24 * 10000);
  });
  it("month: whole calendar months, multi-month", () => {
    const r = blockRange("month", "2027-02-15", "2027-03-10", TZ);
    expect(r.startTime).toBe(localMidnight(2027, 2, 1, TZ));
    expect(r.endTime).toBe(localMidnight(2027, 4, 1, TZ));
    // Feb (28d) + Mar (31d, DST starts Mar 14 so one 23h day).
    expect(blockValueCents(100, r.startTime, r.endTime)).toBe((28 * 24 + 31 * 24 - 1) * 100);
  });
  it("uses the studio zone, not UTC", () => {
    const r = blockRange("day", "2027-07-01", "2027-07-01", TZ);
    expect(new Date(r.startTime).toISOString()).toBe("2027-07-01T07:00:00.000Z");
  });
  it("rejects end before start", () => {
    expect(() => blockRange("day", "2027-03-05", "2027-03-01", TZ)).toThrow();
  });
});

describe("roomBlocks", () => {
  let t: T;
  let roomId: Id<"rooms">;
  beforeEach(async () => {
    t = convexTest(schema);
    ({ roomId } = await setup(t));
  });
  const args = (over: object = {}) => ({
    roomId, granularity: "day" as const, startDate: "2027-03-02", endDate: "2027-03-03", label: "Nova buyout", ...over,
  });

  it("owner and manager can create, update, remove; engineer cannot", async () => {
    const id = await as(t, "u_owner").mutation(api.roomBlocks.create, args());
    const b = await t.run((ctx) => ctx.db.get(id));
    expect(b?.valueCents).toBe(48 * 10000);
    expect(b?.hourlyRateCents).toBe(10000);
    expect(b?.createdByMemberId).toBeDefined();

    await as(t, "u_mgr").mutation(api.roomBlocks.update, { id, label: "Renamed" });
    expect((await t.run((ctx) => ctx.db.get(id)))?.label).toBe("Renamed");
    await as(t, "u_mgr").mutation(api.roomBlocks.create, args({ startDate: "2027-04-01", endDate: "2027-04-01" }));

    await expect(as(t, "u_eng").mutation(api.roomBlocks.create, args({ startDate: "2027-05-01", endDate: "2027-05-01" }))).rejects.toThrow();
    await expect(as(t, "u_eng").mutation(api.roomBlocks.update, { id, label: "x" })).rejects.toThrow();
    await expect(as(t, "u_eng").mutation(api.roomBlocks.remove, { id })).rejects.toThrow();

    // Engineers can still read blocks for the calendar.
    const list = await as(t, "u_eng").query(api.roomBlocks.list, { from: 0, to: Date.now() + 5 * 365 * DAY });
    expect(list.length).toBe(2);

    await as(t, "u_owner").mutation(api.roomBlocks.remove, { id });
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });

  it("refuses when the switch is off, and list is empty", async () => {
    const t2 = convexTest(schema);
    const { roomId: r2 } = await setup(t2, { switchOn: false });
    await expect(
      as(t2, "u_owner").mutation(api.roomBlocks.create, { roomId: r2, granularity: "day", startDate: "2027-03-02", endDate: "2027-03-02", label: "x" }),
    ).rejects.toThrow(/turned off/i);
    expect(await as(t2, "u_owner").query(api.roomBlocks.list, { from: 0, to: Date.now() + 5 * 365 * DAY })).toEqual([]);
  });

  it("refuses over an existing session, listing it; only an owner can force", async () => {
    const start = localMidnight(2027, 3, 2, TZ) + 10 * HOUR;
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "org1", name: "Nova", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      await ctx.db.insert("sessions", {
        orgId: "org1", title: "Tracking day", artistId, serviceType: "recording", roomId,
        startTime: start, endTime: start + 2 * HOUR, status: "confirmed",
        rateCents: 20000, depositCents: 6000, depositPaid: false, intakeCompleted: false,
      });
    });
    await expect(as(t, "u_mgr").mutation(api.roomBlocks.create, args())).rejects.toThrow(/Tracking day/);
    await expect(as(t, "u_mgr").mutation(api.roomBlocks.create, args({ force: true }))).rejects.toThrow(/Only an owner/);
    const id = await as(t, "u_owner").mutation(api.roomBlocks.create, args({ force: true }));
    expect(id).toBeDefined();
  });

  it("a cancelled session does not conflict", async () => {
    const start = localMidnight(2027, 3, 2, TZ) + 10 * HOUR;
    await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "org1", name: "Nova", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      await ctx.db.insert("sessions", {
        orgId: "org1", title: "Gone", artistId, serviceType: "recording", roomId,
        startTime: start, endTime: start + 2 * HOUR, status: "cancelled",
        rateCents: 20000, depositCents: 6000, depositPaid: false, intakeCompleted: false,
      });
    });
    await expect(as(t, "u_owner").mutation(api.roomBlocks.create, args())).resolves.toBeDefined();
  });

  it("public availability and createBooking refuse a blocked slot", async () => {
    await as(t, "u_owner").mutation(api.roomBlocks.create, args());
    const dayStart = localMidnight(2027, 3, 3, TZ);
    const av = await t.query(api.booking.availability, { roomId, dayStart });
    expect(av.slots.every((s) => !s.available)).toBe(true);
    expect(av.booked.length).toBeGreaterThan(0);
    await expect(
      t.mutation(api.booking.createBooking, {
        roomId, clientName: "Max", clientEmail: "max@x.com",
        startTime: dayStart + 12 * HOUR, durationHours: 2,
      }),
    ).rejects.toThrow(/blocked/i);
    // The day after the block is open (far future, so not "past").
    const free = await t.query(api.booking.availability, { roomId, dayStart: localMidnight(2027, 3, 4, TZ) });
    expect(free.slots.some((s) => s.available)).toBe(true);
  });

  it("refuses overlapping blocks in the same room", async () => {
    await as(t, "u_owner").mutation(api.roomBlocks.create, args());
    await expect(
      as(t, "u_owner").mutation(api.roomBlocks.create, args({ startDate: "2027-03-03", endDate: "2027-03-05" })),
    ).rejects.toThrow(/already blocked/i);
  });

  it("blocked value shows in roomUtilization separately", async () => {
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert("roomBlocks", {
        orgId: "org1", roomId, startTime: now - 2 * DAY, endTime: now - 1 * DAY,
        granularity: "day", label: "Maint", hourlyRateCents: 10000, valueCents: 24 * 10000,
      }),
    );
    const out = await as(t, "u_owner").query(api.reports.roomUtilization, {});
    expect(out.blockedValueCents).toBe(24 * 10000);
    expect(out.rows[0].blockedHours).toBe(24);
    expect(out.rows[0].bookedHours).toBe(0);
  });

  it("switch off: roomUtilization has no blocked value", async () => {
    const t2 = convexTest(schema);
    const { roomId: r2 } = await setup(t2, { switchOn: false });
    const now = Date.now();
    await t2.run((ctx) =>
      ctx.db.insert("roomBlocks", {
        orgId: "org1", roomId: r2, startTime: now - 2 * DAY, endTime: now - 1 * DAY,
        granularity: "day", label: "Maint", hourlyRateCents: 10000, valueCents: 240000,
      }),
    );
    const out = await as(t2, "u_owner").query(api.reports.roomUtilization, {});
    expect(out.blockedValueCents).toBe(0);
  });
});
