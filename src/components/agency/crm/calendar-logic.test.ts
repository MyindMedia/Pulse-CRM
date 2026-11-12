import { describe, expect, it } from "vitest";
import {
  addDays, agendaDays, bookBody, buildWeek, busyByMember, busyRange, dateKeyIn, hoursSummary, lengthWord, outcomeMissing, slotDays,
  statusInfo, timeIn, viewWindow, weekStart, keyStartMs,
} from "./calendar-logic";
import { currentSlot } from "./calendar-parts";
import { LEAD_NAME_CONCURRENCY, bookingLeadName, nextLeadIds } from "./calendar-lead-names";
import { leadPlaceholder } from "./crm-calendar";
import type { Booking, Calendar } from "./calendar-types";

const NOW = Date.parse("2026-11-11T18:00:00Z");
const LA = "America/Los_Angeles";

describe("time zones", () => {
  it("a late evening LA appointment is still that LA day", () => {
    const t = Date.parse("2026-11-12T06:30:00Z"); // 10:30 PM Nov 11 in LA
    expect(dateKeyIn(t, LA)).toBe("2026-11-11");
    expect(dateKeyIn(t, "UTC")).toBe("2026-11-12");
    expect(timeIn(t, LA)).toBe("10:30 PM");
  });

  it("week starts Monday", () => {
    expect(weekStart("2026-11-11")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  });
});

describe("agenda and week", () => {
  const bookings: Booking[] = [
    { id: "b2", starts_at: "2026-11-13T18:00:00Z", timezone: LA, status: "scheduled" } as Booking,
    { id: "b1", starts_at: "2026-11-11T20:00:00Z", timezone: LA, status: "scheduled" } as Booking,
    { id: "bx", starts_at: null } as unknown as Booking,
  ];

  it("groups by day soonest first, labels today, drops unreadable times", () => {
    const days = agendaDays(bookings, NOW, LA);
    expect(days.map((d) => d.key)).toEqual(["2026-11-11", "2026-11-13"]);
    expect(days[0].label).toMatch(/^Today/);
  });

  it("week grid has seven columns", () => {
    const w = buildWeek(bookings, "2026-11-09", LA);
    expect(w).toHaveLength(7);
    expect(w[2].items.map((b) => b.id)).toEqual(["b1"]);
    expect(w[4].items.map((b) => b.id)).toEqual(["b2"]);
  });

  it("slots group by day in the calendar zone", () => {
    const d = slotDays(["2026-11-12T17:00:00Z", "2026-11-12T16:00:00Z"], null, LA);
    expect(d).toHaveLength(1);
    expect(d[0].slots.map((s) => s.label)).toEqual(["8:00 AM", "9:00 AM"]);
  });
});

describe("status words", () => {
  it("every status has a word", () => {
    expect(statusInfo("scheduled").word).toBe("Confirmed");
    expect(statusInfo("no_show").word).toBe("No show");
    expect(statusInfo("cancelled").word).toBe("Cancelled");
    expect(statusInfo(null).word).toBe("Unknown");
  });

  it("past confirmed appointments are missing an outcome", () => {
    expect(outcomeMissing({ id: "b", starts_at: "2026-11-10T18:00:00Z", status: "scheduled" } as Booking, NOW)).toBe(true);
    expect(outcomeMissing({ id: "b", starts_at: "2026-11-10T18:00:00Z", status: "completed" } as Booking, NOW)).toBe(false);
  });

  it("lengths read as words", () => {
    expect(lengthWord(30)).toBe("30 min");
    expect(lengthWord(90)).toBe("1 hr 30 min");
    expect(lengthWord(0)).toBe("");
  });
});

describe("hours", () => {
  it("runs of equal days collapse", () => {
    const h = { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]], sat: [], sun: [] };
    expect(hoursSummary(h as never)).toBe("Mon to Fri 9 AM to 5 PM; Sat, Sun closed");
    expect(hoursSummary(null)).toBe("No hours set");
  });
});

