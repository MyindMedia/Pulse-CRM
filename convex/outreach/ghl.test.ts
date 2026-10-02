import { describe, it, expect, vi, afterEach } from "vitest";
import { summarizeCalendar, summarizeSlots, summarizeEvents, durationMinutes, ghlGet } from "./ghl";

afterEach(() => { vi.unstubAllGlobals(); });

const cal = { calendar: { id: "cal1", name: "Pulse Walkthrough", locationId: "loc1", isActive: true, slotDuration: 30, slotDurationUnit: "mins", widgetSlug: "pulse-walkthrough", formId: "form1", autoConfirm: true } };

describe("ghl summaries", () => {
  it("accepts only the calendar and location that were mapped", () => {
    const ok = summarizeCalendar(cal, "cal1", "loc1");
    expect(ok.ok && ok.data).toMatchObject({ name: "Pulse Walkthrough", active: true, durationMin: 30, widgetSlug: "pulse-walkthrough" });
    expect(summarizeCalendar(cal, "other", "loc1").ok).toBe(false);
    expect(summarizeCalendar(cal, "cal1", "other-loc").ok).toBe(false);
    expect(summarizeCalendar({}, "cal1", "loc1").ok).toBe(false);
  });
  it("normalises hours to minutes", () => {
    expect(durationMinutes(1, "hours")).toBe(60);
    expect(durationMinutes(30, "mins")).toBe(30);
    expect(durationMinutes("x", "mins")).toBeNull();
  });
  it("summarises open slots per day and ignores the trace id", () => {
    const s = summarizeSlots({ "2026-10-05": { slots: ["a", "b"] }, "2026-10-02": { slots: ["c"] }, traceId: "t" });
    expect(s).toEqual([{ date: "2026-10-02", count: 1, first: "c" }, { date: "2026-10-05", count: 2, first: "a" }]);
  });
  it("keeps only this calendar's events, sorted, with no phone numbers", () => {
    const ev = summarizeEvents({ events: [
      { id: "e2", calendarId: "cal1", title: "Demo B", startTime: "2026-10-06T10:00:00-07:00", endTime: "2026-10-06T10:30:00-07:00", appointmentStatus: "confirmed", contactName: "Bob", phone: "+14085550123" },
      { id: "e1", calendarId: "cal1", title: "Demo A", startTime: "2026-10-05T10:00:00-07:00", endTime: "2026-10-05T10:30:00-07:00", status: "new" },
      { id: "x", calendarId: "other", title: "Not ours", startTime: "2026-10-05T11:00:00-07:00" },
      { id: "bad", calendarId: "cal1", startTime: "garbage" },
    ] }, "cal1");
    expect(ev.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(ev[1]).toMatchObject({ contactName: "Bob", status: "confirmed" });
    expect(JSON.stringify(ev)).not.toContain("+1408");
  });
});

describe("ghlGet", () => {
  it("only talks to the GHL host and reports refusals plainly", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", f);
    const r = await ghlGet("/calendars/cal1", "k");
    expect(r).toEqual({ ok: false, reason: "GHL refused the key (HTTP 401)" });
    expect(String(f.mock.calls[0][0]).startsWith("https://services.leadconnectorhq.com/")).toBe(true);
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("GET");
    expect((await ghlGet("https://evil.example/", "k")).ok).toBe(false); // not a path
  });
});
