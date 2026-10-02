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

import { Overview, Communications, Meetings, Links, Activity, Settings, TestOnlyBanner, Prospects } from "./outreach-panels";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const set = (name: string, v: unknown) => { fixtures[`outreach:${name}`] = v; };
const setP = (v: unknown) => { fixtures["outreachProspects:list"] = v; };

beforeEach(() => { for (const k of Object.keys(fixtures)) delete fixtures[k]; });

const overview = {
  canManage: true, configured: false, paused: true, mode: "test_only" as const,
  readiness: [
    { key: "sender", label: "Verified sender", state: "missing", detail: "No sending identity has been verified for this agency." },
    { key: "calling", label: "Automatic calling", state: "disabled", detail: "Off. The walkthrough integration is disabled and its provider schema is not audited." },
  ],
  counts: { accepted: 2, unknown: 1 },
  failures: [{ id: "f1", recipient: "a@x.com", subject: "Timeout", status: "unknown", at: 0 }],
};

describe("Outreach panels", () => {
  it("every panel shows loading while data is undefined", () => {
    for (const el of [<Overview />, <Communications />, <Meetings />, <Links />, <Activity />, <Settings />, <Prospects />]) {
      expect(html(el)).toMatch(/Loading/i);
    }
  });

  it("every panel shows the agency-required state when the server returns null", () => {
    for (const n of ["overview", "communications", "templates", "meetings", "links", "activity"]) set(n, null);
    fixtures["outreachProspects:list"] = null;
    for (const el of [<Overview />, <Communications />, <Meetings />, <Links />, <Activity />, <Settings />, <Prospects />]) {
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
    expect(out).not.toMatch(/>\s*Send\s*</i);
  });

  it("communications empty state states that sending is not enabled", () => {
    set("communications", []);
    set("templates", []);
    expect(html(<Communications />)).toContain("sending is not enabled");
  });

  it("meetings: unmapped shows the no-calendar state, not fake rows", () => {
    set("meetings", { mapped: false, rows: [] });
    const out = html(<Meetings />);
    expect(out).toContain("No calendar connected");
    expect(out).toMatch(/click is not a booking/i);
  });

  it("meetings: shows masked phone and why a call is not possible", () => {
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
    set("links", { configured: false, bookingUrl: null, calendarId: null, locationId: null, durationMin: null, timezone: null, verifiedAt: null, senders: [] });
    expect(html(<Links />)).toContain("Nothing verified yet");
    set("links", {
      configured: true, bookingUrl: "https://api.leadconnectorhq.com/widget/bookings/pulse-walkthrough",
      calendarId: "cal", locationId: "loc", durationMin: 30, timezone: "America/Los_Angeles", verifiedAt: 0,
      senders: [{ label: "MaxB", address: "info@studiopulse.tech", verified: false }],
    });
    const out = html(<Links />);
    expect(out).toContain("30 minutes");
    expect(out).toContain("unverified");
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
});
