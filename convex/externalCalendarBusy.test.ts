import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/* Truth audit B3 (bookings-clients-feat-other-calendars): "Hours that are
   busy on another calendar are shown as unavailable ... Clients cannot book
   a time you are not free." Events from a room's .ics feed (Apple, Outlook,
   Calendly...) used to show only on the staff grid and never blocked the
   public booking page. */

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("outside calendar feeds block bookings", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  let feed: Id<"externalCalendars">;
  let dayStart: number;
  let busyStart: number;

  beforeEach(async () => {
    t = convexTest(schema);
    dayStart = Math.floor((Date.now() + 7 * DAY) / DAY) * DAY;
    busyStart = dayStart + 14 * HOUR;
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Slang City", slug: "slang-city", tier: "growth", status: "active",
      } as never);
      const r = await ctx.db.insert("rooms", {
        orgId: "org1", name: "Live Room", status: "available", bookable: true,
        hourlyRateCents: 5000, minimumHours: 2, depositPct: 25,
      } as never);
      const f = await ctx.db.insert("externalCalendars", {
        orgId: "org1", roomId: r, label: "Outlook", source: "outlook",
        icalUrl: "https://outlook.example.com/cal.ics", active: true,
      });
      await ctx.db.insert("externalCalendarEvents", {
        orgId: "org1", calendarId: f, roomId: r, externalUid: "evt-1",
        title: "Private rehearsal", startTime: busyStart, endTime: busyStart + 2 * HOUR,
      });
      return { r, f };
    });
    room = ids.r;
    feed = ids.f;
  });

  it("the public availability shows those hours as taken, without the event title", async () => {
    const res = await t.query(api.booking.availability, { roomId: room, dayStart });
    const at = (h: number) => res.slots.find((s) => s.hour === h)!;
    expect(at(14).available).toBe(false);
    expect(at(15).available).toBe(false);
    expect(at(16).available).toBe(true);
    expect(JSON.stringify(res)).not.toContain("Private rehearsal");
  });

  it("a client cannot book over a busy outside-calendar event", async () => {
    await expect(
      t.mutation(api.booking.createBooking, {
        roomId: room, clientName: "Nova", clientEmail: "nova@x.com",
        startTime: busyStart + HOUR, durationHours: 2,
      }),
    ).rejects.toThrow(/unavailable/);
  });

  it("a paused feed no longer blocks", async () => {
    await t.run((ctx) => ctx.db.patch(feed, { active: false }));
    const res = await t.query(api.booking.availability, { roomId: room, dayStart });
    expect(res.slots.find((s) => s.hour === 14)!.available).toBe(true);
  });

  it("the refresh cron picks active feeds, never-synced and stalest first, bounded", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(feed, { lastSyncAt: 5 });
      await ctx.db.insert("externalCalendars", {
        orgId: "org2", roomId: room, label: "New", source: "ical", icalUrl: "https://x.example/a.ics", active: true,
      });
      await ctx.db.insert("externalCalendars", {
        orgId: "org2", roomId: room, label: "Paused", source: "ical", icalUrl: "https://x.example/b.ics", active: false,
      });
    });
    const due = await t.query(internal.externalCalendars.dueForRefresh, { limit: 10 });
    expect(due.map((d) => d.label)).toEqual(["New", "Outlook"]);
    const one = await t.query(internal.externalCalendars.dueForRefresh, { limit: 1 });
    expect(one).toHaveLength(1);
  });
});
