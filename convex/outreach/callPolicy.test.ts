import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS, evaluate, inWindow, usPhone, looksLikeTest, maskPhone, isOptOut, validateSettings, formatDemoTime,
  type BookingFacts, type Facts, type CallSettings,
} from "./callPolicy";
import { areaCodeZones, isUsTimezone } from "./areaCodes";

// Tue 2026-10-13 21:00 UTC = 14:00 in Los Angeles (PDT), 17:00 in New York.
const NOW = Date.UTC(2026, 9, 13, 21, 0, 0);
const MIN = 60_000;
const S: CallSettings = { ...DEFAULT_SETTINGS, enabled: true, enabledAt: NOW - 86_400_000 };
const F: Facts = { optedOut: false, suppressed: false, usedToday: 0, scheduledFor: NOW - MIN };
const B: BookingFacts = {
  leadSynced: true, consentCall: true, status: "confirmed", startsAt: NOW + 3 * 3_600_000, firstSeenAt: NOW - 3_600_000,
  timezone: "America/Los_Angeles", phone: "+14085551234", name: "Mike Sims", email: "mike@studio.com",
};
const run = (b: Partial<BookingFacts> = {}, s: Partial<CallSettings> = {}, f: Partial<Facts> = {}, now = NOW) =>
  evaluate({ ...B, ...b }, { ...S, ...s }, { ...F, ...f }, now);

