import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";

/* Server-render each Outreach panel against fixture query results. Proves the
   loading, unauthorized, empty and populated states render without throwing
   and say the right things. It is not a visual or browser check. */
const fixtures: Record<string, unknown> = {};
vi.mock("convex/react", () => ({
  useQuery: (ref: never) => fixtures[getFunctionName(ref)],
  useMutation: () => async () => null,
}));

import { Overview, Communications, Meetings, Links, Activity, Settings, TestOnlyBanner, Prospects, Drafts } from "./outreach-panels";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const set = (name: string, v: unknown) => { fixtures[`outreach:${name}`] = v; };
const setP = (v: unknown) => { fixtures["outreachProspects:list"] = v; };
const snap = (v: unknown) => { fixtures["outreachCalendar:snapshot"] = v; };
const baseSnap = { canManage: true, mapped: false, keyConfigured: true, fetchedAt: null, ok: null, error: null, calendar: null, slots: [], appointments: [] };

beforeEach(() => { for (const k of Object.keys(fixtures)) delete fixtures[k]; });

const overview = {
  canManage: true, isOwner: true, liveBlockers: ["Set the business mailing address"], configured: false, paused: true, mode: "test_only" as const,
  readiness: [
    { key: "sender", label: "Verified sender", state: "missing", detail: "No sending identity has been verified for this agency." },
    { key: "calling", label: "Automatic calling", state: "disabled", detail: "Off. The walkthrough integration is disabled and its provider schema is not audited." },
  ],
  counts: { accepted: 2, unknown: 1 },
  failures: [{ id: "f1", recipient: "a@x.com", subject: "Timeout", status: "unknown", at: 0 }],
};

