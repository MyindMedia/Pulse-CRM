import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { sessionToCalendarEvent, type SessionForCalendar } from "./googleCalendar";

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
