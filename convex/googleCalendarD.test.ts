import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { sessionToCalendarEvent, roomBlockToCalendarEvent } from "./googleCalendar";
import { classifyPulseEvent } from "./googleCalendarSync";
import { mapMemberEvent, memberEventId, memberPulls, memberPushes } from "./memberCalendar";
import { memberWorkForSession, memberWorkForShift, blockWorkFor } from "./lib/googleCalendarTrigger";
import { googleRedirectUri, PULSE_ORIGIN_TAG } from "./lib/google";
import { callbackTarget } from "./lib/googleCallback";
import type { Doc, Id } from "./_generated/dataModel";

const ORG = "pulse-demo";
const HOUR = 3_600_000;

describe("mapping (pure)", () => {
  const base = { title: "Mix", startTime: 1, endTime: 2, status: "confirmed" as const };
  it("pending requests are tentative, approved and confirmed are confirmed, declined is removed", () => {
    expect(sessionToCalendarEvent({ ...base, status: "confirmed", requestStatus: "pending" }).status).toBe("tentative");
    expect(sessionToCalendarEvent({ ...base, requestStatus: "approved" }).status).toBe("confirmed");
    expect(sessionToCalendarEvent(base).status).toBe("confirmed");
    expect(sessionToCalendarEvent({ ...base, requestStatus: "declined" }).status).toBe("cancelled");
  });
  it("every pushed event carries the Pulse tag and shows busy", () => {
    const e = sessionToCalendarEvent(base);
    expect(e.extendedProperties?.private?.[PULSE_ORIGIN_TAG]).toBe("1");
    const b = roomBlockToCalendarEvent({ label: "Acme album", startTime: 1, endTime: 2, roomName: "A" });
    expect(b.summary).toBe("Acme album");
    expect(b.transparency).toBe("opaque");
    expect(b.extendedProperties?.private?.[PULSE_ORIGIN_TAG]).toBe("1");
  });
  it("redirect URI honors GOOGLE_REDIRECT_URI and defaults to the Convex endpoint", () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://x.convex.site");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "");
    expect(googleRedirectUri()).toBe("https://x.convex.site/google/callback");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "https://studiopulse.tech/google/callback");
    expect(googleRedirectUri()).toBe("https://studiopulse.tech/google/callback");
    vi.unstubAllEnvs();
  });
  it("callback targets name the reason and the right screen", () => {
    expect(callbackTarget("https://a.b", "studio", "access_denied")).toBe("https://a.b/settings?tab=integrations&google=error&reason=access_denied");
    expect(callbackTarget("https://a.b", "member", "connected")).toBe("https://a.b/schedule?google=connected");
  });
  it("member events keep no title, skip Pulse's own and free time", () => {
    const r = mapMemberEvent({ id: "e1", summary: "Dentist", start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } });
    expect(r.kind).toBe("upsert");
    expect(JSON.stringify(r)).not.toContain("Dentist");
    expect(mapMemberEvent({ id: "e2", extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } }, start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } }).kind).toBe("skip");
    expect(mapMemberEvent({ id: "e3", transparency: "transparent", start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } }).kind).toBe("skip");
    expect(mapMemberEvent({ id: "e4", status: "cancelled" })).toEqual({ kind: "cancel", googleEventId: "e4" });
  });
  it("member event ids are deterministic and differ per member", () => {
    expect(memberEventId("m1", "s1")).toBe(memberEventId("m1", "s1"));
    expect(memberEventId("m1", "s1")).not.toBe(memberEventId("m2", "s1"));
    expect(memberEventId("m1", "s1")).toMatch(/^[0-9a-v]+$/);
  });
  it("classifies a moved or deleted Pulse booking, ignores foreign events", () => {
    const map = new Map([["pulseA", { sessionId: "s1", startTime: 1000, endTime: 2000 }]]);
    const ev = (o: object) => ({ id: "pulseA", start: { dateTime: new Date(1000).toISOString() }, end: { dateTime: new Date(2000).toISOString() }, ...o });
    expect(classifyPulseEvent(ev({}), map)?.kind).toBe("unchanged");
    expect(classifyPulseEvent(ev({ start: { dateTime: new Date(5000).toISOString() }, end: { dateTime: new Date(9000).toISOString() } }), map)).toEqual({ kind: "moved", sessionId: "s1", startTime: 5000, endTime: 9000 });
    expect(classifyPulseEvent({ id: "pulseA", status: "cancelled" }, map)).toEqual({ kind: "deleted", sessionId: "s1" });
    expect(classifyPulseEvent({ id: "other" }, map)).toBeNull();
  });
  it("direction gates member push and pull", () => {
    const cal = (d: string, t = "rt") => ({ refreshToken: t, syncDirection: d }) as unknown as Doc<"memberCalendars">;
    expect([memberPushes(cal("two_way")), memberPushes(cal("push")), memberPushes(cal("pull")), memberPushes(cal("off"))]).toEqual([true, true, false, false]);
    expect([memberPulls(cal("two_way")), memberPulls(cal("pull")), memberPulls(cal("push")), memberPulls(cal("off"))]).toEqual([true, true, false, false]);
    expect(memberPulls(cal("two_way", ""))).toBe(false);
  });
  it("trigger work: engineer change moves the event, shifts skip session shifts, blocks push on change", () => {
    const s = (o: object) => ({ engineerId: "m1", title: "t", startTime: 1, endTime: 2, status: "confirmed", ...o }) as unknown as Doc<"sessions">;
    const ch = (operation: "insert" | "update" | "delete", oldDoc: Doc<"sessions"> | null, newDoc: Doc<"sessions"> | null) => ({ id: "s" as Id<"sessions">, operation, oldDoc, newDoc });
    expect(memberWorkForSession(ch("insert", null, s({})))).toEqual([{ memberId: "m1", kind: "push" }]);
    expect(memberWorkForSession(ch("update", s({}), s({ engineerId: "m2" })))).toEqual([{ memberId: "m1", kind: "remove" }, { memberId: "m2", kind: "push" }]);
    expect(memberWorkForSession(ch("update", s({}), s({ notes: "x" })))).toEqual([]);
    expect(memberWorkForSession(ch("delete", s({}), null))).toEqual([{ memberId: "m1", kind: "remove" }]);
    const sh = (o: object) => ({ memberId: "m1", kind: "scheduled", startTime: 1, endTime: 2, status: "scheduled", ...o }) as unknown as Doc<"shifts">;
    expect(memberWorkForShift({ id: "x" as Id<"shifts">, operation: "insert", oldDoc: null, newDoc: sh({ kind: "session" }) })).toEqual([]);
    expect(memberWorkForShift({ id: "x" as Id<"shifts">, operation: "insert", oldDoc: null, newDoc: sh({}) })).toEqual([{ memberId: "m1", kind: "push" }]);
    const blk = (o: object) => ({ label: "L", startTime: 1, endTime: 2, roomId: "r", ...o }) as unknown as Doc<"roomBlocks">;
    expect(blockWorkFor({ id: "b" as Id<"roomBlocks">, operation: "insert", oldDoc: null, newDoc: blk({}) })).toEqual({ kind: "push" });
    expect(blockWorkFor({ id: "b" as Id<"roomBlocks">, operation: "update", oldDoc: blk({}), newDoc: blk({ googleCalendarEventId: "e" }) })).toBeNull();
    expect(blockWorkFor({ id: "b" as Id<"roomBlocks">, operation: "delete", oldDoc: blk({ googleCalendarEventId: "e" }), newDoc: null })).toEqual({ kind: "remove", eventId: "e" });
  });
});