describe("eligibility matrix", () => {
  it("passes a clean booking and records the reason chain", () => {
    const d = run();
    expect(d.kind).toBe("ok");
    expect(d.trail.join(" | ")).toMatch(/consent\.call=true/);
  });

  it("consent: only the boolean true passes", () => {
    for (const bad of [false, "true", "yes", 1, undefined, null]) {
      const d = run({ consentCall: bad });
      expect(d).toMatchObject({ kind: "skip", reason: "no_consent" });
    }
  });

  it("waits, not skips, until the Zuops lead has been read", () => {
    expect(run({ leadSynced: false, consentCall: undefined })).toMatchObject({ kind: "wait", reason: "awaiting_lead" });
  });

  it("cancelled bookings cancel; other non-confirmed statuses skip", () => {
    expect(run({ status: "cancelled" }).kind).toBe("cancel");
    expect(run({ status: "completed" })).toMatchObject({ kind: "skip", reason: "not_confirmed" });
    expect(run({ status: "no_show" })).toMatchObject({ kind: "skip", reason: "not_confirmed" });
  });

  it("never calls a booking made before the feature was enabled, or when enabledAt is unset", () => {
    expect(run({ firstSeenAt: NOW - 2 * 86_400_000 })).toMatchObject({ kind: "skip", reason: "predates_enable" });
    expect(run({}, { enabledAt: undefined })).toMatchObject({ kind: "skip", reason: "predates_enable" });
  });

  it("opt-out and suppression block", () => {
    expect(run({}, {}, { optedOut: true })).toMatchObject({ kind: "skip", reason: "opted_out" });
    expect(run({}, {}, { suppressed: true })).toMatchObject({ kind: "skip", reason: "suppressed" });
  });

  it("test-name guard, unless allowTestBookings", () => {
    expect(run({ name: "Test User" })).toMatchObject({ kind: "skip", reason: "test_booking" });
    expect(run({ name: "asdf" })).toMatchObject({ kind: "skip", reason: "test_booking" });
    expect(run({ email: "test@studio.com" })).toMatchObject({ kind: "skip", reason: "test_booking" });
    expect(run({ name: "Test User" }, { allowTestBookings: true }).kind).toBe("ok");
    expect(run({ name: "Contest Winner" }).kind).toBe("ok"); // word boundary, not substring
  });

  it("too close: needs delay + 5 minutes of lead time", () => {
    expect(run({ startsAt: NOW + 9 * MIN })).toMatchObject({ kind: "skip", reason: "too_close" });
    expect(run({ startsAt: NOW + 10 * MIN }).kind).toBe("ok");
    expect(run({ startsAt: NOW - MIN })).toMatchObject({ kind: "skip", reason: "too_close" });
    expect(run({ startsAt: NOW + 20 * MIN }, { delayMinutes: 30 })).toMatchObject({ kind: "skip", reason: "too_close" });
  });

  it("phone: missing waits, junk and non-US skip", () => {
    expect(run({ phone: undefined })).toMatchObject({ kind: "wait", reason: "no_phone" });
    expect(run({ phone: "12345" })).toMatchObject({ kind: "skip", reason: "invalid_phone" });
    expect(run({ phone: "+442071234567" })).toMatchObject({ kind: "skip", reason: "invalid_phone" });
    expect(run({ phone: "+14085551234" }).kind).toBe("ok");
  });

  it("not due yet waits", () => {
    expect(run({}, {}, { scheduledFor: NOW + MIN })).toMatchObject({ kind: "wait", reason: "not_due" });
  });

  it("outside the callee's window waits (callee zone, not agency zone)", () => {
    const night = Date.UTC(2026, 9, 14, 5, 0, 0); // 22:00 PDT
    expect(run({ startsAt: night + 5 * 3_600_000 }, {}, {}, night)).toMatchObject({ kind: "wait", reason: "outside_window" });
    expect(run({ timezone: "America/New_York" }).kind).toBe("ok");
  });

  it("the window must hold in the zone of the phone's area code, whatever the booking says", () => {
    // 01:30 UTC: 18:30 in Los Angeles (open), 21:30 in New York (closed).
    const late = Date.UTC(2026, 9, 14, 1, 30, 0);
    const d = run({ phone: "+12125551234", timezone: "America/Los_Angeles", startsAt: late + 3 * 3_600_000 }, {}, { scheduledFor: late - MIN }, late);
    expect(d).toMatchObject({ kind: "wait", reason: "outside_window" });
    // No booking zone at all: the area code alone decides, and it is closed too.
    expect(run({ phone: "+12125551234", timezone: undefined, startsAt: late + 3 * 3_600_000 }, {}, { scheduledFor: late - MIN }, late))
      .toMatchObject({ kind: "wait", reason: "outside_window" });
    // A 408 number at the same moment is inside its window.
    expect(run({ timezone: undefined, startsAt: late + 3 * 3_600_000 }, {}, { scheduledFor: late - MIN }, late).kind).toBe("ok");
  });

  it("an area code with no known US zone is skipped, not guessed", () => {
    // 416 is Toronto: NANP, but not a US area code.
    expect(run({ phone: "+14165551234" })).toMatchObject({ kind: "skip", reason: "unknown_area_code" });
  });

  it("a non-US or invalid booking time zone is refused", () => {
    expect(run({ timezone: "Asia/Tokyo" })).toMatchObject({ kind: "skip", reason: "non_us_timezone" });
    expect(run({ timezone: "Europe/London" })).toMatchObject({ kind: "skip", reason: "non_us_timezone" });
    expect(run({ timezone: "Not/AZone" })).toMatchObject({ kind: "skip", reason: "non_us_timezone" });
    expect(run({ timezone: "America/Indiana/Indianapolis" }).kind).toBe("ok");
  });

  it("a split area code must be open in every zone it spans", () => {
    // 850 spans Eastern and Central. 23:30 UTC: 19:30 Eastern (open), 18:30 Central (open).
    const t1 = Date.UTC(2026, 9, 13, 23, 30, 0);
    expect(run({ phone: "+18505551234", timezone: undefined, startsAt: t1 + 3 * 3_600_000 }, {}, { scheduledFor: t1 - MIN }, t1).kind).toBe("ok");
    // 00:30 UTC: 20:30 Eastern (closed), 19:30 Central (open).
    const t2 = Date.UTC(2026, 9, 14, 0, 30, 0);
    expect(run({ phone: "+18505551234", timezone: undefined, startsAt: t2 + 3 * 3_600_000 }, {}, { scheduledFor: t2 - MIN }, t2))
      .toMatchObject({ kind: "wait", reason: "outside_window" });
  });

  it("daily cap waits", () => {
    expect(run({}, {}, { usedToday: 5 })).toMatchObject({ kind: "wait", reason: "daily_cap" });
    expect(run({}, {}, { usedToday: 4 }).kind).toBe("ok");
  });

  it("a broken window never opens", () => {
    expect(inWindow(NOW, "America/Los_Angeles", { windowStart: "20:00", windowEnd: "09:00", windowDays: [2] })).toBe(false);
    expect(inWindow(NOW, "America/Los_Angeles", { windowStart: "bad", windowEnd: "20:00", windowDays: [2] })).toBe(false);
  });

  it("respects window days", () => {
    expect(inWindow(NOW, "America/Los_Angeles", { windowStart: "09:00", windowEnd: "20:00", windowDays: [1, 3] })).toBe(false);
    expect(inWindow(NOW, "America/Los_Angeles", { windowStart: "09:00", windowEnd: "20:00", windowDays: [2] })).toBe(true);
  });
});

