import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { roomConflict } from "./lib/roomBusy";
import { pulseEventId } from "./googleCalendar";

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

/* Review 2026-11-12 R09: a Pulse booking pushed to Google came back through
   that calendar's .ics feed and blocked its own reschedule and, once
   cancelled, its freed slot. */
describe("a feed's copy of a Pulse booking does not block", () => {
  let t: ReturnType<typeof convexTest>;
  let room: Id<"rooms">;
  let session: Id<"sessions">;
  let dayStart: number;
  let start: number;

  beforeEach(async () => {
    t = convexTest(schema);
    dayStart = Math.floor((Date.now() + 7 * DAY) / DAY) * DAY;
    start = dayStart + 14 * HOUR;
    const ids = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org1", name: "Slang City", slug: "slang-city", tier: "growth", status: "active",
      } as never);
      const r = await ctx.db.insert("rooms", {
        orgId: "org1", name: "Live Room", status: "available", bookable: true,
        hourlyRateCents: 5000, minimumHours: 2, depositPct: 25,
      } as never);
      const artistId = await ctx.db.insert("artists", {
        orgId: "org1", name: "Nova", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      } as never);
      const s = await ctx.db.insert("sessions", {
        orgId: "org1", title: "Tracking", artistId, roomId: r, serviceType: "recording",
        startTime: start, endTime: start + 3 * HOUR, status: "confirmed",
        rateCents: 0, depositCents: 0, depositPaid: true, intakeCompleted: true,
      } as never);
      const f = await ctx.db.insert("externalCalendars", {
        orgId: "org1", roomId: r, label: "Google", source: "google",
        icalUrl: "https://calendar.google.com/calendar/ical/x/private-y/basic.ics", active: true,
      });
      await ctx.db.insert("externalCalendarEvents", {
        orgId: "org1", calendarId: f, roomId: r, externalUid: `${pulseEventId(s)}@google.com`,
        title: "Tracking", startTime: start, endTime: start + 3 * HOUR,
      });
      return { r, s };
    });
    room = ids.r;
    session = ids.s;
  });

  it("extending the session is not blocked by its own copy", async () => {
    const hit = await t.run((ctx) =>
      roomConflict(ctx, { orgId: "org1", roomId: room, start, end: start + 4 * HOUR, excludeSessionId: session }),
    );
    expect(hit).toBeNull();
  });

  it("a cancelled session's slot is free again before the feed refreshes", async () => {
    await t.run((ctx) => ctx.db.patch(session, { status: "cancelled" }));
    const res = await t.query(api.booking.availability, { roomId: room, dayStart });
    expect(res.slots.find((s) => s.hour === 15)!.available).toBe(true);
  });

  it("an imported Google session's copy is matched by its Google event id", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(session, { googleCalendarEventId: "abc123googleid", status: "cancelled" });
      const ev = (await ctx.db.query("externalCalendarEvents").first())!;
      await ctx.db.patch(ev._id, { externalUid: "abc123googleid@google.com" });
    });
    const hit = await t.run((ctx) => roomConflict(ctx, { orgId: "org1", roomId: room, start, end: start + HOUR }));
    expect(hit).toBeNull();
  });

  it("an unrelated feed event in the same slot still blocks", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(session, { status: "cancelled" });
      const ev = (await ctx.db.query("externalCalendarEvents").first())!;
      await ctx.db.patch(ev._id, { externalUid: "pulse-party@example.com" });
    });
    const hit = await t.run((ctx) => roomConflict(ctx, { orgId: "org1", roomId: room, start, end: start + HOUR }));
    expect(hit?.kind).toBe("calendar");
  });
});

/* Review 2026-11-12 R27: the refresh rewrote every event on every run and
   the cron took a fixed 25 feeds. */
describe("feed refresh keeps writes and staleness bounded", () => {
  it("upsertEvents leaves unchanged rows alone, updates changed ones and removes dropped ones", async () => {
    const t = convexTest(schema);
    const feed = await t.run(async (ctx) => {
      const r = await ctx.db.insert("rooms", { orgId: "org1", name: "A", status: "available" } as never);
      return await ctx.db.insert("externalCalendars", {
        orgId: "org1", roomId: r, label: "Feed", source: "ical", icalUrl: "https://x.example/a.ics", active: true,
      });
    });
    const ev = (uid: string, startTime: number, title = uid) => ({ uid, title, startTime, endTime: startTime + HOUR, allDay: false });
    await t.mutation(internal.externalCalendars.upsertEvents, {
      calendarId: feed, events: [ev("a", 1_000), ev("b", 2_000), ev("c", 3_000)],
    });
    const rows = async () =>
      await t.run((ctx) => ctx.db.query("externalCalendarEvents").withIndex("by_calendar", (q) => q.eq("calendarId", feed)).collect());
    const before = new Map((await rows()).map((r) => [r.externalUid, r]));

    await t.mutation(internal.externalCalendars.upsertEvents, {
      calendarId: feed, events: [ev("a", 1_000), ev("b", 2_500, "moved"), ev("d", 4_000)],
    });
    const after = new Map((await rows()).map((r) => [r.externalUid, r]));
    expect([...after.keys()].sort()).toEqual(["a", "b", "d"]);
    // Unchanged: the very same document, never rewritten.
    expect(after.get("a")!._id).toBe(before.get("a")!._id);
    // Changed in place.
    expect(after.get("b")!._id).toBe(before.get("b")!._id);
    expect(after.get("b")!.startTime).toBe(2_500);
    expect(after.get("b")!.title).toBe("moved");
    const cal = await t.run((ctx) => ctx.db.get(feed));
    expect(cal!.eventCount).toBe(3);
  });

  it("the cron only picks feeds not refreshed recently", async () => {
    const t = convexTest(schema);
    const now = Date.now();
    await t.run(async (ctx) => {
      const r = await ctx.db.insert("rooms", { orgId: "org1", name: "A", status: "available" } as never);
      const feed = (label: string, lastSyncAt?: number) =>
        ctx.db.insert("externalCalendars", {
          orgId: "org1", roomId: r, label, source: "ical", icalUrl: "https://x.example/a.ics", active: true, lastSyncAt,
        });
      await feed("Fresh", now - 60_000);
      await feed("Stale", now - 3 * HOUR);
      await feed("Never");
    });
    const due = await t.query(internal.externalCalendars.dueForRefresh, { limit: 100, before: now - 25 * 60_000 });
    expect(due.map((d) => d.label)).toEqual(["Never", "Stale"]);
  });
});
