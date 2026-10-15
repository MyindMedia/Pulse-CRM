import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { PULSE_ORIGIN_TAG } from "./lib/google";
import { mapEventDetails, plainText } from "./lib/googleEvents";
import { sessionToCalendarEvent } from "./googleCalendar";
import { googleWorkFor } from "./lib/googleCalendarTrigger";
import type { Doc, Id } from "./_generated/dataModel";

/* "From Google": the studio pull keeps event details, the review list
   matches rooms / clients / engineers, import links a booking to the same
   Google event, auto-import takes only confident conflict-free events. */

const ORG = "gimport_org";
const OTHER = "gimport_other";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("event details (pure)", () => {
  it("keeps title, times, location, guests, link; strips description HTML and caps it", () => {
    const r = mapEventDetails(
      {
        id: "e1",
        summary: "  Kendra vocals ",
        start: { date: "2030-01-15" },
        end: { date: "2030-01-16" },
        location: "Studio A",
        description: "<b>Bring</b> the stems<br>Thanks &amp; see you",
        htmlLink: "https://www.google.com/calendar/event?eid=x",
        organizer: { email: "studio@x.com", self: true },
        attendees: [{ email: "k@x.com", displayName: "Kendra", responseStatus: "accepted" }, { displayName: "Studio A", resource: true }],
        recurringEventId: "rec1",
        updated: "2030-01-01T00:00:00Z",
      },
      () => false,
    );
    expect(r.kind).toBe("upsert");
    if (r.kind !== "upsert") return;
    expect(r.details).toMatchObject({
      title: "Kendra vocals",
      allDay: true,
      location: "Studio A",
      description: "Bring the stems\nThanks & see you",
      organizerEmail: "studio@x.com",
      recurringEventId: "rec1",
      status: "confirmed",
    });
    expect(r.details.attendees[1]).toMatchObject({ name: "Studio A", resource: true });
    expect(plainText("x".repeat(5000), 2000)!.length).toBe(2000);
  });

  it("skips Pulse's own events, reports cancellations", () => {
    expect(mapEventDetails({ id: "p1", start: { dateTime: "2030-01-01T10:00:00Z" }, end: { dateTime: "2030-01-01T11:00:00Z" } }, () => true).kind).toBe("skip");
    expect(mapEventDetails({ id: "c1", status: "cancelled" }, () => false)).toEqual({ kind: "cancel", googleEventId: "c1" });
  });

  it("an imported booking's push keeps the studio's description and adds no Pulse tag", () => {
    const body = sessionToCalendarEvent({ title: "Kendra vocals", startTime: 1, endTime: 2, status: "confirmed", serviceType: "recording", imported: true });
    expect(body.summary).toBe("Kendra vocals");
    expect(body.description).toBeUndefined();
    expect(body.extendedProperties).toBeUndefined();
  });

  it("creating an imported booking does not push a second Google event", () => {
    const doc = { source: "google", googleCalendarEventId: "g1", title: "t", startTime: 1, endTime: 2, status: "confirmed" } as unknown as Doc<"sessions">;
    expect(googleWorkFor({ id: "s" as Id<"sessions">, operation: "insert", oldDoc: null, newDoc: doc })).toBeNull();
    expect(googleWorkFor({ id: "s" as Id<"sessions">, operation: "update", oldDoc: doc, newDoc: { ...doc, startTime: 5 } })).toEqual({ kind: "push" });
  });
});

