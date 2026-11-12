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
      { tz: LA },
    );
    expect(out).toHaveLength(1);
    expect(out[0].allDay).toBe(true);
    expect(new Date(out[0].startTime).toISOString()).toBe("2026-12-05T08:00:00.000Z");
    expect(new Date(out[0].endTime).toISOString()).toBe("2026-12-06T08:00:00.000Z");
  });

  it("a multi-day all-day event across a DST change ends at the zone's real midnight", () => {
    const out = parseIcal(
      ics(vevent(["UID:trip", "DTSTART;VALUE=DATE:20261030", "DTEND;VALUE=DATE:20261103", "SUMMARY:Away"])),
      { tz: LA },
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
      { tz: LA },
    );
    expect(out.map((e) => e.uid)).toEqual(["busy"]);
    expect(out[0].startTime).toBe(Date.parse("2026-11-23T03:00:00Z"));
  });
});
