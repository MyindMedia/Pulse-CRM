import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { pulseEventId, sessionToCalendarEvent, type SessionForCalendar } from "./googleCalendar";
import { googleWorkFor, type SessionChange } from "./lib/googleCalendarTrigger";
import type { Doc, Id } from "./_generated/dataModel";

const ORG = "pulse-demo";

function s(over: Partial<SessionForCalendar> = {}): SessionForCalendar {
  return {
    title: "Tracking day",
    startTime: Date.UTC(2026, 5, 1, 14, 0, 0), // June 1 2026 14:00 UTC
    endTime: Date.UTC(2026, 5, 1, 17, 0, 0),
    status: "confirmed",
    serviceType: "recording",
    ...over,
  };
}

describe("session -> google calendar event (pure)", () => {
  it("maps a confirmed session to a confirmed event with serviced summary", () => {
    const e = sessionToCalendarEvent(s(), { studioName: "Studio Pulse" });
    expect(e.status).toBe("confirmed");
    expect(e.summary).toContain("Tracking day");
    expect(e.summary).toContain("(recording)");
    expect(e.description).toContain("Studio Pulse");
    expect(e.start.dateTime).toBe(new Date(s().startTime).toISOString());
    expect(e.end.dateTime).toBe(new Date(s().endTime).toISOString());
  });

  it("maps tentative holds to a Google tentative event", () => {
    expect(sessionToCalendarEvent(s({ status: "tentative" })).status).toBe("tentative");
  });

  it("maps cancelled and no_show to cancelled (clears the slot on Google's side)", () => {
    expect(sessionToCalendarEvent(s({ status: "cancelled" })).status).toBe("cancelled");
    expect(sessionToCalendarEvent(s({ status: "no_show" })).status).toBe("cancelled");
  });

  it("handles a missing service type gracefully", () => {
    const e = sessionToCalendarEvent(s({ serviceType: undefined }));
    expect(e.summary).toBe("Tracking day");
  });
});

describe("calendar push is a silent no-op for studios that are not Google-connected", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("creating a session schedules a push that safely does nothing when no refresh token is on file", async () => {
    const { sessionId } = await t.mutation(api.sessions.create, {
      title: "Future tracking",
      clientName: "Walk-in",
      serviceType: "recording",
      startTime: Date.now() + 86_400_000,
      endTime: Date.now() + 86_400_000 + 7_200_000,
      rateCents: 12000,
    });

    // Drain scheduled actions. The push action checks for googleConfigured + a
    // refresh token; with neither present (test env), it returns early.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const fresh = await t.run(async (ctx) => ctx.db.get(sessionId));
    // No googleCalendarEventId means the push correctly no-op'd, not crashed.
    expect(fresh?.googleCalendarEventId).toBeUndefined();
    expect(fresh?.orgId).toBe(ORG);
  });
});

describe("every booking change reaches Google (sessions trigger)", () => {
  it("writes each booking under one fixed event id that Google accepts", () => {
    const a = pulseEventId("k57fd3rq9m0s7v1e2xyz4w8n6h7j2kpa");
    expect(a).toMatch(/^[0-9a-v]{5,1024}$/);
    expect(pulseEventId("k57fd3rq9m0s7v1e2xyz4w8n6h7j2kpa")).toBe(a);
    expect(pulseEventId("k57fd3rq9m0s7v1e2xyz4w8n6h7j2kpb")).not.toBe(a);
  });

  const row = (over: Partial<Doc<"sessions">> = {}) =>
    ({ _id: "s1", orgId: ORG, title: "Tracking", startTime: 1, endTime: 2, status: "confirmed", serviceType: "recording", ...over }) as Doc<"sessions">;
  const change = (operation: SessionChange["operation"], oldDoc: Doc<"sessions"> | null, newDoc: Doc<"sessions"> | null): SessionChange =>
    ({ id: "s1" as Id<"sessions">, operation, oldDoc, newDoc });

  it("pushes a new booking and a change to its time, title or status; ignores money and notes", () => {
    expect(googleWorkFor(change("insert", null, row()))).toEqual({ kind: "push" });
    expect(googleWorkFor(change("update", row(), row({ startTime: 5 })))).toEqual({ kind: "push" });
    expect(googleWorkFor(change("update", row(), row({ status: "cancelled" })))).toEqual({ kind: "push" });
    expect(googleWorkFor(change("update", row(), row({ depositPaid: true, notes: "bring drives" })))).toBeNull();
    expect(googleWorkFor(change("update", row(), row({ googleCalendarEventId: "pulse00" })))).toBeNull(); // our own write-back
  });

  it("removes the Google event of a deleted booking that had one", () => {
    expect(googleWorkFor(change("delete", row({ googleCalendarEventId: "pulse00" }), null))).toEqual({ kind: "remove", eventId: "pulse00" });
    expect(googleWorkFor(change("delete", row(), null))).toBeNull();
  });
});

describe("connected studio: bookings land on Google from every path", () => {
  let t: ReturnType<typeof convexTest>;
  let calls: { method: string; url: string; body?: Record<string, unknown> }[];
  let existing: Set<string>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client.apps.googleusercontent.com");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
    calls = [];
    existing = new Set();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "at", expires_in: 3600 });
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, url, body });
      const id = decodeURIComponent(url.split("/events/")[1] ?? "");
      if (method === "PATCH") return existing.has(id) ? Response.json({ id }) : new Response("not found", { status: 404 });
      if (method === "POST") {
        const newId = String(body?.id ?? "random");
        existing.add(newId);
        return Response.json({ id: newId });
      }
      if (method === "DELETE") { existing.delete(id); return new Response(null, { status: 204 }); }
      return new Response("unexpected", { status: 500 });
    }));
    t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: ORG, name: "Demo Studio", slug: "demo", tier: "max", status: "active", googleRefreshToken: "rt" });
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const drain = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const google = () => calls.filter((c) => c.url.includes("/calendar/v3/"));

  it("creates the event once under the booking's id, updates it on a deposit, and removes it on cancel", async () => {
    const { sessionId } = await t.mutation(api.sessions.create, {
      title: "Future tracking", clientName: "Walk-in", serviceType: "recording",
      startTime: Date.now() + 86_400_000, endTime: Date.now() + 86_400_000 + 7_200_000, rateCents: 12000,
    });
    await drain();
    const id = pulseEventId(sessionId);
    expect(google().map((c) => c.method)).toEqual(["PATCH", "POST"]);
    expect(google()[1].body?.id).toBe(id);
    expect((await t.run((ctx) => ctx.db.get(sessionId)))?.googleCalendarEventId).toBe(id);

    // A deposit confirms the booking: this path used to skip Google.
    calls = [];
    await t.mutation(api.sessions.payDeposit, { id: sessionId });
    await drain();
    expect(google().map((c) => `${c.method} ${c.url.endsWith(id)}`)).toEqual(["PATCH true"]);

    calls = [];
    await t.mutation(api.sessions.setStatus, { id: sessionId, status: "cancelled" });
    await drain();
    expect(google().map((c) => `${c.method} ${c.url.endsWith(id)}`)).toEqual(["DELETE true"]);
  });
});