describe("connected studio against a mocked Google", () => {
  let t: ReturnType<typeof convexTest>;
  let calls: { method: string; url: string; body?: Record<string, unknown> }[];
  let tokenStatus: { status: number; body: object };
  let eventsStatus: number;
  let listItems: object[];

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    calls = [];
    tokenStatus = { status: 200, body: { access_token: "at", expires_in: 3600 } };
    eventsStatus = 200;
    listItems = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json(tokenStatus.body, { status: tokenStatus.status });
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (eventsStatus !== 200) return new Response("boom", { status: eventsStatus });
      if (method === "GET") return Response.json({ items: listItems, nextSyncToken: "tok2" });
      if (method === "PATCH") return new Response("nf", { status: 404 });
      if (method === "POST") return Response.json({ id: String((JSON.parse(String(init?.body)) as { id?: string }).id ?? "x") });
      return new Response(null, { status: 204 });
    }));
    t = convexTest(schema);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const addOrg = (extra: Partial<Doc<"orgs">> = {}) =>
    t.run((ctx) => ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "max", status: "active", googleRefreshToken: "rt", ...extra } as never));
  const book = () =>
    t.mutation(api.sessions.create, { title: "Tracking", clientName: "Walk-in", serviceType: "recording", startTime: Date.now() + 86_400_000, endTime: Date.now() + 86_400_000 + 2 * HOUR, rateCents: 1000 });
  const org = () => t.run(async (ctx) => (await ctx.db.query("orgs").first())!);

  it("pushes to the chosen calendar, and not at all when direction is pull or off", async () => {
    await addOrg({ googleCalendarId: "studio@group.calendar.google.com" });
    await book();
    await drain();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.url.includes(encodeURIComponent("studio@group.calendar.google.com")))).toBe(true);

    for (const dir of ["pull", "off"] as const) {
      calls = [];
      await t.run(async (ctx) => { const o = (await ctx.db.query("orgs").first())!; await ctx.db.patch(o._id, { googleSyncDirection: dir }); });
      await book();
      await drain();
      expect(calls).toEqual([]);
    }
  });

  it("records a push failure on the studio and clears it after a good push", async () => {
    await addOrg();
    eventsStatus = 500;
    await book();
    await drain();
    const o = await org();
    expect(o.googleCalendarPushError).toContain("500");
    expect(o.googleCalendarPushErrorAt).toBeTypeOf("number");
    expect(o.googleRefreshToken).toBe("rt"); // a 500 is not a revoked grant

    eventsStatus = 200;
    await book();
    await drain();
    expect((await org()).googleCalendarPushError).toBeUndefined();
  });

  it("invalid_grant clears the token and marks the connection for reconnect", async () => {
    await addOrg({ emailProvider: "google" });
    tokenStatus = { status: 400, body: { error: "invalid_grant" } };
    await book();
    await drain();
    const o = await org();
    expect(o.googleRefreshToken).toBeUndefined();
    expect(o.googleCalendarSyncError).toBe("reconnect_required");
    expect(o.emailProvider).toBe("internal");
    const st = await t.query(api.googleCalendarSync.status, {});
    expect(st.connected).toBe(false);
    expect(st.needsReconnect).toBe(true);
  });

  it("a Google move or delete of a Pulse booking files ONE change request and never edits the booking", async () => {
    await addOrg();
    const { sessionId } = await book();
    await drain();
    const s0 = (await t.run((ctx) => ctx.db.get(sessionId)))!;
    const eventId = s0.googleCalendarEventId!;
    expect(eventId).toBeTruthy();

    const moved = { id: eventId, status: "confirmed", extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } }, start: { dateTime: new Date(s0.startTime + 3 * HOUR).toISOString() }, end: { dateTime: new Date(s0.endTime + 3 * HOUR).toISOString() } };
    listItems = [moved];
    await t.action(internal.googleCalendarSync.pullOrg, { orgId: ORG });
    await t.action(internal.googleCalendarSync.pullOrg, { orgId: ORG }); // same edit seen twice
    let reqs = await t.run((ctx) => ctx.db.query("sessionChangeRequests").collect());
    expect(reqs).toHaveLength(1);
    expect(reqs[0]).toMatchObject({ origin: "google", status: "pending", proposed: { startTime: s0.startTime + 3 * HOUR } });
    const s1 = (await t.run((ctx) => ctx.db.get(sessionId)))!;
    expect(s1.startTime).toBe(s0.startTime); // not silently edited
    expect(s1.googleChangedAt).toBeTypeOf("number");
    expect(await t.query(api.googleCalendarSync.pendingChangeForSession, { sessionId })).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("googleBusyBlocks").collect())).toHaveLength(0); // not imported as busy time

    listItems = [{ id: eventId, status: "cancelled" }];
    await t.action(internal.googleCalendarSync.pullOrg, { orgId: ORG });
    reqs = await t.run((ctx) => ctx.db.query("sessionChangeRequests").collect());
    expect(reqs).toHaveLength(1); // updated in place, not stacked
    expect(reqs[0].proposed).toEqual({ status: "cancelled" });
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.status).not.toBe("cancelled");
  });

  it("pull-only and off studios read nothing; push-only studios do not pull", async () => {
    await addOrg({ googleSyncDirection: "push" });
    listItems = [{ id: "g1", summary: "x", start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } }];
    await t.action(internal.googleCalendarSync.pullOrg, { orgId: ORG });
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(0);
  });

  it("member pull writes busy blocks without titles; disconnect forgets them", async () => {
    await addOrg();
    const memberId = await t.run((ctx) => ctx.db.insert("members", { orgId: ORG, name: "Eng", role: "engineer", skills: [] } as never));
    await t.run((ctx) => ctx.db.insert("memberCalendars", { orgId: ORG, memberId, googleEmail: "e@x.com", refreshToken: "mrt", syncDirection: "two_way", connectedAt: 1 }));
    listItems = [
      { id: "p1", summary: "Dentist", start: { dateTime: "2026-10-20T15:00:00Z" }, end: { dateTime: "2026-10-20T16:00:00Z" } },
      { id: "p2", summary: "Pulse own", extendedProperties: { private: { [PULSE_ORIGIN_TAG]: "1" } }, start: { dateTime: "2026-10-20T17:00:00Z" }, end: { dateTime: "2026-10-20T18:00:00Z" } },
    ];
    await t.action(internal.memberCalendar.pullMember, { memberId });
    const blocks = await t.run((ctx) => ctx.db.query("memberBusyBlocks").collect());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].googleEventId).toBe("p1");
    expect(JSON.stringify(blocks)).not.toContain("Dentist");
    const cal = await t.run((ctx) => ctx.db.query("memberCalendars").first());
    expect(cal?.syncToken).toBe("tok2");

    // pull direction off: nothing is read
    calls = [];
    await t.run((ctx) => ctx.db.patch(cal!._id, { syncDirection: "push" }));
    await t.action(internal.memberCalendar.pullMember, { memberId });
    expect(calls).toHaveLength(0);
  });

  it("a revoked member grant clears their token", async () => {
    await addOrg();
    const memberId = await t.run((ctx) => ctx.db.insert("members", { orgId: ORG, name: "Eng", role: "engineer", skills: [] } as never));
    await t.run((ctx) => ctx.db.insert("memberCalendars", { orgId: ORG, memberId, googleEmail: "e@x.com", refreshToken: "mrt", syncDirection: "two_way", connectedAt: 1 }));
    tokenStatus = { status: 400, body: { error: "invalid_grant" } };
    await t.action(internal.memberCalendar.pullMember, { memberId });
    const cal = await t.run((ctx) => ctx.db.query("memberCalendars").first());
    expect(cal?.refreshToken).toBe("");
    expect(cal?.syncError).toBe("reconnect_required");
  });

  it("a session assigned to a connected engineer lands on their calendar once, under a fixed id", async () => {
    await addOrg({ googleSyncDirection: "off" });
    const memberId = await t.run((ctx) => ctx.db.insert("members", { orgId: ORG, name: "Eng", role: "engineer", skills: [] } as never));
    await t.run((ctx) => ctx.db.insert("memberCalendars", { orgId: ORG, memberId, googleEmail: "e@x.com", refreshToken: "mrt", syncDirection: "push", calendarId: "mine", connectedAt: 1 }));
    const { sessionId } = await t.mutation(api.sessions.create, { title: "Mix", clientName: "A", serviceType: "mixing", startTime: Date.now() + 86_400_000, endTime: Date.now() + 86_400_000 + HOUR, rateCents: 1, engineerId: memberId } as never);
    await drain();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain("/calendars/mine/events");
    expect(posts[0].body?.id).toBe(memberEventId(memberId, sessionId));
  });
});