describe("Outreach panels", () => {
  it("every panel shows loading while data is undefined", () => {
    for (const el of [<Overview />, <Communications />, <Meetings />, <Links />, <Activity />, <Settings />, <Prospects />, <Drafts />]) {
      expect(html(el)).toMatch(/Loading/i);
    }
  });

  it("every panel shows the agency-required state when the server returns null", () => {
    for (const n of ["overview", "communications", "templates", "meetings", "links", "activity"]) set(n, null);
    fixtures["outreachProspects:list"] = null;
    fixtures["outreachDrafts:list"] = null;
    fixtures["outreachCalendar:snapshot"] = null;
    for (const el of [<Overview />, <Communications />, <Meetings />, <Links />, <Activity />, <Settings />, <Prospects />, <Drafts />]) {
      expect(html(el)).toContain("Agency membership required");
    }
  });

  it("overview states say what is missing or off, in words", () => {
    set("overview", overview);
    const out = html(<Overview />);
    expect(out).toContain("Verified sender");
    expect(out).toContain("missing");
    expect(out).toContain("Automatic calling");
    expect(out).toContain("disabled");
    expect(out).toMatch(/Accepted is not delivered/);
    expect(out).toContain("Timeout");
  });

  it("communications has no send control and explains status meaning", () => {
    set("communications", [{
      id: "c1", at: 0, recipient: "o@x.com", sender: "MaxB | Pulse <info@studiopulse.tech>", subject: "[TEST] Hi",
      isTest: true, status: "accepted", meaning: "The provider accepted the message. This is not inbox delivery.",
      providerId: "01a0f9b6", lastError: null,
    }]);
    set("templates", []);
    const out = html(<Communications />);
    expect(out).toContain("not inbox delivery");
    expect(out).toContain("test");
    expect(out).toContain("Check delivery status");
    expect(out).not.toMatch(/>\s*Send\s*</i);
  });

  it("communications empty state states that sending is not enabled", () => {
    set("communications", []);
    set("templates", []);
    expect(html(<Communications />)).toContain("sent from the Review queue");
  });

  it("meetings: unmapped shows the no-calendar state, not fake rows", () => {
    set("meetings", { mapped: false, rows: [] });
    snap(baseSnap);
    fixtures["outreachZuops:bookings"] = { mapped: false, upcoming: [], past: [] };
    const out = html(<Meetings />);
    expect(out).toContain("Zuops calendar not connected");
    expect(out).toContain("studiopulse.tech/demo");
  });

  it("meetings: shows masked phone and why a call is not possible", () => {
    snap(baseSnap);
    set("meetings", { mapped: true, rows: [{
      id: "appt1", name: "Test", start: 0, timezone: "America/Los_Angeles", status: "confirmed",
      phone: "••• 23", version: 1,
      call: { state: "ineligible", reason: "No explicit phone consent. The booking still stands." },
    }] });
    const out = html(<Meetings />);
    expect(out).toContain("••• 23");
    expect(out).toContain("No explicit phone consent");
    expect(out).not.toMatch(/\+1\d{10}/);
  });

  it("links: unconfigured says nothing is verified, configured shows provenance", () => {
    snap(baseSnap);
    set("links", { configured: false, bookingUrl: null, calendarId: null, locationId: null, durationMin: null, timezone: null, verifiedAt: null, senders: [] });
    expect(html(<Links />)).toContain("Nothing verified yet");
    snap({ ...baseSnap, mapped: true, calendar: { id: "c", name: "Pulse Walkthrough", active: true, durationMin: 30, widgetSlug: "pulse-walkthrough", formId: "f", autoConfirm: true }, slots: [{ date: "2026-10-05", count: 8, first: "x" }], fetchedAt: 1 });
    set("links", {
      configured: true, bookingUrl: "https://api.leadconnectorhq.com/widget/bookings/pulse-walkthrough",
      calendarId: "cal", locationId: "loc", durationMin: 30, timezone: "America/Los_Angeles", verifiedAt: 0,
      senders: [{ label: "MaxB", address: "info@studiopulse.tech", verified: false }],
    });
    const out = html(<Links />);
    expect(out).toContain("30 minutes");
    expect(out).toContain("unverified");
    expect(out).toContain("Older GoHighLevel calendar");
    expect(out).toContain("Pulse Walkthrough");
    expect(out).toContain("8 across 1 day");
    expect(out).toContain("Refresh from GoHighLevel");
  });

  it("settings: pause control is disabled for non-managers", () => {
    set("overview", { ...overview, canManage: false });
    const out = html(<Settings />);
    expect(out).toContain("Only an owner or admin can change this.");
    expect(out).toMatch(/<button[^>]*disabled/);
  });

  it("test-only banner is always explicit", () => {
    const out = html(<TestOnlyBanner paused={true} />);
    expect(out).toContain("Test only.");
    expect(out).toContain("Nothing is sent, called or texted");
    expect(out).toContain("paused");
  });

  it("prospects: empty state, and non-managers cannot add", () => {
    setP({ canManage: false, suppressedCount: 0, rows: [] });
    const out = html(<Prospects />);
    expect(out).toContain("No prospects yet");
    expect(out).toContain("Only an owner or admin can add or change prospects.");
    expect(out).toMatch(/<textarea[^>]*disabled/);
  });

  it("prospects: shows published-not-verified labels, generic-inbox warning and the website prompt", () => {
    setP({
      canManage: true, suppressedCount: 1,
      rows: [
        { id: "p1", handle: "acme", name: null, websiteUrl: null, source: "paste", status: "needs_website", note: null, createdAt: 0, contacts: null },
        { id: "p2", handle: null, name: "Ice Cream Sound", websiteUrl: "https://icecreamsound.com", source: "paste", status: "scraped", note: null, createdAt: 0,
          contacts: {
            emails: [{ address: "studio@icecreamsound.com", generic: true, rank: 73, sourceUrl: "https://icecreamsound.com/contact", suppressed: false }],
            phones: [{ number: "(323) 760-7557", sourceUrl: "https://icecreamsound.com" }],
            socials: [{ platform: "instagram", url: "https://instagram.com/icecreamsound" }], booking: ["GoHighLevel"], scrapedAt: 0,
          } },
      ],
    });
    const out = html(<Prospects />);
    expect(out).toContain("Confirm website");
    expect(out).toContain("published, not verified");
    expect(out).toContain("generic inbox");
    expect(out).toContain("Confirm routing before pitching");
    expect(out).toContain("Queue for review");
    expect(out).toContain("opt-out list");
    expect(out).not.toMatch(/>\s*Send\s*</i);
  });

  it("review queue: gates are explained and Approve stays off until they are met", () => {
    fixtures["outreachDrafts:list"] = {
      canManage: true, gates: { postalAddress: false, ownerTestConfirmed: false },
      rows: [{ id: "d1", studio: "MIX", recipient: "jane@mix.com", persona: "MaxB", from: "MaxB | Pulse <info@studiopulse.tech>",
        subject: "Your studio has a sound. Now give it a system.", signatureMode: "original", status: "draft", holdReason: null, approvedAt: null, createdAt: 0 }],
    };
    const out = html(<Drafts />);
    expect(out).toContain("postal address missing");
    expect(out).toContain("owner test not confirmed");
    expect(out).toContain("Approving does not send");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Approve this email|Approve this email/);
    expect(out).toContain("Approve is off until the postal address is set");
    expect(out).toContain("original signature");
  });

  it("review queue: a held draft shows why, and an empty queue says how to start", () => {
    fixtures["outreachDrafts:list"] = { canManage: true, gates: { postalAddress: true, ownerTestConfirmed: true }, rows: [
      { id: "d2", studio: "UNION", recipient: "info@union.com", persona: "MaxB", from: "x", subject: "s", signatureMode: "static", status: "hold",
        holdReason: "Generic inbox: confirm who handles studio operations before pitching.", approvedAt: null, createdAt: 0 }] };
    const held = html(<Drafts />);
    expect(held).toContain("Generic inbox");
    expect(held).not.toContain("Approve this email");
    fixtures["outreachDrafts:list"] = { canManage: true, gates: { postalAddress: true, ownerTestConfirmed: true }, rows: [] };
    expect(html(<Drafts />)).toContain("No drafts yet");
  });

  it("meetings: shows live GHL appointments even when the walkthrough ledger is unmapped", () => {
    snap({ ...baseSnap, mapped: true, fetchedAt: 1, calendar: { id: "c", name: "Pulse Walkthrough", active: true, durationMin: 30, widgetSlug: "p", formId: "f", autoConfirm: true },
      appointments: [{ id: "e1", title: "Pulse demo", start: Date.now() + 86_400_000, end: Date.now() + 90_000_000, status: "confirmed", contactName: "Jane Smith" }] });
    set("meetings", { mapped: false, rows: [] });
    const out = html(<Meetings />);
    expect(out).toContain("Jane Smith");
    expect(out).toContain("old GoHighLevel calendar");
    expect(out).toContain("Zuops calendar");
    expect(out).toContain("calling stays off");
  });

  it("review queue: Send is hidden until live sending is on, and is a two-step action", () => {
    const row = { id: "d1", studio: "MIX", recipient: "jane@mix.com", persona: "MaxB", from: "x", subject: "s", signatureMode: "image", status: "approved", holdReason: null, approvedAt: 1, createdAt: 0 };
    fixtures["outreachDrafts:list"] = { canManage: true, gates: { postalAddress: true, ownerTestConfirmed: true, live: false }, rows: [row] };
    const off = html(<Drafts />);
    expect(off).toContain("Sending is off. An owner can turn it on in Settings.");
    expect(off).not.toContain("Send now");
    fixtures["outreachDrafts:list"] = { canManage: true, gates: { postalAddress: true, ownerTestConfirmed: true, live: true }, rows: [row] };
    const on = html(<Drafts />);
    expect(on).toContain("Send now");
    expect(on).not.toContain("Confirm: send to"); // only after the first click
  });

  it("settings: live sending lists what is missing, and only the owner can change it", () => {
    set("overview", { ...overview });
    const blocked = html(<Settings />);
    expect(blocked).toContain("Live sending");
    expect(blocked).toContain("Not ready to turn on");
    expect(blocked).toContain("Set the business mailing address");
    set("overview", { ...overview, liveBlockers: [], isOwner: false });
    const nonOwner = html(<Settings />);
    expect(nonOwner).toContain("Only the agency owner can change this.");
    expect(nonOwner).toMatch(/<input[^>]*id="live-confirm"[^>]*disabled/);
  });

  it("banner: live mode says every email still needs approval and a click", () => {
    const out = html(<TestOnlyBanner paused={false} mode="live" />);
    expect(out).toContain("Live sending is on.");
    expect(out).toContain("still needs your approval and your Send click");
    expect(out).not.toContain("Test only.");
  });

  it("meetings shows Zuops bookings with consent answers, a matched prospect, and no phone number", () => {
    set("meetings", { mapped: false, rows: [] });
    snap({ ...baseSnap, appointments: [] });
    fixtures["outreachZuops:bookings"] = {
      mapped: true,
      upcoming: [{ id: "z1", title: "Pulse demo", startsAt: Date.now() + 86_400_000, endsAt: Date.now() + 88_000_000, timezone: "America/Los_Angeles", status: "confirmed", contactName: "Studio Owner", contactEmail: "owner@acme.com", location: "Zoom", consent: { sms: false, call: true, email: true }, prospect: "Acme Sound" }],
      past: [{ id: "z0", title: "Pulse demo", startsAt: 1, endsAt: 2, timezone: null, status: "cancelled", contactName: "Old Lead", contactEmail: null, location: null, consent: { sms: null, call: null, email: null }, prospect: null }],
    };
    const out = html(<Meetings />);
    expect(out).toContain("Upcoming demos");
    expect(out).toContain("Studio Owner");
    expect(out).toContain("Matched prospect: Acme Sound");
    expect(out).toContain("SMS marketing: no");
    expect(out).toContain("Automated call: yes");
    expect(out).toContain("Recent and cancelled");
    expect(out).toContain("cancelled");
  });

  it("meetings says the Zuops calendar is not connected until an operator maps it", () => {
    set("meetings", { mapped: false, rows: [] });
    snap({ ...baseSnap, appointments: [] });
    fixtures["outreachZuops:bookings"] = { mapped: false, upcoming: [], past: [] };
    const out = html(<Meetings />);
    expect(out).toContain("Zuops calendar not connected");
    expect(out).toContain("studiopulse.tech/demo");
  });

  it("links shows the Zuops calendar's hours, window and sync health", () => {
    set("links", { configured: true, bookingUrl: "https://studiopulse.tech/demo", calendarId: null, locationId: null, durationMin: 30, timezone: "America/Los_Angeles", verifiedAt: 1, senders: [] });
    snap({ ...baseSnap });
    fixtures["outreachZuops:snapshot"] = {
      canManage: true, mapped: true, keyConfigured: true, webhookConfigured: true, bookingUrl: "https://studiopulse.tech/demo",
      fetchedAt: 1_790_000_000_000, ok: true, error: null, bookingCount: 3,
      calendar: { id: "c1", name: "Pulse | 30-minute demo", durationMin: 30, bufferMin: 15, minNoticeMin: 1440, maxDaysAhead: 14, timezone: "America/Los_Angeles", active: true, hours: { mon: ["09:00-17:00"], sat: [] }, locationLabel: "Zoom" },
    };
    const out = html(<Links />);
    expect(out).toContain("Zuops booking calendar");
    expect(out).toContain("Pulse | 30-minute demo");
    expect(out).toContain("30 minutes, 15 minute buffer");
    expect(out).toContain("At least 24 hours ahead, up to 14 days out");
    expect(out).toContain("09:00-17:00");
    expect(out).toContain("live updates: on");
    expect(out).toContain("syncing");
    expect(out).toContain("Refresh from Zuops");
  });

  it("links says plainly when the Zuops sync is failing", () => {
    set("links", { configured: true, bookingUrl: "https://studiopulse.tech/demo", calendarId: null, locationId: null, durationMin: null, timezone: null, verifiedAt: 1, senders: [] });
    snap({ ...baseSnap });
    fixtures["outreachZuops:snapshot"] = { canManage: false, mapped: true, keyConfigured: true, webhookConfigured: false, bookingUrl: null, fetchedAt: 1_790_000_000_000, ok: false, error: "Zuops refused the key (check its scopes: bookings:read, leads:read).", bookingCount: 0, calendar: null };
    const out = html(<Links />);
    expect(out).toContain("sync failing");
    expect(out).toContain("Zuops refused the key");
    expect(out).toContain("15 minute sync only");
    expect(out).not.toContain("Refresh from Zuops");
  });
});
