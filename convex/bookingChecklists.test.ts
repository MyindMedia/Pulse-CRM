import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Truth audit B3 (bookings-clients-feat-checklists): "Pulse writes the list
   when the session is booked." Staff bookings always did; bookings made on
   the public booking page got no before/after checklist at all. */

const DAY = 86_400_000;

describe("public booking stages checklists", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;

  beforeEach(async () => {
    t = convexTest(schema);
    room = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Slang City", slug: "slang-city", tier: "growth", status: "active",
      } as never);
      return ctx.db.insert("rooms", {
        orgId: "org1", name: "Live Room", status: "available", bookable: true,
        hourlyRateCents: 5000, minimumHours: 2, depositPct: 25,
      } as never);
    });
  });

  it("a session booked online gets a pre and a post checklist", async () => {
    const res = await t.mutation(api.booking.createBooking, {
      roomId: room, clientName: "Nova", clientEmail: "nova@x.com",
      startTime: Date.now() + 7 * DAY, durationHours: 2,
    });
    const lists = (await t.run((ctx) => ctx.db.query("sessionChecklists").collect()))
      .filter((l) => l.sessionId === res.sessionId);
    expect(lists.map((l) => l.kind).sort()).toEqual(["post", "pre"]);
    expect(lists.every((l) => l.roomId === room && l.orgId === "org1")).toBe(true);
    expect(lists.every((l) => l.items.length > 0)).toBe(true);
  });
});
