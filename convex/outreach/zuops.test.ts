import { describe, it, expect, vi, afterEach } from "vitest";
import { parseBookings, parseCalendar, parseLead, verifySignature, zuopsGet } from "./zuops";

afterEach(() => vi.unstubAllEnvs());

const sign = async (body: string, secret: string) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

describe("zuops parsers", () => {
  it("parses bookings, maps statuses, drops rows without a valid id or time", () => {
    const json = { data: { bookings: [
      { id: "b1", lead_id: "l1", calendar_id: "c1", title: "Mike Sims", starts_at: "2026-10-07T16:00:00+00:00", ends_at: "2026-10-07T16:30:00+00:00", timezone: "America/Los_Angeles", status: "confirmed", location: "Zoom", meeting_url: "https://zoom.example/j/1" },
      { id: "b2", starts_at: "2026-10-08T16:00:00Z", ends_at: "2026-10-08T16:30:00Z", status: "canceled" },
      { id: "b3", starts_at: "garbage", ends_at: "2026-10-08T16:30:00Z" },
      { starts_at: "2026-10-08T16:00:00Z", ends_at: "2026-10-08T16:30:00Z" },
    ] } };
    const b = parseBookings(json);
    expect(b.map((x) => [x.id, x.status])).toEqual([["b1", "confirmed"], ["b2", "cancelled"]]);
    expect(b[0]).toMatchObject({ leadId: "l1", calendarId: "c1", timezone: "America/Los_Angeles", startsAt: Date.parse("2026-10-07T16:00:00Z") });
    expect(parseBookings(null)).toEqual([]);
  });

  it("parses the mapped calendar only, with weekly hours as readable windows", () => {
    const json = { data: { calendars: [
      { id: "c9", name: "Other" },
      { id: "c1", name: "Pulse | 30-minute demo", title: "30-minute Pulse demo", slug: "pulse-30-minute-demo", duration_minutes: 30, buffer_minutes: 15, min_notice_minutes: 1440, max_days_ahead: 14, timezone: "America/Los_Angeles", is_active: true, weekly_hours: { mon: [["09:00", "17:00"]], sat: [] }, location_label: "Zoom" },
    ] } };
    const c = parseCalendar(json, "c1")!;
    expect(c).toMatchObject({ name: "Pulse | 30-minute demo", durationMin: 30, bufferMin: 15, minNoticeMin: 1440, maxDaysAhead: 14, active: true });
    expect(c.hours).toEqual({ mon: ["09:00-17:00"], sat: [] });
    expect(parseCalendar(json, "missing")).toBeNull();
  });

  it("keeps only name, email and the three consent answers from a lead, never a phone number", () => {
    const l = parseLead({ data: { lead: { id: "l1", full_name: "Mike Sims", email: "Mike@Studio.COM", phone: "+14085550123", address: "1 Main St", email_opt_out: true,
      custom_fields: { pulse_sms_marketing_consent: false, pulse_automated_call_consent: true, pulse_email_marketing_consent: false } } } })!;
    expect(l).toEqual({ name: "Mike Sims", email: "mike@studio.com", consent: { sms: false, call: true, email: false }, emailOptOut: true });
    expect(JSON.stringify(l)).not.toMatch(/5550123|Main St/);
    expect(parseLead({ data: {} })).toBeNull();
  });
});

describe("webhook signature", () => {
  it("accepts the exact signature and rejects tampering, wrong secret, bad format and empty input", async () => {
    const body = '{"event":"appointment.booked","workspace_id":"w"}';
    const good = await sign(body, "s3cret");
    expect(await verifySignature(body, good, "s3cret")).toBe(true);
    expect(await verifySignature(body + " ", good, "s3cret")).toBe(false);
    expect(await verifySignature(body, good, "other")).toBe(false);
    expect(await verifySignature(body, good.replace("sha256=", ""), "s3cret")).toBe(false);
    expect(await verifySignature(body, "sha256=zz", "s3cret")).toBe(false);
    expect(await verifySignature(body, null, "s3cret")).toBe(false);
    expect(await verifySignature(body, good, "")).toBe(false);
  });
});

describe("zuopsGet", () => {
  it("is off without a key, only reaches /v1 paths on the Zuops host, and sends the key as a bearer header", async () => {
    vi.stubEnv("ZUOPS_API_KEY", "");
    const f = vi.fn();
    expect(await zuopsGet("/v1/calendars", { workspace_id: "w" }, f as never)).toEqual({ ok: false, reason: expect.stringContaining("ZUOPS_API_KEY") });
    expect(f).not.toHaveBeenCalled();
    vi.stubEnv("ZUOPS_API_KEY", "zu-test");
    expect((await zuopsGet("https://evil.example/x", {}, f as never)).ok).toBe(false);
    expect((await zuopsGet("/v1/../admin", {}, f as never)).ok).toBe(false);
    const ok = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
    expect((await zuopsGet("/v1/bookings", { workspace_id: "w", limit: 5 }, ok as never)).ok).toBe(true);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zuops.com/functions/v1/api-gateway/v1/bookings?workspace_id=w&limit=5");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer zu-test");
    expect(init.method).toBe("GET");
  });

  it("maps failures to short operator messages that never contain the key", async () => {
    vi.stubEnv("ZUOPS_API_KEY", "zu-secret-key");
    const r403 = await zuopsGet("/v1/bookings", {}, (async () => new Response("{}", { status: 403 })) as never);
    expect(r403).toEqual({ ok: false, reason: expect.stringContaining("scopes") });
    const boom = await zuopsGet("/v1/bookings", {}, (async () => { throw new Error("zu-secret-key down"); }) as never);
    expect(JSON.stringify(boom)).not.toContain("zu-secret-key");
    const soft = await zuopsGet("/v1/bookings", {}, (async () => new Response(JSON.stringify({ success: false, error: "x zu-secret-key" }), { status: 200 })) as never);
    expect(JSON.stringify(soft)).not.toContain("zu-secret-key");
  });
});
