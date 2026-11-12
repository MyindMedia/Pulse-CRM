import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import * as crm from "./crm";
import { ZU_OPS } from "./crm/ops.generated";
import { CLASSIFIED, CONFIRM_REASONS, confirmKind, level } from "./crm/policy";

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
  const WS_UUID = "e56bf309-bede-486f-b4b5-1948248b3839";
  const pathFor = (id: string) => Object.fromEntries(ZU_OPS[id].pathParams.map((p) => [p, p === "workspace_id" ? WS_UUID : "abc123"]));
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
    // F-B4: a signed-in studio member is "forbidden" (not "signed_out", which only a caller with no identity gets).
    ["A-02 F-B4 studio member", () => t.withIdentity({ subject: "u_studio", name: "Owen", orgId: STUDIO, orgType: "studio" } as never), "forbidden"],
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

  it("F-B3 the CRM needs a pinned PULSE_AGENCY_ID; it never uses the guessed platform agency", async () => {
    vi.stubEnv("PULSE_AGENCY_ID", "");
    // Leave org_pulse as the ONLY agency without a subscription, which platformAgencyId would guess.
    await t.run(async (ctx) => {
      const other = await ctx.db.query("agencies").filter((q) => q.eq(q.field("agencyId"), OTHER)).first();
      if (other) await ctx.db.delete(other._id);
    });
    expect(await owner().query(api.crm.access, {})).toEqual({ allowed: false, reason: "not_setup" });
    expect(await owner().query(api.crm.status, {})).toBeNull();
    expect(await owner().query(api.crm.signal, {})).toBeNull();
    await expect(owner().action(api.crm.call, { op: "list_leads" })).rejects.toThrow(/FORBIDDEN|owner or admin/);
    expect(calls).toHaveLength(0);
  });

  it("F-B4 an AGENCY_ADMIN_EMAILS operator with no member row is elevated to owner of the pinned Pulse agency, and only that one", async () => {
    vi.stubEnv("AGENCY_ADMIN_EMAILS", "ops@pulse.example");
    const op = t.withIdentity({ subject: "u_ops", name: "Ops", email: "ops@pulse.example" } as never);
    expect(await op.query(api.crm.access, {})).toEqual({ allowed: true });
    expect(await op.query(internal.crm._gate, {})).toEqual({ agencyId: PULSE, actor: "u_ops" });
    const stranger = t.withIdentity({ subject: "u_x", name: "X", email: "someone@else.example" } as never);
    expect(await stranger.query(api.crm.access, {})).toEqual({ allowed: false, reason: "forbidden" });
    vi.stubEnv("AGENCY_ADMIN_EMAILS", "");
    expect(await op.query(api.crm.access, {})).toEqual({ allowed: false, reason: "forbidden" });
  });

  it("F-B4 a suspended or invited member of the Pulse agency gets nothing", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencyMembers", { agencyId: PULSE, clerkUserId: "u_gone", email: "g@x.example", name: "gone", role: "admin", status: "suspended", invitedAt: 0 });
      await ctx.db.insert("agencyMembers", { agencyId: PULSE, clerkUserId: "u_new", email: "n@x.example", name: "new", role: "owner", status: "invited", invitedAt: 0 });
    });
    for (const subject of ["u_gone", "u_new"]) {
      for (const ident of [{ subject, name: subject }, agencyId(subject, PULSE)]) {
        const c = t.withIdentity(ident as never);
        const a = await c.query(api.crm.access, {}).catch((e: unknown) => ({ threw: String(e) }));
        expect(a, `${subject} ${JSON.stringify(ident)}`).not.toEqual({ allowed: true });
        await expect(c.action(api.crm.call, { op: "list_leads" })).rejects.toThrow();
      }
    }
    expect(calls).toHaveLength(0);
  });

  it("F-B4 PULSE_DEMO_MODE=1 with Clerk configured: a caller with no identity is still refused", async () => {
    vi.stubEnv("PULSE_DEMO_MODE", "1");
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://clerk.pulse.example");
    expect(await t.query(api.crm.access, {})).toEqual({ allowed: false, reason: "signed_out" });
    expect(await t.query(api.crm.status, {})).toBeNull();
    await expect(t.action(api.crm.call, { op: "list_leads" })).rejects.toThrow(/FORBIDDEN|owner or admin/);
    expect(calls).toHaveLength(0);
  });

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

  it("open bodies: update_stage sends prose-documented fields, drops workspace_id, and is still size capped; strict ops still refuse unknown keys", async () => {
    writesOn();
    const r = await owner().action(api.crm.call, { op: "update_stage", path: { stage_id: "st_1" }, body: { label: "Quoted", color: "amber", hidden: false } });
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.usezu.com/v1/stages/st_1");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ label: "Quoted", color: "amber", hidden: false });

    await owner().action(api.crm.call, { op: "update_stage", path: { stage_id: "st_1" }, body: { label: "x", workspace_id: "b77d090e", extra: { workspace_id: "b77d090e", keep: 1 } } });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ label: "x", extra: { keep: 1 } });
    expect(String(calls[1].init.body)).not.toContain("workspace_id");

    expect(await owner().action(api.crm.call, { op: "update_stage", path: { stage_id: "st_1" }, body: { label: "x".repeat(65 * 1024) } })).toMatchObject({ ok: false, code: "bad_field" });
    expect(await owner().action(api.crm.call, { op: "update_stage", path: { stage_id: "st_1" }, body: { "bad key": 1 } })).toMatchObject({ ok: false, code: "bad_field" });
    expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x", label: "nope" } })).toMatchObject({ ok: false, code: "bad_field" });
    expect(calls).toHaveLength(2);
  });

  it("X-06 delete_stage with move_to needs confirm; with it the body reaches Zuops", async () => {
    writesOn();
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
    const refused = await owner().action(api.crm.call, { op: "delete_stage", path: { stage_id: "st_2" }, body: { move_to: "contacted" } });
    expect(refused).toMatchObject({ ok: false, code: "needs_confirm", reason: "Confirm before this runs: it deletes something." });
    expect(calls).toHaveLength(0);
    const ok = await owner().action(api.crm.call, { op: "delete_stage", path: { stage_id: "st_2" }, body: { move_to: "contacted" }, confirm: true });
    expect(ok.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.usezu.com/v1/stages/st_2");
    expect(calls[0].init.method).toBe("DELETE");
    expect(header(0, "Authorization")).toBe("Bearer zu-admin-test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ move_to: "contacted" });
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

  it("X-06 F-B1 every non-safe classified operation and every DELETE is refused without confirm, no request", async () => {
    writesOn();
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
    // Iterates the whole classification, not a set derived from it.
    const flagged = Object.entries(CLASSIFIED)
      .filter(([id, [, kind]]) => kind !== "safe" || ZU_OPS[id].method === "DELETE")
      .map(([id]) => ZU_OPS[id]);
    expect(flagged.length).toBe(Object.keys(CLASSIFIED).length - Object.entries(CLASSIFIED).filter(([id, [, k]]) => k === "safe" && ZU_OPS[id].method !== "DELETE").length);
    expect(flagged.length).toBeGreaterThan(110);
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
    await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } });
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
    const a = await owner().action(api.crm.call, { op: "create_booking", body: { lead_id: "l1", starts_at: "2026-11-12T17:00:00Z" }, confirm: true });
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

  it("F-B5 a malformed retry key is refused before any request", async () => {
    writesOn();
    for (const idem of ["bad key with spaces", "short", "x".repeat(129), "semi;colon-123"]) {
      expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" }, idem })).toMatchObject({
        ok: false, code: "bad_field", reason: "That retry key is not valid.",
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("F-B6 a write whose answer is over 900 KB still reports success; a read that large is too_large", async () => {
    writesOn();
    respond = () => ok({ blob: "x".repeat(950 * 1024) });
    expect(await owner().action(api.crm.call, { op: "create_lead", body: { full_name: "x" } })).toMatchObject({
      ok: true, status: 200, json: null, reason: "Done. The answer was too large to show.",
    });
    expect(await owner().action(api.crm.call, { op: "list_leads" })).toMatchObject({ ok: false, code: "too_large", json: null });
  });

  it("F-B7 the audit row exists as unknown before the request leaves, and gate refusals are audited as denied with the code only", async () => {
    writesOn();
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const rows = await t.run(async (ctx) => await ctx.db.query("outreachEvents").collect());
      seen.push(...rows.map((r) => r.result));
      return ok({ message_id: "m1" });
    }));
    await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "sms", body: BODY_TEXT }, confirm: true });
    expect(seen).toEqual(["unknown"]);
    const after = await t.run(async (ctx) => await ctx.db.query("outreachEvents").collect());
    expect(after.map((r) => r.result)).toEqual(["ok"]);

    // Refused at the gate: no request, one denied row naming the code, no body or query values.
    await owner().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "sms", body: BODY_TEXT } });
    vi.stubEnv("ZUOPS_CRM_WRITES", "");
    await owner().action(api.crm.call, { op: "create_lead", body: { full_name: MAYA.name, email: MAYA.email } });
    await owner().action(api.crm.call, { op: "create_outbound_webhook", body: { name: "n", target_url: "https://hooks.example/x" }, confirm: true });
    expect(calls).toHaveLength(1);
    const rows = await t.run(async (ctx) => (await ctx.db.query("outreachEvents").collect()).sort((x, y) => x._creationTime - y._creationTime));
    expect(rows.slice(1).map((r) => [r.action, r.result, r.detail])).toEqual([
      ["crm.send_message", "denied", "needs_confirm"],
      ["crm.create_lead", "denied", "read_only"],
      ["crm.create_outbound_webhook", "denied", "read_only"],
    ]);
    const text = JSON.stringify(rows);
    for (const secret of [BODY_TEXT, MAYA.name, MAYA.email, "hooks.example"]) expect(text).not.toContain(secret);
  });

  it("R3-B2 a timeout or a Zuops 5xx leaves the audit row unknown; only a 4xx is denied", async () => {
    writesOn();
    const send = () => admin().action(api.crm.call, { op: "send_message", body: { lead_id: "l_maya", channel: "sms", body: BODY_TEXT }, confirm: true });
    respond = () => new Response(JSON.stringify({ success: false, error: "upstream" }), { status: 502 });
    await send();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));
    await send();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return respond(url, init); }));
    respond = () => new Response(JSON.stringify({ success: false, error: "window_closed" }), { status: 409 });
    await send();
    const rows = await t.run(async (ctx) => (await ctx.db.query("outreachEvents").collect()).sort((x, y) => x._creationTime - y._creationTime));
    expect(rows.map((r) => [r.result, r.detail])).toEqual([["unknown", "502"], ["unknown", "0"], ["denied", "409"]]);
  });

  it("R3-B3 lead_reply_ideas runs without a confirm", async () => {
    writesOn();
    respond = () => ok({ lead_id: "l1", channel: "sms", kind: "reply", replies: [{ label: "a", text: "b" }], subject: null });
    const r = await owner().action(api.crm.call, { op: "lead_reply_ideas", path: { lead_id: "l1" }, body: { channel: "sms" } });
    expect(r).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("R3-B4 create_booking needs a confirm unless notify_lead is false", async () => {
    writesOn();
    const body = { lead_id: "l1", starts_at: "2026-11-20T17:00:00Z" };
    expect(await owner().action(api.crm.call, { op: "create_booking", body })).toMatchObject({ ok: false, code: "needs_confirm" });
    expect(calls).toHaveLength(0);
    expect(await owner().action(api.crm.call, { op: "create_booking", body: { ...body, notify_lead: false } })).toMatchObject({ ok: true });
    expect(await owner().action(api.crm.call, { op: "create_booking", body, confirm: true })).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
  });

  it("R3-B5 key_self through call keeps name, access_level and rate_limit_per_min and hides the prefix", async () => {
    respond = () => ok({ key: { id: "k1", name: "Pulse CRM", key_prefix: "zu-ab12", access_level: "write", scopes: ["write"], rate_limit_per_min: 120, is_active: true, type: "account", created_at: "2026-11-01T00:00:00Z" }, endpoints: { api: "https://api.usezu.com/v1" } });
    const r = await owner().action(api.crm.call, { op: "key_self" });
    const data = JSON.parse(r.json!);
    expect(data.key).toMatchObject({ name: "Pulse CRM", access_level: "write", rate_limit_per_min: 120, scopes: ["write"], is_active: true, type: "account", key_prefix: "hidden" });
    expect(r.json).not.toContain("zu-ab12");
  });

  it("F-B8 a path value that looks like an email is masked in the audit row", async () => {
    writesOn();
    await owner().action(api.crm.call, { op: "update_lead", path: { lead_id: MAYA.email }, body: { stage_key: "won" } });
    expect(calls[0].url).toContain("/v1/leads/maya%40northline.example");
    const rows = await t.run(async (ctx) => await ctx.db.query("outreachEvents").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].resource).toBe("/v1/leads/[masked]");
    expect(JSON.stringify(rows)).not.toContain("northline");
  });

  it("F-B9 a pinned ZUOPS_CRM_WORKSPACE_ID replaces the client's value; unpinned, a non-UUID is refused; nested workspace_id is stripped", async () => {
    vi.stubEnv("ZUOPS_CRM_WORKSPACE_ID", WS_UUID);
    await owner().action(api.crm.call, { op: "get_workspace", path: { workspace_id: "11111111-2222-4333-8444-555555555555" } });
    expect(calls[0].url).toBe(`https://api.usezu.com/v1/workspaces/${WS_UUID}`);
    vi.stubEnv("ZUOPS_CRM_WORKSPACE_ID", "");
    expect(await owner().action(api.crm.call, { op: "get_workspace", path: { workspace_id: "abc123" } })).toMatchObject({ ok: false, code: "bad_path" });
    expect(calls).toHaveLength(1);
    writesOn();
    await owner().action(api.crm.call, {
      op: "update_workspace", path: { workspace_id: WS_UUID }, body: { enabled_features: { sales: true, workspace_id: "other-tenant" } },
    });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ enabled_features: { sales: true } });
  });

  it("F-B12 secrets in answers are hidden; the outbound webhook signing secret is shown once on create", async () => {
    respond = () => ok({ name: "Pulse CRM", prefix: "zu_live_ab12", key: "zu_live_ab12xyz", scopes: ["leads:read"] });
    const self = await owner().action(api.crm.call, { op: "key_self" });
    expect(JSON.parse(self.json!)).toEqual({ name: "Pulse CRM", prefix: "hidden", key: "hidden", scopes: ["leads:read"] });

    respond = () => ok([{ id: "w1", auth_token: "tok-1", nested: { access_token: "a", refresh_token: "r", signing_secret: "s" } }]);
    const list = await owner().action(api.crm.call, { op: "list_outbound_webhooks" });
    expect(JSON.parse(list.json!)).toEqual([{ id: "w1", auth_token: "hidden", nested: { access_token: "hidden", refresh_token: "hidden", signing_secret: "hidden" } }]);
    expect(list.json).not.toMatch(/tok-1/);

    writesOn();
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
    respond = () => ok({ id: "w2", secret: "whsec_once", signing_secret: "whsec_once", auth_token: "t" });
    const made = await owner().action(api.crm.call, { op: "create_outbound_webhook", body: { name: "n", target_url: "https://hooks.example/x" }, confirm: true });
    expect(made.ok).toBe(true);
    expect(JSON.parse(made.json!)).toEqual({ id: "w2", secret: "whsec_once", signing_secret: "whsec_once", auth_token: "hidden" });
    const rows = await everyRow();
    expect(rows).not.toContain("whsec_once");
  });

  it("F-B13 mock mode: only a loopback ZUOPS_CRM_MOCK_URL counts, and its requests never carry a real key", async () => {
    vi.stubEnv("ZUOPS_CRM_MOCK_URL", "http://evil.example:4777");
    await owner().action(api.crm.call, { op: "list_leads" });
    expect(calls[0].url).toBe("https://api.usezu.com/v1/leads");
    expect(header(0, "Authorization")).toBe("Bearer zu-rw-test");
    expect(await owner().query(api.crm.status, {})).not.toHaveProperty("mock");

    vi.stubEnv("ZUOPS_CRM_MOCK_URL", "http://127.0.0.1:4777");
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "zu-admin-test");
    await owner().action(api.crm.call, { op: "list_leads" });
    expect(calls[1].url).toBe("http://127.0.0.1:4777/v1/leads");
    expect(header(1, "Authorization")).toBe("Bearer zu-mock");
    writesOn();
    await owner().action(api.crm.call, { op: "create_outbound_webhook", body: { name: "n", target_url: "https://hooks.example/x" }, confirm: true });
    expect(header(2, "Authorization")).toBe("Bearer zu-mock");
    expect(await owner().query(api.crm.status, {})).toMatchObject({ mock: true, keyConfigured: true, adminKey: true });

    vi.stubEnv("ZUOPS_CRM_API_KEY", "");
    vi.stubEnv("ZUOPS_CRM_ADMIN_KEY", "");
    await owner().action(api.crm.call, { op: "list_leads" });
    expect(header(3, "Authorization")).toBe("Bearer zu-mock");
    for (const c of calls.slice(1)) expect(JSON.stringify(c.init.headers)).not.toMatch(/zu-rw-test|zu-admin-test/);
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
    expect(Object.keys(pulses[0]).sort()).toEqual(["_creationTime", "_id", "agencyId", "at", "deliveryHeader", "deliveryId", "event", "kind", "leadId", "messageId"]);
    const all = await everyRow();
    expect(all).toContain("l_maya"); // ids are kept
    for (const s of [MAYA.name, "Maya", MAYA.email, "northline", MAYA.phone, "2135550142", BODY_TEXT, "Friday"]) expect(all).not.toContain(s);
  });

  /* ------------------------------ signal ------------------------------ */

  it("F-B10 signal returns the newest time per kind, one indexed read per kind", async () => {
    await t.run(async (ctx) => {
      const kindOf = { lead: "lead", appointment: "booking", message: "message", call: "call", deal: "deal" } as const;
      const ins = (event: string, at: number, deliveryId: string) =>
        ctx.db.insert("crmPulses", { agencyId: PULSE, event, kind: kindOf[event.split(".")[0] as keyof typeof kindOf], deliveryId, at });
      await ins("lead.created", 1_000, "a");
      await ins("lead.updated", 2_000, "b");
      await ins("appointment.booked", 3_000, "c");
      await ins("message.received", 4_000, "d");
      await ins("call.completed", 5_000, "e");
      await ins("deal.updated", 6_000, "f");
      await ctx.db.insert("crmPulses", { agencyId: OTHER, event: "lead.created", kind: "lead", deliveryId: "g", at: 9_000 });
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
    // U-17: the prospects cron only swaps tags and marks do-not-contact; its file has no
    // sending path, never sends the intake flag and never mentions a phone.
    expect(crons.match(/internal\.crmProspects\.\w+/g)).toEqual(["internal.crmProspects.syncStatuses"]);
    const prospects = readFileSync("convex/crmProspects.ts", "utf8");
    for (const needle of ["/v1/messages", "/send", "/enroll", "run_intake", "phone"]) expect(prospects, `crmProspects.ts ${needle}`).not.toContain(needle);
  });
});