describe("studio pull, review list and import (mocked Google)", () => {
  let t: ReturnType<typeof convexTest>;
  let calls: { method: string; url: string; body?: Record<string, unknown> }[];
  let listItems: object[];
  let ids: { owner: Id<"members">; manager: Id<"members">; eng: Id<"members">; roomA: Id<"rooms">; roomB: Id<"rooms">; kendra: Id<"artists"> };

  const start = Date.UTC(2030, 0, 15, 18); // far future, inside the window via fake time
  const iso = (ms: number) => new Date(ms).toISOString();
  const ev = (id: string, o: object = {}) => ({
    id,
    status: "confirmed",
    summary: "Outside booking",
    start: { dateTime: iso(start) },
    end: { dateTime: iso(start + 2 * HOUR) },
    htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
    ...o,
  });

  const as = (clerk: string, org = ORG) => t.withIdentity({ subject: clerk, orgId: org });
  const owner = () => as("u_own");
  const pull = (orgId = ORG) => t.action(internal.googleCalendarSync.pullOrg, { orgId });
  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start - 2 * DAY);
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    calls = [];
    listItems = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at", expires_in: 3600 });
        calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (method === "GET") return Response.json({ items: listItems, nextSyncToken: "tok" });
        if (method === "PATCH") {
          const id = decodeURIComponent(url.split("/events/")[1] ?? "");
          return Response.json({ id });
        }
        if (method === "POST") return Response.json({ id: String((JSON.parse(String(init?.body)) as { id?: string }).id ?? "x") });
        return new Response(null, { status: 204 });
      }),
    );
    t = convexTest(schema);
    ids = await t.run(async (ctx) => {
      for (const [orgId, slug] of [[ORG, "gi"], [OTHER, "gi-other"]] as const) {
        await ctx.db.insert("orgs", {
          orgId,
          name: orgId,
          slug,
          tier: "core",
          status: "active",
          googleRefreshToken: "rt",
          googleEmail: `studio@${slug}.com`,
        } as never);
      }
      const m = (name: string, role: string, clerk: string, email: string) =>
        ctx.db.insert("members", { orgId: ORG, name, role, clerkUserId: clerk, email, skills: [] } as never);
      const room = (name: string, rate: number) =>
        ctx.db.insert("rooms", { orgId: ORG, name, status: "available", bookable: true, hourlyRateCents: rate, minimumHours: 1, depositPct: 30 } as never);
      return {
        owner: await m("Olive", "owner", "u_own", "owner@gi.com"),
        manager: await m("Max", "manager", "u_mgr", "mgr@gi.com"),
        eng: await m("Eve", "engineer", "u_eng", "eve@gi.com"),
        roomA: await room("Studio A", 10_000),
        roomB: await room("Studio B", 5_000),
        kendra: await ctx.db.insert("artists", {
          orgId: ORG, name: "Kendra Mills", type: "artist", email: "kendra@example.com",
          genres: [], tags: [], status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
        }),
      };
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("the pull stores details, keeps busy blocks, and skips events Pulse pushed", async () => {
    listItems = [
      ev("g1", { location: "Studio A", description: "Bring stems", attendees: [{ email: "kendra@example.com", displayName: "Kendra" }] }),
      ev("pulse1", { summary: "Pushed", extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } } }),
    ];
    await pull();
    const rows = await t.run((ctx) => ctx.db.query("googleEvents").collect());
    expect(rows.map((r) => r.googleEventId)).toEqual(["g1"]);
    expect(rows[0]).toMatchObject({ orgId: ORG, title: "Outside booking", location: "Studio A", description: "Bring stems", calendarId: "primary", matchedRoomId: ids.roomA });
    expect(rows[0].attendees[0]).toMatchObject({ email: "kendra@example.com", name: "Kendra" });
    const blocks = await t.run((ctx) => ctx.db.query("googleBusyBlocks").collect());
    expect(blocks.map((b) => b.googleEventId)).toEqual(["g1"]); // busy time unchanged

    // Push-only studios read nothing.
    await t.run(async (ctx) => {
      const o = (await ctx.db.query("orgs").collect()).find((x) => x.orgId === ORG)!;
      await ctx.db.patch(o._id, { googleSyncDirection: "push" });
    });
    calls = [];
    await pull();
    expect(calls).toHaveLength(0);
    const list = await owner().query(api.googleImport.reviewList, {});
    expect(list.enabled).toBe(false);
    expect(list.events).toEqual([]);
  });

  it("the review list shows details and matches; import links one booking, idempotently", async () => {
    listItems = [ev("g1", { location: "Studio A", description: "Bring stems", attendees: [{ email: "kendra@example.com", displayName: "Kendra" }, { email: "eve@gi.com" }] })];
    await pull();
    const list = await owner().query(api.googleImport.reviewList, {});
    expect(list.events).toHaveLength(1);
    const e = list.events[0];
    expect(e).toMatchObject({ title: "Outside booking", location: "Studio A", description: "Bring stems", conflict: null });
    expect(e.room).toMatchObject({ roomId: ids.roomA, confidence: "exact", roomName: "Studio A" });
    expect(e.client).toMatchObject({ kind: "existing", artistId: ids.kendra });
    expect(e.engineer).toMatchObject({ memberId: ids.eng });

    calls = [];
    const r1 = await owner().mutation(api.googleImport.importEvent, { eventId: e._id });
    const r2 = await owner().mutation(api.googleImport.importEvent, { eventId: e._id });
    expect(r2).toEqual({ sessionId: r1.sessionId, already: true });
    await drain();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0); // no second Google event

    const s = (await t.run((ctx) => ctx.db.get(r1.sessionId)))!;
    expect(s).toMatchObject({
      orgId: ORG, source: "google", googleCalendarEventId: "g1", status: "confirmed", roomId: ids.roomA,
      artistId: ids.kendra, engineerId: ids.eng, rateCents: 20_000, startTime: start, endTime: start + 2 * HOUR,
    });
    expect(await t.run((ctx) => ctx.db.query("sessions").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("googleBusyBlocks").collect())).toHaveLength(0);
    const notes = await t.run((ctx) => ctx.db.query("sessionNotes").collect());
    expect(notes[0].body).toContain("Bring stems");
    expect((await owner().query(api.googleImport.reviewList, {})).events).toHaveLength(0);

    // A later pull of the same event does not bring it back.
    await pull();
    expect((await owner().query(api.googleImport.reviewList, {})).events).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("googleBusyBlocks").collect())).toHaveLength(0);
  });

  it("the studio can pick the room and a new client; the new client is created once", async () => {
    listItems = [ev("g2", { summary: "Writing camp", attendees: [{ email: "new@x.com", displayName: "New Writer" }] })];
    await pull();
    const [e] = (await owner().query(api.googleImport.reviewList, {})).events;
    expect(e.room.roomId).toBeNull();
    expect(e.client).toEqual({ kind: "new", name: "New Writer", email: "new@x.com" });
    const { sessionId } = await owner().mutation(api.googleImport.importEvent, {
      eventId: e._id, roomId: ids.roomB, newClient: { name: "New Writer", email: "new@x.com" }, serviceType: "writing", engineerId: null,
    });
    const s = (await t.run((ctx) => ctx.db.get(sessionId)))!;
    expect(s).toMatchObject({ roomId: ids.roomB, serviceType: "writing", rateCents: 10_000 });
    expect(s.engineerId).toBeUndefined();
    const writers = await t.run((ctx) => ctx.db.query("artists").filter((q) => q.eq(q.field("email"), "new@x.com")).collect());
    expect(writers).toHaveLength(1);
  });

  it("flags a room conflict and refuses to import over it", async () => {
    await t.run((ctx) =>
      ctx.db.insert("sessions", {
        orgId: ORG, title: "Pulse booking", artistId: ids.kendra, serviceType: "recording", roomId: ids.roomA,
        startTime: start + HOUR, endTime: start + 3 * HOUR, status: "confirmed", rateCents: 0, depositCents: 0, depositPaid: false, intakeCompleted: false,
      }),
    );
    listItems = [ev("g3", { location: "Studio A" })];
    await pull();
    const [e] = (await owner().query(api.googleImport.reviewList, {})).events;
    expect(e.conflict).toMatchObject({ kind: "session" });
    await expect(owner().mutation(api.googleImport.importEvent, { eventId: e._id })).rejects.toThrow(/already booked/);
    // Another room is free.
    expect(await owner().query(api.googleImport.conflictFor, { eventId: e._id, roomId: ids.roomB })).toBeNull();
  });

  it("two Google events at once in different rooms do not block each other", async () => {
    listItems = [ev("gA", { location: "Studio A" }), ev("gB", { location: "Studio B" })];
    await pull();
    const list = await owner().query(api.googleImport.reviewList, {});
    expect(list.events.map((e) => e.conflict)).toEqual([null, null]);
    // A Google event naming no room still holds the whole studio.
    listItems = [ev("gX", { summary: "Dentist" })];
    await pull();
    const again = await owner().query(api.googleImport.reviewList, {});
    expect(again.events.find((e) => e.googleEventId === "gA")?.conflict).toMatchObject({ kind: "google" });
  });

  it("auto-import takes only confident, conflict-free events with a known client", async () => {
    await owner().mutation(api.googleImport.setAutoImport, { enabled: true });
    await t.run((ctx) =>
      ctx.db.insert("sessions", {
        orgId: ORG, title: "Pulse booking", artistId: ids.kendra, serviceType: "recording", roomId: ids.roomB,
        startTime: start + 3 * DAY, endTime: start + 3 * DAY + 2 * HOUR, status: "confirmed", rateCents: 0, depositCents: 0, depositPaid: false, intakeCompleted: false,
      }),
    );
    listItems = [
      ev("ok", { location: "Studio A", attendees: [{ email: "kendra@example.com" }] }),
      ev("weak", { summary: "drums in room b", start: { dateTime: iso(start + DAY) }, end: { dateTime: iso(start + DAY + HOUR) }, attendees: [{ email: "kendra@example.com" }] }),
      ev("noclient", { location: "Studio B", start: { dateTime: iso(start + 2 * DAY) }, end: { dateTime: iso(start + 2 * DAY + HOUR) } }),
      ev("clash", { location: "Studio B", start: { dateTime: iso(start + 3 * DAY + HOUR) }, end: { dateTime: iso(start + 3 * DAY + 2 * HOUR) }, attendees: [{ email: "x@y.com", displayName: "X" }] }),
      ev("cancelled", { status: "cancelled" }),
    ];
    await pull();
    const sessions = await t.run((ctx) => ctx.db.query("sessions").filter((q) => q.eq(q.field("source"), "google")).collect());
    expect(sessions.map((s) => s.googleCalendarEventId)).toEqual(["ok"]);
    const waiting = (await owner().query(api.googleImport.reviewList, {})).events.map((e) => e.googleEventId).sort();
    expect(waiting).toEqual(["clash", "noclient", "weak"]);

    // Off by default; switching it off stops it.
    await owner().mutation(api.googleImport.setAutoImport, { enabled: false });
    listItems = [ev("later", { location: "Studio B", start: { dateTime: iso(start + 5 * DAY) }, end: { dateTime: iso(start + 5 * DAY + HOUR) }, attendees: [{ email: "kendra@example.com" }] })];
    await pull();
    expect(await t.run((ctx) => ctx.db.query("sessions").filter((q) => q.eq(q.field("source"), "google")).collect())).toHaveLength(1);

    // The bulk button does the same, on demand.
    const res = await owner().mutation(api.googleImport.importAllMatched, {});
    expect(res.imported).toBe(1);
    expect(res.skipped.map((s) => s.title)).toHaveLength(2);
  });

  it("an imported booking moved, re-roomed or deleted in Google becomes a change request, never a silent edit", async () => {
    listItems = [ev("g1", { location: "Studio A", attendees: [{ email: "kendra@example.com" }] })];
    await pull();
    const [e] = (await owner().query(api.googleImport.reviewList, {})).events;
    const { sessionId } = await owner().mutation(api.googleImport.importEvent, { eventId: e._id });

    listItems = [ev("g1", { location: "Studio B", start: { dateTime: iso(start + HOUR) }, end: { dateTime: iso(start + 3 * HOUR) } })];
    await pull();
    let reqs = await t.run((ctx) => ctx.db.query("sessionChangeRequests").collect());
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ origin: "google", status: "pending", proposed: { startTime: start + HOUR, endTime: start + 3 * HOUR, roomId: ids.roomB } });
    const s = (await t.run((ctx) => ctx.db.get(sessionId)))!;
    expect(s.startTime).toBe(start);
    expect(s.roomId).toBe(ids.roomA);
    expect(s.googleChangedAt).toBeTypeOf("number");

    // The same edit seen again (a description change) neither stacks nor withdraws it.
    listItems = [ev("g1", { location: "Studio B", description: "new notes", start: { dateTime: iso(start + HOUR) }, end: { dateTime: iso(start + 3 * HOUR) } })];
    await pull();
    reqs = await t.run((ctx) => ctx.db.query("sessionChangeRequests").collect());
    expect(reqs).toHaveLength(1);
    expect(reqs[0].status).toBe("pending");

    listItems = [{ id: "g1", status: "cancelled" }];
    await pull();
    reqs = await t.run((ctx) => ctx.db.query("sessionChangeRequests").collect());
    expect(reqs).toHaveLength(1);
    expect(reqs[0].proposed).toEqual({ status: "cancelled" });
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.status).toBe("confirmed");
  });

  it("an edit to an imported booking in Pulse patches the same Google event", async () => {
    listItems = [ev("g1", { location: "Studio A", attendees: [{ email: "kendra@example.com" }] })];
    await pull();
    const [e] = (await owner().query(api.googleImport.reviewList, {})).events;
    const { sessionId } = await owner().mutation(api.googleImport.importEvent, { eventId: e._id });
    await drain();
    calls = [];
    await owner().mutation(api.sessions.reschedule, { id: sessionId, startTime: start + DAY, endTime: start + DAY + 2 * HOUR } as never);
    await drain();
    const writes = calls.filter((c) => c.method !== "GET");
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((c) => c.method === "PATCH" && c.url.endsWith("/events/g1"))).toBe(true);
    expect(writes[0].body?.description).toBeUndefined();
  });

  it("engineers can read the list but cannot import, ignore or switch auto-import", async () => {
    listItems = [ev("g1", { location: "Studio A" })];
    await pull();
    const list = await as("u_eng").query(api.googleImport.reviewList, {});
    expect(list.canManage).toBe(false);
    expect(list.events).toHaveLength(1);
    const id = list.events[0]._id;
    await expect(as("u_eng").mutation(api.googleImport.importEvent, { eventId: id })).rejects.toThrow();
    await expect(as("u_eng").mutation(api.googleImport.ignoreEvent, { eventId: id })).rejects.toThrow();
    await expect(as("u_eng").mutation(api.googleImport.setAutoImport, { enabled: true })).rejects.toThrow();
    expect((await as("u_mgr").query(api.googleImport.reviewList, {})).canManage).toBe(true);
    await as("u_mgr").mutation(api.googleImport.ignoreEvent, { eventId: id });
    expect((await owner().query(api.googleImport.reviewList, {})).events).toHaveLength(0);
    await as("u_mgr").mutation(api.googleImport.unignoreEvent, { eventId: id });
    expect((await owner().query(api.googleImport.reviewList, {})).events).toHaveLength(1);
  });

  it("another studio never sees or imports these events", async () => {
    const otherOwner = await t.run((ctx) =>
      ctx.db.insert("members", { orgId: OTHER, name: "Other", role: "owner", clerkUserId: "u_other", email: "o@other.com", skills: [] } as never),
    );
    expect(otherOwner).toBeTruthy();
    listItems = [ev("g1", { location: "Studio A", description: "private notes", attendees: [{ email: "kendra@example.com" }] })];
    await pull();
    const theirs = await as("u_other", OTHER).query(api.googleImport.reviewList, {});
    expect(theirs.events).toEqual([]);
    expect(JSON.stringify(theirs)).not.toContain("private notes");
    const [mine] = (await owner().query(api.googleImport.reviewList, {})).events;
    await expect(as("u_other", OTHER).mutation(api.googleImport.importEvent, { eventId: mine._id })).rejects.toThrow(/not found/i);
    await expect(as("u_other", OTHER).mutation(api.googleImport.ignoreEvent, { eventId: mine._id })).rejects.toThrow(/not found/i);
    expect(await as("u_other", OTHER).query(api.googleImport.conflictFor, { eventId: mine._id, roomId: ids.roomA })).toBeNull();
  });
});
