import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import * as crm from "./crm";
import { ZU_OPS } from "./crm/ops.generated";
import { REACHES, CHANGES_SENDING, CONFIRM_REASONS, confirmKind, level } from "./crm/policy";

/* Agency CRM: access, the call gates, audit, pulses and prune.
   Test ids carry the eval ids from specs/features/agency-crm-zuops/eval.md. */

const PULSE = "org_pulse";
const OTHER = "org_other";
const STUDIO = "org_studio";

// Invented people only.
const MAYA = { name: "Maya Okafor", email: "maya@northline.example", phone: "+12135550142" };
const BODY_TEXT = "Hi Maya, your session is confirmed for Friday";

type Ident = { subject: string; name: string; orgId: string; orgType: string };
const agencyId = (subject: string, orgId: string): Ident => ({ subject, name: subject, orgId, orgType: "agency" });

const ok = (data: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ success: true, data, error: null }), { status: 200, headers });

describe("crm", () => {
  let t: ReturnType<typeof convexTest>;
  let calls: Array<{ url: string; init: RequestInit }>;
  let respond: (url: string, init: RequestInit) => Response;

  beforeEach(async () => {
    t = convexTest(schema);
    calls = [];
    respond = () => ok({});
    vi.stubEnv("PULSE_AGENCY_ID", PULSE);
    vi.stubEnv("ZUOPS_CRM_API_KEY", "zu-rw-test");
    vi.stubEnv("ZUOPS_CRM_WRITES", "");
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "");
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", "");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }));
    await t.run(async (ctx) => {
      for (const [agency, owner] of [[PULSE, "u_owner"], [OTHER, "u_other"]] as const) {
        await ctx.db.insert("agencies", { agencyId: agency, name: agency, slug: agency, plan: "max", status: "active", ownerClerkUserId: owner, ownerEmail: `${owner}@x.example` });
        await ctx.db.insert("agencyMembers", { agencyId: agency, clerkUserId: owner, email: `${owner}@x.example`, name: owner, role: "owner", status: "active", invitedAt: 0 });
      }
      await ctx.db.insert("agencyMembers", { agencyId: PULSE, clerkUserId: "u_admin", email: "a@x.example", name: "admin", role: "admin", status: "active", invitedAt: 0 });
      await ctx.db.insert("agencyMembers", { agencyId: PULSE, clerkUserId: "u_staff", email: "s@x.example", name: "staff", role: "staff", status: "active", invitedAt: 0 });
      await ctx.db.insert("orgs", { orgId: STUDIO, name: "Studio", slug: "studio", tier: "growth", status: "active" });
      await ctx.db.insert("members", { orgId: STUDIO, name: "Owen Owner", role: "owner", skills: [], clerkUserId: "u_studio", email: "owen@x.example" });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const owner = () => t.withIdentity(agencyId("u_owner", PULSE) as never);
  const admin = () => t.withIdentity(agencyId("u_admin", PULSE) as never);
  const writesOn = () => vi.stubEnv("ZUOPS_CRM_WRITES", "on");
  const pathFor = (id: string) => Object.fromEntries(ZU_OPS[id].pathParams.map((p) => [p, "abc123"]));
  const header = (i: number, name: string) => (calls[i].init.headers as Record<string, string>)[name];

  /** Every row of every table, as one string, for "nothing personal was stored" scans. */
  const everyRow = () =>
    t.run(async (ctx) => {
      const parts: string[] = [];
      for (const table of Object.keys(schema.tables)) {
        const rows = await ctx.db.query(table as never).take(1000);
        if (rows.length) parts.push(JSON.stringify(rows));
      }
      return parts.join("\n");
    });

  /* ------------------------------ access ------------------------------ */

  const outsiders: Array<[string, () => ReturnType<typeof t.withIdentity> | typeof t, string]> = [
    ["A-01 signed-out caller", () => t, "signed_out"],
    ["A-02 studio member", () => t.withIdentity({ subject: "u_studio", name: "Owen", orgId: STUDIO, orgType: "studio" } as never), "signed_out"],
    ["A-03 agency staff (not owner or admin)", () => t.withIdentity(agencyId("u_staff", PULSE) as never), "forbidden"],
    ["A-04 owner of a different agency", () => t.withIdentity(agencyId("u_other", OTHER) as never), "forbidden"],
  ];

  for (const [title, who, reason] of outsiders) {
    it(`${title} gets nothing: queries null, call FORBIDDEN, no request`, async () => {
      await t.run(async (ctx) => {
        await ctx.db.insert("crmPulses", { agencyId: PULSE, event: "lead.created", deliveryId: "d0", leadId: "l1", at: Date.now() });
      });
      writesOn();
      vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
      const c = who();
      expect(await c.query(api.crm.access, {})).toEqual({ allowed: false, reason });
      expect(await c.query(api.crm.status, {})).toBeNull();
      expect(await c.query(api.crm.signal, {})).toBeNull();
      await expect(c.action(api.crm.call, { op: "list_leads" })).rejects.toThrow(/FORBIDDEN|owner or admin/);
      await expect(c.action(api.crm.call, { op: "send_message", body: { lead_id: "l1", channel: "sms", body: "x" }, confirm: true })).rejects.toThrow(/FORBIDDEN|owner or admin/);
      await expect(c.query(internal.crm._gate, {})).rejects.toThrow(/FORBIDDEN|owner or admin/);
      expect(calls).toHaveLength(0);
    });
  }

  it("A-01 not set up: no platform agency resolves to not_setup and nothing", async () => {
    vi.stubEnv("PULSE_AGENCY_ID", "");
    // Two agencies without a platform subscription: ambiguous, so none is the platform agency.
    expect(await owner().query(api.crm.access, {})).toEqual({ allowed: false, reason: "not_setup" });
    expect(await owner().query(api.crm.status, {})).toBeNull();
    await expect(owner().action(api.crm.call, { op: "list_leads" })).rejects.toThrow(/FORBIDDEN|owner or admin/);
    expect(calls).toHaveLength(0);
  });

  it("A-05 Pulse agency owner and admin get data, and the caller's identity carries from the action into the gate", async () => {
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", "whsec");
    for (const c of [owner(), admin()]) {
      expect(await c.query(api.crm.access, {})).toEqual({ allowed: true });
      expect(await c.query(api.crm.status, {})).toEqual({ keyConfigured: true, writesOn: false, adminKey: false, webhookConfigured: true });
      expect(await c.query(api.crm.signal, {})).toEqual({ at: 0, lead: 0, booking: 0, message: 0, call: 0, deal: 0 });
    }
    respond = () => ok({ leads: [{ id: "l1", full_name: MAYA.name }], has_more: false }, { "X-RateLimit-Remaining": "599" });
    const r = await owner().action(api.crm.call, { op: "list_leads", query: { limit: 5 } });
    expect(r).toMatchObject({ ok: true, status: 200, limits: { rateRemaining: 599 } });
    expect(JSON.parse(r.json!)).toEqual({ leads: [{ id: "l1", full_name: MAYA.name }], has_more: false });
    expect(calls[0].url).toBe("https://api.usezu.com/v1/leads?limit=5");
    expect(header(0, "Authorization")).toBe("Bearer zu-rw-test");
    expect(header(0, "Idempotency-Key")).toBeUndefined();
    // The gate sees exactly who called the action.
    expect(await owner().query(internal.crm._gate, {})).toEqual({ agencyId: PULSE, actor: "u_owner" });
    expect(await admin().query(internal.crm._gate, {})).toEqual({ agencyId: PULSE, actor: "u_admin" });
  });

  it("A-06 no public function accepts agencyId or workspace_id, and workspace_id is never sent", async () => {
    for (const fn of [crm.access, crm.status, crm.signal, crm.call]) {
      const args = JSON.stringify((fn as unknown as { exportArgs: () => string }).exportArgs());
      expect(args).not.toMatch(/agencyId|agency_id|workspace_id|workspaceId|orgId/);
    }
    writesOn();
    await owner().action(api.crm.call, { op: "list_leads", query: { workspace_id: "b77d090e-a44d-41f4-9838-9411d97373c5", limit: 2 } });
    await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x", workspace_id: "b77d090e-a44d-41f4-9838-9411d97373c5" } });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).not.toContain("workspace_id");
    expect(String(calls[1].init.body)).not.toContain("workspace_id");
  });

  /* ------------------------------- gates ------------------------------- */

  it("S-01 every request goes to https://api.usezu.com/v1/", async () => {
    writesOn();
    await owner().action(api.crm.call, { op: "get_lead", path: { lead_id: "l1" } });
    await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } });
    for (const c of calls) expect(c.url.startsWith("https://api.usezu.com/v1/")).toBe(true);
  });

  it("S-04 unknown op, unknown field, bad path values and a body on a read are refused before any request", async () => {
    writesOn();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ op: "drop_everything" }, "unknown_op"],
      [{ op: "toString" }, "unknown_op"],
      [{ op: "__proto__" }, "unknown_op"],
      [{ op: "create_lead", body: { full_name: "x", is_admin: true } }, "bad_field"],
      [{ op: "list_leads", query: { nope: 1 } }, "bad_field"],
      [{ op: "get_lead", path: { lead_id: "../admin" } }, "bad_path"],
      [{ op: "get_lead", path: { lead_id: "a/b" } }, "bad_path"],
      [{ op: "get_lead", path: { lead_id: ".." } }, "bad_path"],
      [{ op: "get_lead" }, "bad_path"],
      [{ op: "get_lead", path: { lead_id: "l1", extra: "x" } }, "bad_path"],
      [{ op: "list_leads", body: { a: 1 } }, "bad_field"],
      [{ op: "create_lead", body: ["full_name"] }, "bad_field"],
    ];
    for (const [args, code] of cases) {
      const r = await owner().action(api.crm.call, args as never);
      expect(r, JSON.stringify(args)).toMatchObject({ ok: false, status: 0, code, json: null });
      expect(r.reason).toBeTruthy();
    }
    expect(calls).toHaveLength(0);
  });

  it("no key set: not_connected, no request", async () => {
    vi.stubEnv("ZUOPS_CRM_API_KEY", "");
    expect(await owner().action(api.crm.call, { op: "list_leads" })).toMatchObject({ ok: false, code: "not_connected" });
    expect(calls).toHaveLength(0);
  });

  it("X-01 with ZUOPS_CRM_WRITES unset every write refuses as read only and makes no request", async () => {
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
    const writes = Object.values(ZU_OPS).filter((o) => o.method !== "GET");
    expect(writes.length).toBeGreaterThan(150);
    for (const o of writes) {
      const r = await owner().action(api.crm.call, { op: o.id, path: pathFor(o.id), confirm: true });
      expect(r, o.id).toMatchObject({ ok: false, code: "read_only", reason: "This deployment is read only against Zuops." });
    }
    vi.stubEnv("ZUOPS_CRM_WRITES", "yes"); // only exactly "on" switches writes on
    expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } })).toMatchObject({ code: "read_only" });
    expect(calls).toHaveLength(0);
  });

  it("X-06 every operation that reaches people, changes automatic sending, or deletes is refused without confirm, no request", async () => {
    writesOn();
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
    const flagged = Object.values(ZU_OPS).filter((o) => REACHES.has(o.id) || CHANGES_SENDING.has(o.id) || o.method === "DELETE");
    expect(flagged.length).toBeGreaterThan(50);
    for (const id of CHANGES_SENDING) expect(flagged.map((o) => o.id)).toContain(id);
    for (const o of flagged) {
      const kind = confirmKind(o)!;
      for (const confirm of [undefined, false]) {
        const r = await owner().action(api.crm.call, { op: o.id, path: pathFor(o.id), confirm });
        expect(r, o.id).toMatchObject({ ok: false, code: "needs_confirm", reason: CONFIRM_REASONS[kind] });
      }
    }
    expect(calls).toHaveLength(0);
    const sent = await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l1", channel: "sms", body: "x" }, confirm: true });
    expect(sent.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("X-06 create_lead with run_intake needs confirm (it sends the first text); without it, no confirm", async () => {
    writesOn();
    for (const run_intake of [true, "true"]) {
      const r = await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x", run_intake } });
      expect(r).toMatchObject({ ok: false, code: "needs_confirm", reason: "Confirm before this runs: it starts the new-lead texts for this person." });
      expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x", run_intake }, confirm: false })).toMatchObject({ code: "needs_confirm" });
    }
    expect(calls).toHaveLength(0);
    expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x", run_intake: true }, confirm: true })).toMatchObject({ ok: true });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ full_name: "x", run_intake: true });
    expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } })).toMatchObject({ ok: true });
    expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x", run_intake: false } })).toMatchObject({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it("X-08 admin operations without ZUOPS_CRM_ADMIN_KEY say they need a Full access key; with it they use that key", async () => {
    writesOn();
    const adminOps = Object.values(ZU_OPS).filter((o) => level(o) === "admin");
    expect(adminOps.length).toBeGreaterThan(10);
    for (const o of adminOps) {
      const r = await owner().action(api.crm.call, { op: o.id, path: pathFor(o.id), confirm: true });
      expect(r, o.id).toMatchObject({ ok: false, code: "needs_admin_key", reason: "Needs a Full access key." });
    }
    expect(calls).toHaveLength(0);
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
    expect(await owner().query(api.crm.status, {})).toMatchObject({ adminKey: true, writesOn: true });
    await owner().action(api.crm.call, { op: "delete_lead", path: { lead_id: "l1" }, confirm: true });
    await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } });
    expect(header(0, "Authorization")).toBe("Bearer zu-admin-test");
    expect(calls[0].init.method).toBe("DELETE");
    expect(header(1, "Authorization")).toBe("Bearer zu-rw-test");
  });

  it("X-02 every write carries an Idempotency-Key and a retry with the same idem reuses it", async () => {
    writesOn();
    const idem = "compose-7f3a2c91";
    await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l1", channel: "sms", body: "x" }, idem, confirm: true });
    await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l1", channel: "sms", body: "x" }, idem, confirm: true });
    await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } });
    await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" }, idem: "bad key with spaces" });
    await owner().action(api.crm.call, { op: "list_leads" });
    expect(header(0, "Idempotency-Key")).toBe(idem);
    expect(header(1, "Idempotency-Key")).toBe(idem);
    expect(header(2, "Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(header(3, "Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(header(3, "Idempotency-Key")).not.toBe(header(2, "Idempotency-Key"));
    expect(header(4, "Idempotency-Key")).toBeUndefined();
  });

  it("X-03 a refused write returns Zuops's reason (409 and 400)", async () => {
    writesOn();
    respond = () => new Response(JSON.stringify({ success: false, data: null, error: "slot_full", details: { code: "slot_full" } }), { status: 409 });
    const a = await owner().action(api.crm.call, { op: "create_booking", body: { lead_id: "l1", starts_at: "2026-11-12T17:00:00Z" } });
    expect(a).toMatchObject({ ok: false, status: 409, code: "slot_full", reason: "That time is already taken. Pick another slot." });
    expect(JSON.parse(a.json!)).toEqual({ code: "slot_full" });
    respond = () => new Response(JSON.stringify({ success: false, data: null, error: "A lead with that phone already exists.", details: { lead_id: "l_9" } }), { status: 409 });
    const b = await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } });
    expect(b).toMatchObject({ ok: false, code: "conflict", reason: "A lead with that phone already exists." });
    expect(JSON.parse(b.json!)).toEqual({ lead_id: "l_9" });
    respond = () => new Response(JSON.stringify({ success: false, data: null, error: "stage_key must be one of new, contacted, booked, won, lost" }), { status: 400 });
    const c = await owner().action(api.crm.call, { op: "update_lead", path: { lead_id: "l1" }, body: { stage_key: "nope" } });
    expect(c).toMatchObject({ ok: false, status: 400, reason: "stage_key must be one of new, contacted, booked, won, lost" });
    respond = () => new Response(JSON.stringify({ success: false, data: null, error: "rate_limit_exceeded" }), { status: 429, headers: { "Retry-After": "12" } });
    expect(await owner().action(api.crm.call, { op: "list_leads" })).toMatchObject({ ok: false, code: "rate_limited", retryAfter: 12 });
  });

  it("X-04 send text and send email reach Zuops with the right lead and channel; an email with no subject is Zuops's 400", async () => {
    writesOn();
    respond = () => ok({ message_id: "m1" }, { "X-Contacts-Remaining": "287" });
    const text = await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "sms", body: BODY_TEXT }, idem: "compose-0001aa", confirm: true });
    expect(text).toMatchObject({ ok: true, limits: { contactsRemaining: 287 } });
    expect(calls[0].url).toBe("https://api.usezu.com/v1/messages");
    expect(calls[0].init.method).toBe("POST");
    expect(header(0, "Content-Type")).toBe("application/json");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ lead_id: "l_maya", channel: "sms", body: BODY_TEXT });

    respond = () => new Response(JSON.stringify({ success: false, data: null, error: "subject is required for email" }), { status: 400 });
    const email = await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "email", body: BODY_TEXT }, confirm: true });
    expect(email).toMatchObject({ ok: false, status: 400, reason: "subject is required for email" });
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({ lead_id: "l_maya", channel: "email" });
  });

  it("X-09 each send writes an audit row with actor, action and lead id, and no body", async () => {
    writesOn();
    await admin().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "sms", body: BODY_TEXT }, confirm: true });
    respond = () => new Response(JSON.stringify({ success: false, error: "window_closed" }), { status: 409 });
    await admin().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "instagram", body: BODY_TEXT }, confirm: true });
    await admin().action(api.crm.call, { op: "list_leads", query: { search: MAYA.name } });
    const rows = await t.run(async (ctx) => (await ctx.db.query("outreachEvents").collect()).filter((r) => r.agencyId === PULSE).sort((x, y) => x._creationTime - y._creationTime));
    expect(rows).toHaveLength(2); // reads are not audited
    expect(rows[0]).toMatchObject({ actor: "u_admin", action: "crm.send_message", result: "ok", resource: "/v1/messages lead:l_maya", detail: "200" });
    expect(rows[1]).toMatchObject({ actor: "u_admin", action: "crm.send_message", result: "denied", detail: "409" });
    expect(JSON.stringify(rows)).not.toContain("Hi Maya");
    expect(JSON.stringify(rows)).not.toContain("instagram");
  });

  it("returns too_large instead of an answer over 900 KB", async () => {
    respond = () => ok({ blob: "x".repeat(950 * 1024) });
    expect(await owner().action(api.crm.call, { op: "list_leads" })).toMatchObject({
      ok: false, code: "too_large", json: null, reason: "That answer is too large to show. Narrow it with a filter or a smaller limit.",
    });
  });

  it("A-08 S-05 after reads, sends and a webhook delivery, no row anywhere holds a name, email, phone or message body", async () => {
    writesOn();
    vi.stubEnv("ZUOPS_CRM_WEBHOOK_SECRET", "whsec");
    const lead = { id: "l_maya", full_name: MAYA.name, email: MAYA.email, phone: MAYA.phone, inquiry: BODY_TEXT };
    respond = (url) => (url.includes("/timeline") ? ok({ lead_id: "l_maya", events: [{ id: "e1", body: BODY_TEXT }] }) : ok({ lead }));
    await owner().action(api.crm.call, { op: "get_lead", path: { lead_id: "l_maya" } });
    await owner().action(api.crm.call, { op: "lead_timeline", path: { lead_id: "l_maya" } });
    await owner().action(api.crm.call, { op: "update_lead", path: { lead_id: "l_maya" }, body: { full_name: MAYA.name, email: MAYA.email, phone: MAYA.phone } });
    await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "sms", body: BODY_TEXT }, confirm: true });
    const raw = JSON.stringify({ event: "message.received", data: { lead_id: "l_maya", message_id: "m_1", body: BODY_TEXT, from: MAYA.phone, lead: { id: "l_maya", full_name: MAYA.name, email: MAYA.email, phone: MAYA.phone } } });
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = "sha256=" + [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const hook = await t.fetch("/zu/events", { method: "POST", headers: { "x-webhook-signature": sig, "x-webhook-event": "message.received", "x-webhook-delivery": "dlv_1" }, body: raw });
    expect(hook.status).toBe(202);

    const pulses = await t.run(async (ctx) => await ctx.db.query("crmPulses").collect());
    expect(pulses).toHaveLength(1);
    expect(Object.keys(pulses[0]).sort()).toEqual(["_creationTime", "_id", "agencyId", "at", "deliveryId", "event", "leadId", "messageId"]);
    const all = await everyRow();
    expect(all).toContain("l_maya"); // ids are kept
    for (const s of [MAYA.name, "Maya", MAYA.email, "northline", MAYA.phone, "2135550142", BODY_TEXT, "Friday"]) expect(all).not.toContain(s);
  });

  /* ------------------------------ signal ------------------------------ */

  it("signal returns the newest time per kind from the newest 50 pulses", async () => {
    await t.run(async (ctx) => {
      const ins = (event: string, at: number, deliveryId: string) => ctx.db.insert("crmPulses", { agencyId: PULSE, event, deliveryId, at });
      await ins("lead.created", 1_000, "a");
      await ins("lead.updated", 2_000, "b");
      await ins("appointment.booked", 3_000, "c");
      await ins("message.received", 4_000, "d");
      await ins("call.completed", 5_000, "e");
      await ins("deal.updated", 6_000, "f");
      await ctx.db.insert("crmPulses", { agencyId: OTHER, event: "lead.created", deliveryId: "g", at: 9_000 });
    });
    expect(await owner().query(api.crm.signal, {})).toEqual({ at: 6_000, lead: 2_000, booking: 3_000, message: 4_000, call: 5_000, deal: 6_000 });
  });

  /* ------------------------------- prune ------------------------------- */

  it("S-07 prune drops pulses older than 7 days, at most 500 per run, through an index", async () => {
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < 501; i++) await ctx.db.insert("crmPulses", { agencyId: PULSE, event: "lead.created", deliveryId: `old_${i}`, at: now - 8 * 86_400_000 - i });
      await ctx.db.insert("crmPulses", { agencyId: PULSE, event: "lead.created", deliveryId: "fresh", at: now - 86_400_000 });
    });
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      expect(await t.mutation(internal.crm.prunePulses, {})).toBe(500);
      const left = await t.run(async (ctx) => await ctx.db.query("crmPulses").collect());
      expect(left).toHaveLength(2);
      expect(left.map((r) => r.deliveryId)).toContain("fresh");
      expect(await t.mutation(internal.crm.prunePulses, {})).toBe(1);
      expect(await t.mutation(internal.crm.prunePulses, {})).toBe(0);
      expect((await t.run(async (ctx) => await ctx.db.query("crmPulses").collect())).map((r) => r.deliveryId)).toEqual(["fresh"]);
    } finally {
      vi.useRealTimers();
    }
    // Reads of crmPulses always go through an index with a limit.
    const src = readFileSync("convex/crm.ts", "utf8");
    expect(src).not.toMatch(/crmPulses"\)\s*\.collect\(/);
    expect(src).not.toMatch(/\.collect\(\)/);
  });

  it("X-07 no cron and no CRM webhook code calls a sending endpoint", () => {
    for (const file of ["convex/crons.ts", "convex/crm/webhook.ts"]) {
      const src = readFileSync(file, "utf8");
      for (const needle of ["/v1/messages", "/send", "/enroll"]) expect(src, `${file} ${needle}`).not.toContain(needle);
    }
    const hook = readFileSync("convex/crm/webhook.ts", "utf8");
    expect(hook).not.toMatch(/zuRequest|fetch\(|runAction|scheduler/);
    // The only CRM cron is the prune, which deletes rows and calls nothing.
    const crons = readFileSync("convex/crons.ts", "utf8");
    expect(crons.match(/internal\.crm\.\w+/g)).toEqual(["internal.crm.prunePulses"]);
  });
});
