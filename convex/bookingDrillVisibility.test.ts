import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* A booking request from the public link must be findable everywhere staff
   look for a booking: calendar range, bookings list, dashboard upcoming,
   the Today panel, the artist page and the inbox requests section. */

const HOUR = 3_600_000;
const ORG = "org_drill";

async function studio(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Drill", slug: "drill", tier: "growth", status: "active",
      ownerEmail: "owner@drill.test", directoryListed: true,
      bookingFeatures: { requireApproval: true },
    } as never);
    await ctx.db.insert("members", { orgId: ORG, name: "Olive Owner", role: "owner", email: "owner@drill.test", clerkUserId: "u_owner", skills: [] } as never);
    const room = await ctx.db.insert("rooms", {
      orgId: ORG, name: "Room A", status: "available", bookable: true,
      hourlyRateCents: 10000, minimumHours: 1, depositPct: 30,
    } as never);
    return room as Id<"rooms">;
  });
}

/** Today, two hours from now on the hour, so it lands on today's board too
 *  (unless the test runs in the last two hours of the day). */
function soon() {
  return (Math.floor(Date.now() / HOUR) + 2) * HOUR;
}

describe("a pending booking request is visible wherever bookings are", () => {
  it("shows on every staff surface, with its artist", async () => {
    const t = convexTest(schema);
    const room = await studio(t);
    const startTime = soon();
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Riley Request", clientEmail: "riley@x.test",
      startTime, durationHours: 1,
    } as never);
    const id = res.sessionId as Id<"sessions">;
    const owner = t.withIdentity({ subject: "u_owner", orgId: ORG });

    const s = await t.run((ctx) => ctx.db.get(id));
    expect(s?.requestStatus).toBe("pending");

    const ids = (rows: { _id: string }[]) => rows.map((r) => r._id);
    expect(ids(await owner.query(api.sessions.list, {}))).toContain(id);
    expect(ids(await owner.query(api.sessions.inRange, { from: startTime - HOUR, to: startTime + HOUR }))).toContain(id);
    expect(ids(await owner.query(api.sessions.upcoming, { limit: 6 }))).toContain(id);
    expect(ids(await owner.query(api.bookingRequests.pending, {}))).toContain(id);

    const artist = await owner.query(api.artists.get, { id: s!.artistId });
    expect(artist?.sessions.map((x) => x._id)).toContain(id);

    const sheet = await owner.query(api.sessions.get, { id });
    expect(sheet?.requestStatus).toBe("pending");
    expect(sheet?.artistId).toBe(s!.artistId);

    const today = await owner.query(api.today.today, {});
    const sameDay = new Date(startTime).toDateString() === new Date().toDateString();
    if (sameDay) {
      const row = today.sessions.find((x: { _id: string }) => x._id === id);
      expect(row).toBeDefined();
      // The Today panel can open the client page too.
      expect(row?.artistId).toBe(s!.artistId);
    }
  });

  it("dashboard upcoming skips cancelled bookings so they never crowd out live ones", async () => {
    const t = convexTest(schema);
    const room = await studio(t);
    const owner = t.withIdentity({ subject: "u_owner", orgId: ORG });
    const artistId = await t.run((ctx) =>
      ctx.db.insert("artists", { orgId: ORG, name: "Cal Cancel", type: "artist", genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid" } as never),
    );
    const base = Date.now() + 24 * HOUR;
    await t.run(async (ctx) => {
      for (let i = 0; i < 6; i++) {
        await ctx.db.insert("sessions", {
          orgId: ORG, artistId, roomId: room, title: `Cancelled ${i}`, serviceType: "recording",
          startTime: base + i * HOUR, endTime: base + i * HOUR + HOUR, status: "cancelled",
          rateCents: 0, depositCents: 0, depositPaid: false, intakeCompleted: false,
        } as never);
      }
      await ctx.db.insert("sessions", {
        orgId: ORG, artistId, roomId: room, title: "Live one", serviceType: "recording",
        startTime: base + 10 * HOUR, endTime: base + 11 * HOUR, status: "confirmed",
        rateCents: 0, depositCents: 0, depositPaid: false, intakeCompleted: false,
      } as never);
    });
    const rows = await owner.query(api.sessions.upcoming, { limit: 6 });
    expect(rows.map((r) => r.title)).toEqual(["Live one"]);
  });
});