describe("callback", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "cid");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "sec");
    vi.stubEnv("APP_URL", "https://app.test");
    t = convexTest(schema);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  const stubToken = (body: object, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
  const loc = async (qs: string) => (await t.fetch(`/google/callback${qs}`, { redirect: "manual" } as never)).headers.get("location");

  it("names the reason: state mismatch, denied, no refresh token, exchange failure", async () => {
    expect(await loc("?code=c&state=nope")).toBe("https://app.test/settings?tab=integrations&google=error&reason=state_mismatch");
    await t.mutation(internal.googleAuth._createOAuthState, { orgId: ORG, nonce: "n1" });
    expect(await loc("?error=access_denied&state=n1")).toContain("reason=access_denied");
    await t.mutation(internal.googleAuth._createOAuthState, { orgId: ORG, nonce: "n2" });
    stubToken({ access_token: "a", expires_in: 3600 });
    expect(await loc("?code=c&state=n2")).toContain("reason=no_refresh_token");
    await t.mutation(internal.googleAuth._createOAuthState, { orgId: ORG, nonce: "n3" });
    stubToken({ error: "invalid_request" }, 400);
    expect(await loc("?code=c&state=n3")).toContain("reason=exchange_failed");
  });

  it("stores the studio token on success, and a member's token for a member state", async () => {
    await t.run((ctx) => ctx.db.insert("orgs", { orgId: ORG, name: "Demo", slug: "demo", tier: "max", status: "active" } as never));
    const memberId = await t.run((ctx) => ctx.db.insert("members", { orgId: ORG, name: "Eng", role: "engineer", skills: [] } as never));
    stubToken({ access_token: "a", refresh_token: "newrt", expires_in: 3600 });
    await t.mutation(internal.googleAuth._createOAuthState, { orgId: ORG, nonce: "ok1" });
    expect(await loc("?code=c&state=ok1")).toBe("https://app.test/settings?tab=integrations&google=connected");
    expect((await t.run((ctx) => ctx.db.query("orgs").first()))?.googleRefreshToken).toBe("newrt");

    await t.mutation(internal.googleAuth._createMemberOAuthState, { orgId: ORG, memberId, nonce: "ok2" });
    expect(await loc("?code=c&state=ok2")).toBe("https://app.test/schedule?google=connected");
    const cal = await t.run((ctx) => ctx.db.query("memberCalendars").first());
    expect(cal).toMatchObject({ memberId, refreshToken: "newrt", syncDirection: "two_way" });
  });
});