describe("helpers", () => {
  it("usPhone accepts NANP only", () => {
    expect(usPhone("(408) 555-1234")).toBe("+14085551234");
    expect(usPhone("1 408 555 1234")).toBe("+14085551234");
    expect(usPhone("+1 111 555 1234")).toBeNull();
    expect(usPhone("")).toBeNull();
  });
  it("maskPhone hides the middle", () => {
    expect(maskPhone("+14085551234")).toBe("+1 408-***-1234");
    expect(maskPhone(undefined)).toBe("no number");
  });
  it("looksLikeTest", () => {
    expect(looksLikeTest("A")).toBe(true);
    expect(looksLikeTest("Dana Ruiz", "dana@x.com")).toBe(false);
  });
  it("isOptOut reads the disposition and the callee's own words only", () => {
    expect(isOptOut({ disposition_tag: "DO_NOT_CONTACT" })).toBe(true);
    expect(isOptOut({ transcripts: [{ user: "user", text: "Please stop calling me" }] })).toBe(true);
    expect(isOptOut({ transcripts: [{ user: "assistant", text: "You can say stop calling" }] })).toBe(false);
    expect(isOptOut({ concatenated_transcript: "assistant: hi \n user: Take me off your list" })).toBe(true);
    expect(isOptOut({ concatenated_transcript: "assistant: do not call back\n user: ok great" })).toBe(false);
  });
  it("validateSettings", () => {
    expect(validateSettings({ delayMinutes: 0 })).toMatch(/Delay/);
    expect(validateSettings({ delayMinutes: 121 })).toMatch(/Delay/);
    expect(validateSettings({ delayMinutes: 120 })).toBeNull();
    expect(validateSettings({ windowStart: "21:00", windowEnd: "09:00" })).toMatch(/end after/);
    expect(validateSettings({ timezone: "Mars/Base" })).toMatch(/time zone/);
    expect(validateSettings({ fromNumber: "4086921713" })).toMatch(/E\.164/);
  });
  it("areaCodeZones maps US area codes and nothing else", () => {
    expect(areaCodeZones("+14085551234")).toEqual(["America/Los_Angeles"]);
    expect(areaCodeZones("+12125551234")).toEqual(["America/New_York"]);
    expect(areaCodeZones("+16025551234")).toEqual(["America/Phoenix"]);
    expect(areaCodeZones("+14165551234")).toBeNull();
    expect(areaCodeZones("4085551234")).toBeNull();
    expect(isUsTimezone("America/Chicago")).toBe(true);
    expect(isUsTimezone("America/Toronto")).toBe(false);
  });
  it("formatDemoTime is in the given zone", () => {
    expect(formatDemoTime(NOW, "America/Los_Angeles")).toMatch(/Tuesday, October 13 at 2:00 PM P[DS]T/);
  });
});