describe("booking body", () => {
  const cal = { id: "c1", timezone: LA, pricing: { options: [{ id: "o1", name: "Mix" }], addons: [], options_label: "Service" } } as unknown as Calendar;
  const base = { leadId: "lead-maya", calendarId: "c1", optionId: null, addonIds: [], slot: "2026-11-12T17:00:00Z", notify: true };

  it("asks for the option when the calendar has pricing", () => {
    expect(bookBody(base, cal)).toEqual({ error: "Pick service first." });
  });

  it("builds the body with notify_lead and zone", () => {
    const r = bookBody({ ...base, optionId: "o1" }, cal);
    expect(r).toEqual({ body: { lead_id: "lead-maya", calendar_id: "c1", starts_at: "2026-11-12T17:00:00Z", notify_lead: true, option_id: "o1", timezone: LA } });
  });

  it("needs a lead and a slot", () => {
    expect(bookBody({ ...base, leadId: null }, cal)).toEqual({ error: "Pick the lead to book." });
    expect(bookBody({ ...base, optionId: "o1", slot: null }, cal)).toEqual({ error: "Pick an open time." });
  });
});

describe("busy blocks", () => {
  it("end after start, at most 31 days", () => {
    expect(busyRange("2026-11-12T09:00", "2026-11-12T08:00")).toMatchObject({ ok: false });
    expect(busyRange("2026-11-12T09:00", "2027-01-12T08:00")).toMatchObject({ ok: false });
    expect(busyRange("2026-11-12T09:00", "2026-11-12T12:00").ok).toBe(true);
  });

  it("a two-person block shows under both", () => {
    const g = busyByMember([{ starts_at: "2026-11-12T09:00:00Z", team_members: [{ id: "u1", name: "Ana" }, { id: "u2", name: "Ben" }] }]);
    expect(g.map((x) => x.name)).toEqual(["Ana", "Ben"]);
  });
});

describe("F-U10: only a slot from the list on show counts", () => {
  const days = slotDays(["2026-11-12T17:00:00Z", "2026-11-12T18:00:00Z"], null, LA);
  it("keeps a slot that is on show", () => {
    expect(currentSlot("2026-11-12T17:00:00Z", days)).toBe("2026-11-12T17:00:00Z");
  });
  it("drops a slot from an earlier calendar, option or add-on set, and any slot while loading", () => {
    expect(currentSlot("2026-11-13T17:00:00Z", days)).toBeNull();
    expect(currentSlot("2026-11-12T17:00:00Z", [])).toBeNull();
    expect(currentSlot(null, days)).toBeNull();
  });
});

describe("F-U3: lead names without the whole lead list", () => {
  it("a name on the booking wins", () => {
    expect(bookingLeadName({ lead_name: "Ana", lead: null })).toBe("Ana");
    expect(bookingLeadName({ lead: { full_name: "Ben" } })).toBe("Ben");
    expect(bookingLeadName({})).toBeNull();
  });
  it("asks for each unnamed lead once, at most 8 at a time", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const first = nextLeadIds(ids, new Set(["l0"]), new Set(), 0);
    expect(first).toHaveLength(LEAD_NAME_CONCURRENCY);
    expect(first).not.toContain("l0");
    expect(nextLeadIds(ids, new Set(), new Set(first), 8)).toEqual([]);
    expect(nextLeadIds(ids, new Set(), new Set(first), 6)).toHaveLength(2);
    expect(nextLeadIds(["a", "a", "b"], new Set(), new Set(), 0)).toEqual(["a", "b"]);
  });
  it("shows Lead and the id's tail until the name is known", () => {
    expect(leadPlaceholder("lead-abc123")).toBe("Lead abc123");
  });
});

describe("F-U14: the window follows the view and the day", () => {
  it("the agenda reads today minus 7 to plus 60 days", () => {
    const w = viewWindow("agenda", "2026-11-11", "2026-11-09");
    expect(Date.parse(w.from)).toBe(keyStartMs("2026-11-04"));
    expect(Date.parse(w.to)).toBe(keyStartMs("2026-11-11") + 61 * 86_400_000);
  });
  it("the week view reads the week on show, also far from today", () => {
    const w = viewWindow("week", "2026-11-11", "2027-03-01");
    expect(Date.parse(w.from)).toBeLessThanOrEqual(keyStartMs("2027-03-01"));
    expect(Date.parse(w.to)).toBeGreaterThanOrEqual(keyStartMs("2027-03-08"));
    expect(Date.parse(w.to) - Date.parse(w.from)).toBeLessThan(10 * 86_400_000);
  });
});
