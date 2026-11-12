import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";
import { bodyEvent, pickIds, signalKind } from "./webhook";

/* POST /zu/events: the CRM signal. Test ids carry the eval ids. */

const PULSE = "org_pulse";
const SECRET = "whsec_test_secret";
const MAYA = { name: "Maya Okafor", email: "maya@northline.example", phone: "+12135550142" };
const WS = "e56bf309-bede-486f-b4b5-1948248b3839";

async function sign(body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("POST /zu/events", () => {
  let t: ReturnType<typeof convexTest>;
  let fetchCalls: number;

  beforeEach(async () => {
    t = convexTest(schema);
    fetchCalls = 0;
    vi.stubEnv("PULSE_AGENCY_ID", PULSE);
    vi.stubEnv("ZUOPS_CRM_WORKSPACE_ID", "");
    vi.stubGlobal("fetch", vi.fn(async () => {
      fetchCalls++;
      return new Response("{}");
    }));
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", { agencyId: PULSE, name: PULSE, slug: PULSE, plan: "max", status: "active", ownerClerkUserId: "u_owner", ownerEmail: "o@x.example" });
      await ctx.db.insert("agencyMembers", { agencyId: PULSE, clerkUserId: "u_owner", email: "o@x.example", name: "owner", role: "owner", status: "active", invitedAt: 0 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const leadBody = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      event: "lead.created",
      workspace_id: WS,
      data: { id: "l_maya", lead: { id: "l_maya", full_name: MAYA.name, email: MAYA.email, phone: MAYA.phone, custom_fields: { notes: "Wants a mix by Friday" } }, ...extra },
    });

  const post = async (body: string, headers: Record<string, string>) => t.fetch("/zu/events", { method: "POST", headers, body });
  const signed = async (body: string, event: string, delivery?: string, extra: Record<string, string> = {}) =>
    post(body, { "x-webhook-signature": await sign(body), "x-webhook-event": event, ...(delivery ? { "x-webhook-delivery": delivery } : {}), ...extra });
  const pulses = () => t.run(async (ctx) => await ctx.db.query("crmPulses").collect());
  const owner = () => t.withIdentity({ subject: "u_owner", name: "owner", orgId: PULSE, orgType: "agency" } as never);

  it("W-01 no secret set: 503", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", "");
    const body = leadBody();
    expect((await signed(body, "lead.created", "d1")).status).toBe(503);
    expect(await pulses()).toHaveLength(0);
  });

  it("W-02 missing or wrong signature: 401, nothing stored", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const body = leadBody();
    expect((await post(body, { "x-webhook-event": "lead.created", "x-webhook-delivery": "d1" })).status).toBe(401);
    expect((await post(body, { "x-webhook-event": "lead.created", "x-webhook-delivery": "d1", "x-webhook-signature": await sign(body, "wrong") })).status).toBe(401);
    expect((await post(body, { "x-webhook-event": "lead.created", "x-webhook-delivery": "d1", "x-webhook-signature": await sign(body + " ") })).status).toBe(401);
    expect((await post(body, { "x-webhook-event": "lead.created", "x-webhook-signature": "sha256=zz" })).status).toBe(401);
    expect(await pulses()).toHaveLength(0);
    expect(fetchCalls).toBe(0);
  });

  it("W-03 a valid delivery: 202, one pulse with the event and ids only, and crm.signal changes", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const before = await owner().query(api.crm.signal, {});
    expect(before).toEqual({ at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 });
    const res = await signed(leadBody(), "lead.created", "dlv_1");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await pulses();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agencyId: PULSE, event: "lead.created", kind: "lead", deliveryHeader: "dlv_1", leadId: "l_maya" });
    expect(rows[0].deliveryId).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].bookingId).toBeUndefined();
    const after = (await owner().query(api.crm.signal, {}))!;
    expect(after.lead).toBe(rows[0].at);
    expect(after.at).toBe(rows[0].at);
    expect(after.booking).toBe(0);

    const appt = JSON.stringify({ data: { booking_id: "bk_1", lead_id: "l_maya", starts_at: "2026-11-14T18:00:00Z" } });
    expect((await signed(appt, "appointment.booked", "dlv_2")).status).toBe(202);
    const call = JSON.stringify({ call_id: "c_1", lead_id: null, summary: "Caller asked about rates" });
    expect((await signed(call, "call.completed", "dlv_3")).status).toBe(202);
    const sig = (await owner().query(api.crm.signal, {}))!;
    expect(sig.booking).toBeGreaterThan(0);
    expect(sig.call).toBeGreaterThan(0);
    const byDelivery = Object.fromEntries((await pulses()).map((r) => [r.deliveryHeader, r]));
    expect(byDelivery.dlv_2).toMatchObject({ bookingId: "bk_1", leadId: "l_maya" });
    expect(byDelivery.dlv_3).toMatchObject({ callId: "c_1" });
    expect(byDelivery.dlv_3.leadId).toBeUndefined();
    expect(fetchCalls).toBe(0); // the route never calls Zuops
  });

  it("accepts the older X-Zuops-Signature and X-Zuops-Event headers", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const body = JSON.stringify({ data: { id: "l_maya" } }); // no event name in the body: the header is used
    const res = await post(body, { "x-zuops-signature": await sign(body), "x-zuops-event": "lead.updated", "x-webhook-delivery": "legacy_1" });
    expect(res.status).toBe(202);
    expect((await pulses())[0]).toMatchObject({ event: "lead.updated", kind: "lead", deliveryHeader: "legacy_1" });
  });

  it("W-04 a replayed delivery id: 200 duplicate, no second row; without the header the body hash de-duplicates", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const body = leadBody();
    expect((await signed(body, "lead.created", "dlv_same")).status).toBe(202);
    const again = await signed(body, "lead.created", "dlv_same");
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true, duplicate: true });
    expect(await pulses()).toHaveLength(1);

    const other = JSON.stringify({ data: { message_id: "m_9", lead_id: "l_2" } });
    expect((await signed(other, "message.sent")).status).toBe(202);
    expect((await signed(other, "message.sent")).status).toBe(200);
    const rows = await pulses();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.messageId === "m_9")!.deliveryId).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchCalls).toBe(0);
  });

  it("W-05 body content is never stored", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const msg = JSON.stringify({ data: { message_id: "m_1", lead_id: "l_maya", body: `Hi it's ${MAYA.name}, call me at ${MAYA.phone}`, from: MAYA.phone, to: "+13105550100", lead: { full_name: MAYA.name, email: MAYA.email } } });
    expect((await signed(leadBody(), "lead.created", "d_a")).status).toBe(202);
    expect((await signed(msg, "message.received", "d_b")).status).toBe(202);
    const all = await t.run(async (ctx) => {
      const parts: string[] = [];
      for (const table of Object.keys(schema.tables)) {
        const rows = await ctx.db.query(table as never).take(1000);
        if (rows.length) parts.push(JSON.stringify(rows));
      }
      return parts.join("\n");
    });
    for (const s of [MAYA.name, "Maya", MAYA.email, MAYA.phone, "2135550142", "Friday", "call me", "3105550100"]) expect(all).not.toContain(s);
    for (const r of await pulses()) {
      expect(Object.keys(r).filter((k) => !k.startsWith("_")).sort()).toEqual(
        expect.arrayContaining(["agencyId", "at", "deliveryId", "event"]),
      );
      for (const k of Object.keys(r)) expect(["_id", "_creationTime", "agencyId", "event", "kind", "deliveryId", "deliveryHeader", "leadId", "bookingId", "messageId", "callId", "at"]).toContain(k);
    }
  });

  it("W-06 a body over 256 KB: 413, nothing stored", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const big = JSON.stringify({ data: { lead_id: "l1", pad: "x".repeat(257 * 1024) } });
    const res = await signed(big, "lead.created", "d_big");
    expect(res.status).toBe(413);
    expect(await pulses()).toHaveLength(0);
  });

  it("an event outside the eleven is ignored with 200 and no row", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const body = JSON.stringify({ data: { id: "l_1" } });
    for (const event of ["lead.deleted", "invoice.paid", ""]) {
      const res = await signed(body, event, `d_${event || "none"}`);
      expect(res.status).toBe(200);
      expect((await res.json()).ignored).toBeTruthy();
    }
    // An unknown event named by the signed body is ignored the same way.
    const named = JSON.stringify({ event: "invoice.paid", data: { id: "l_1" } });
    expect(await (await signed(named, "", "d_named")).json()).toEqual({ ok: true, ignored: "invoice.paid" });
    expect(await pulses()).toHaveLength(0);
  });

  it("a pinned workspace ignores deliveries for another workspace", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("ZUOPS_CRM_WORKSPACE_ID", WS);
    const foreign = JSON.stringify({ workspace_id: "b77d090e-a44d-41f4-9838-9411d97373c5", data: { id: "l_x" } });
    const nested = JSON.stringify({ data: { workspace_id: "b77d090e-a44d-41f4-9838-9411d97373c5", lead_id: "l_y" } });
    expect(await (await signed(foreign, "lead.created", "w1")).json()).toEqual({ ok: true, ignored: "workspace" });
    expect(await (await signed(nested, "lead.created", "w2")).json()).toEqual({ ok: true, ignored: "workspace" });
    expect((await signed(leadBody(), "lead.created", "w3")).status).toBe(202);
    expect((await pulses()).map((r) => r.deliveryHeader)).toEqual(["w3"]);
  });

  it("F-B3 no pinned PULSE_AGENCY_ID: 503, nothing stored, even when one agency could be guessed", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PULSE_AGENCY_ID", "");
    // org_pulse is the only agency without a subscription, so platformAgencyId would guess it.
    expect((await signed(leadBody(), "lead.created", "na")).status).toBe(503);
    expect(await pulses()).toHaveLength(0);
  });

  it("F-B2 a replay with a new delivery header is still a duplicate: one row", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const body = leadBody();
    expect((await signed(body, "lead.created", "dlv_first")).status).toBe(202);
    for (const header of ["dlv_second", "dlv_third", undefined]) {
      const again = await signed(body, "lead.created", header);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual({ ok: true, duplicate: true });
    }
    const rows = await pulses();
    expect(rows).toHaveLength(1);
    expect(rows[0].deliveryHeader).toBe("dlv_first");
  });

  it("F-B2 the event name comes from the signed body; a header that disagrees is refused 400 with no row", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const body = leadBody(); // carries event: "lead.created"
    const res = await signed(body, "message.received", "dlv_mismatch");
    expect(res.status).toBe(400);
    expect(await pulses()).toHaveLength(0);
    for (const k of ["type", "event_type"]) {
      const b = JSON.stringify({ [k]: "call.completed", call_id: `c_${k}` });
      expect((await signed(b, "deal.updated", `x_${k}`)).status).toBe(400);
      expect((await signed(b, "call.completed", `y_${k}`)).status).toBe(202);
    }
    // No header at all: the body's name is used.
    const noHeader = JSON.stringify({ event: "appointment.cancelled", data: { booking_id: "bk_9" } });
    expect((await post(noHeader, { "x-webhook-signature": await sign(noHeader) })).status).toBe(202);
    const rows = await pulses();
    expect(rows.map((r) => r.event).sort()).toEqual(["appointment.cancelled", "call.completed", "call.completed"]);
    expect(bodyEvent({ event: " lead.created " })).toBe("lead.created");
    expect(bodyEvent({ data: { event: "lead.created" } })).toBeUndefined();
  });

  it("F-B11 a declared Content-Length over 256 KB is refused 413 before the body is read", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const body = leadBody();
    const res = await post(body, { "x-webhook-signature": await sign(body), "x-webhook-event": "lead.created", "content-length": String(300 * 1024) });
    expect(res.status).toBe(413);
    expect(await pulses()).toHaveLength(0);
  });

  it("F-B10 signal keeps each kind's newest time even after many pulses of another kind", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", SECRET);
    const call = JSON.stringify({ event: "call.completed", call_id: "c_old" });
    expect((await signed(call, "call.completed")).status).toBe(202);
    const callAt = (await owner().query(api.crm.signal, {}))!.call;
    expect(callAt).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) {
      const m = JSON.stringify({ event: "message.received", data: { message_id: `m_${i}` } });
      expect((await signed(m, "message.received")).status).toBe(202);
    }
    const sig = (await owner().query(api.crm.signal, {}))!;
    expect(sig.call).toBe(callAt);
    expect(sig.message).toBeGreaterThanOrEqual(callAt);
    expect(sig.at).toBe(Math.max(sig.call, sig.message));
  });

  it("ids that do not match the strict pattern are dropped, not stored", () => {
    expect(pickIds("lead.created", { lead_id: "l 1", data: { lead: { id: "<script>" }, id: MAYA.email, booking_id: "b".repeat(65) } })).toEqual({});
    expect(pickIds("message.received", { data: { id: "m_top", lead_id: "l_1", message_id: "m_1" } })).toEqual({ leadId: "l_1", messageId: "m_1" });
    expect(pickIds("lead.updated", { data: { id: "l_9" } })).toEqual({ leadId: "l_9" });
    expect(pickIds("appointment.booked", "not an object")).toEqual({});
  });

  it("maps event names to signal kinds", () => {
    expect(signalKind("lead.qualified")).toBe("lead");
    expect(signalKind("appointment.cancelled")).toBe("booking");
    expect(signalKind("message.failed")).toBe("message");
    expect(signalKind("call.completed")).toBe("call");
    expect(signalKind("deal.updated")).toBe("deal");
    expect(signalKind("other.thing")).toBeNull();
  });
});
