// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseIcal } from "./externalCalendarsActions";

/* Review 2026-11-12 R07, R08: outside-calendar events now block bookings, so
   parseIcal must keep only time that is really busy, on the studio's own day. */

const LA = "America/Los_Angeles";

function ics(...events: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
}

function vevent(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

describe("parseIcal: what counts as busy", () => {
  it("an all-day event covers the studio's own midnight to midnight, not UTC's", () => {
    const out = parseIcal(
      ics(vevent(["UID:closed-1", "DTSTART;VALUE=DATE:20261205", "DTEND;VALUE=DATE:20261206", "SUMMARY:Closed"])),
      { tz: LA, now: Date.parse("2026-11-10T12:00:00Z") },
    );
    expect(out).toHaveLength(1);
    expect(out[0].allDay).toBe(true);
    expect(new Date(out[0].startTime).toISOString()).toBe("2026-12-05T08:00:00.000Z");
    expect(new Date(out[0].endTime).toISOString()).toBe("2026-12-06T08:00:00.000Z");
  });

  it("a multi-day all-day event across a DST change ends at the zone's real midnight", () => {
    const out = parseIcal(
      ics(vevent(["UID:trip", "DTSTART;VALUE=DATE:20261030", "DTEND;VALUE=DATE:20261103", "SUMMARY:Away"])),
      { tz: LA, now: Date.parse("2026-10-29T12:00:00Z") },
    );
    expect(new Date(out[0].startTime).toISOString()).toBe("2026-10-30T07:00:00.000Z");
    expect(new Date(out[0].endTime).toISOString()).toBe("2026-11-03T08:00:00.000Z");
  });

  it("cancelled events and events marked Free are not stored", () => {
    const out = parseIcal(
      ics(
        vevent(["UID:free", "DTSTART;VALUE=DATE:20261120", "DTEND;VALUE=DATE:20261121", "TRANSP:TRANSPARENT", "SUMMARY:Dentist reminder"]),
        vevent(["UID:gone", "DTSTART:20261122T030000Z", "DTEND:20261122T040000Z", "STATUS:CANCELLED", "SUMMARY:Meeting"]),
        vevent(["UID:busy", "DTSTART:20261123T030000Z", "DTEND:20261123T040000Z", "TRANSP:OPAQUE", "SUMMARY:Session"]),
      ),
      { tz: LA, now: Date.parse("2026-11-10T12:00:00Z") },
    );
    expect(out.map((e) => e.uid)).toEqual(["busy"]);
    expect(out[0].startTime).toBe(Date.parse("2026-11-23T03:00:00Z"));
  });
});

/* Review 2026-11-12 R25, R26: a recurring series blocked only its first
   occurrence. */
describe("parseIcal: recurring events", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  const rehearsal = [
    vevent([
      "UID:rehearsal",
      "DTSTART;TZID=America/Los_Angeles:20260901T180000",
      "DTEND;TZID=America/Los_Angeles:20260901T210000",
      "RRULE:FREQ=WEEKLY;BYDAY=TU",
      "EXDATE;TZID=America/Los_Angeles:20261117T180000",
      "SUMMARY:Band rehearsal",
    ]),
    vevent([
      "UID:rehearsal",
      "RECURRENCE-ID;TZID=America/Los_Angeles:20261124T180000",
      "DTSTART;TZID=America/Los_Angeles:20261124T190000",
      "DTEND;TZID=America/Los_Angeles:20261124T220000",
      "SUMMARY:Band rehearsal (late)",
    ]),
    vevent([
      "UID:rehearsal",
      "RECURRENCE-ID;TZID=America/Los_Angeles:20261201T180000",
      "DTSTART;TZID=America/Los_Angeles:20261201T180000",
      "DTEND;TZID=America/Los_Angeles:20261201T210000",
      "STATUS:CANCELLED",
      "SUMMARY:Band rehearsal",
    ]),
  ];

  it("every Tuesday in the window is stored, with EXDATE skipped and overrides applied", () => {
    const out = parseIcal(ics(...rehearsal), { tz: LA, now });
    const starts = out.map((e) => new Date(e.startTime).toISOString());
    // Before the window (Sept, Oct) is not stored.
    expect(starts.some((s) => s.startsWith("2026-09") || s.startsWith("2026-10"))).toBe(false);
    // Nov 10 6pm PT = Nov 11 02:00Z is in the window; Nov 17 is excluded.
    expect(starts).toContain("2026-11-11T02:00:00.000Z");
    expect(starts).not.toContain("2026-11-18T02:00:00.000Z");
    // Nov 24 moved to 7pm; Dec 1 cancelled; Dec 8 still there.
    expect(starts).toContain("2026-11-25T03:00:00.000Z");
    expect(starts).not.toContain("2026-11-25T02:00:00.000Z");
    expect(starts).not.toContain("2026-12-02T02:00:00.000Z");
    expect(starts).toContain("2026-12-09T02:00:00.000Z");
    // Roughly 26 weeks ahead, nothing beyond 180 days.
    expect(out.length).toBeGreaterThan(20);
    expect(out.every((e) => e.startTime <= now + 180 * 86_400_000)).toBe(true);
    // One uid per occurrence.
    const late = out.find((e) => e.title === "Band rehearsal (late)")!;
    expect(late.uid).toBe(`rehearsal:${Date.parse("2026-11-25T03:00:00Z")}`);
    expect(new Set(out.map((e) => e.uid)).size).toBe(out.length);
  });

  it("a weekly all-day series is expanded on the studio's own days", () => {
    const out = parseIcal(
      ics(vevent(["UID:closed-weekly", "DTSTART;VALUE=DATE:20261115", "DTEND;VALUE=DATE:20261116", "RRULE:FREQ=WEEKLY;COUNT=3", "SUMMARY:Closed Sundays"])),
      { tz: LA, now },
    );
    expect(out.map((e) => new Date(e.startTime).toISOString())).toEqual([
      "2026-11-15T08:00:00.000Z",
      "2026-11-22T08:00:00.000Z",
      "2026-11-29T08:00:00.000Z",
    ]);
    expect(out.every((e) => e.allDay && e.endTime - e.startTime === 86_400_000)).toBe(true);
  });
});

/* Review 2026-11-12 R27: only a bounded window of events is stored. */
describe("parseIcal: stored window", () => {
  it("drops events that ended over a day ago or start more than 180 days out", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const out = parseIcal(
      ics(
        vevent(["UID:old", "DTSTART:20200101T180000Z", "DTEND:20200101T190000Z", "SUMMARY:Old"]),
        vevent(["UID:yesterday", "DTSTART:20261109T180000Z", "DTEND:20261109T190000Z", "SUMMARY:Yesterday"]),
        vevent(["UID:soon", "DTSTART:20261201T180000Z", "DTEND:20261201T190000Z", "SUMMARY:Soon"]),
        vevent(["UID:far", "DTSTART:20280101T180000Z", "DTEND:20280101T190000Z", "SUMMARY:Far"]),
      ),
      { tz: LA, now },
    );
    expect(out.map((e) => e.uid)).toEqual(["yesterday", "soon"]);
  });
});
