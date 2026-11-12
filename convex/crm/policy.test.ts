import { describe, it, expect } from "vitest";
import { ZU_OPS, ZU_OPS_GENERATED_FROM } from "./ops.generated";
import { CLASSIFIED, BODY_RULES, CONFIRM_REASONS, opIdFor, level, needsConfirm, needsConfirmFor, confirmKind, sendKind, gate, buildPath, pickFields, BODY_MAX_BYTES } from "./policy";

const ops = Object.values(ZU_OPS);
const op = (id: string) => {
  const o = ZU_OPS[id];
  if (!o) throw new Error(`no op ${id}`);
  return o;
};

describe("registry", () => {
  it("S-03 holds all 352 operations, each with method, path, area, summary and scope", () => {
    expect(ops).toHaveLength(352);
    expect(ZU_OPS_GENERATED_FROM.count).toBe(352);
    for (const o of ops) {
      expect(o.id).toBeTruthy();
      expect(["GET", "POST", "PUT", "PATCH", "DELETE"]).toContain(o.method);
      expect(o.path.startsWith("/v1/")).toBe(true);
      expect(o.area).toBeTruthy();
      expect(o.summary).toBeTruthy();
      expect(o.scope).toMatch(/^[a-z_]+:(read|write|admin)$/);
      expect(o.pathParams).toEqual([...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
    }
  });

  it("A-06 never carries a workspace_id query or body field", () => {
    for (const o of ops) {
      expect(o.query.map((f) => f.name)).not.toContain("workspace_id");
      expect(o.body.map((f) => f.name)).not.toContain("workspace_id");
    }
  });
});

describe("F-B1 classification of every write", () => {
  const writes = ops.filter((o) => o.method !== "GET");

  it("F-B1 (a) every non-GET registry operation is classified", () => {
    const missing = writes.filter((o) => !Object.prototype.hasOwnProperty.call(CLASSIFIED, o.id)).map((o) => o.id);
    expect(missing).toEqual([]);
    expect(Object.keys(CLASSIFIED)).toHaveLength(writes.length);
  });

  it("F-B1 (b) the map names no operation outside the registry, and no read", () => {
    for (const id of Object.keys(CLASSIFIED)) {
      expect(ZU_OPS[id], id).toBeDefined();
      expect(ZU_OPS[id].method, id).not.toBe("GET");
    }
    for (const id of Object.keys(BODY_RULES)) expect(CLASSIFIED[id], id).toBeDefined();
  });

  it("F-B1 (c) each entry's METHOD /path still matches the registry", () => {
    for (const [id, [route]] of Object.entries(CLASSIFIED)) expect(route, id).toBe(`${ZU_OPS[id].method} ${ZU_OPS[id].path}`);
    for (const [id, [route]] of Object.entries(CLASSIFIED)) expect(opIdFor(...(route.split(" ") as [string, string])), id).toBe(id);
  });

  it("F-B1 a body-rule op records its empty-body kind in the map", () => {
    for (const [id, rule] of Object.entries(BODY_RULES)) expect(rule({}), id).toBe(CLASSIFIED[id][1]);
  });

  it("F-B1 required minimum kinds", () => {
    const kindOf = (id: string) => CLASSIFIED[id][1];
    for (const id of ["send_message", "send_scheduled_message_now", "approve_reply_suggestion", "send_email_campaign", "send_email_campaign_rest", "enroll_automation", "toggle_ws_automation", "send_estimate", "send_contract", "send_proposal", "send_report", "send_gbp_report_test", "send_reward_game", "send_survey", "approve_gbp_post", "publish_gbp_post", "reply_gbp_review", "add_support_message", "reply_support_ticket", "react_to_message"]) expect(kindOf(id), id).toBe("reaches");
    for (const id of ["set_nurture", "update_nurture", "set_ai_texting", "set_ai_receptionist", "set_appointment_emails", "update_survey_rules", "configure_outreach", "set_automated_texts_from", "create_automation", "update_automation", "duplicate_automation", "create_calendar", "update_calendar", "create_offer", "update_offer", "update_imessage_line", "update_website_widget", "save_report_schedule", "save_report_alert", "set_gbp_report_settings"]) expect(kindOf(id), id).toBe("changes_sending");
    for (const id of ["create_outbound_webhook", "update_outbound_webhook", "create_alert_recipient", "update_alert_recipient", "invite_member", "update_member_role", "share_report", "make_gbp_connect_link"]) expect(kindOf(id), id).toBe("exposes");
    for (const id of ["start_listings", "scan_listings", "start_rank_scan", "create_rank_keyword", "setup_ai_visibility", "start_ai_visibility_check", "write_ai_visibility_questions", "ask_website_analytics", "generate_calendar_design", "generate_menu_design", "write_gbp_posts", "draft_gbp_reply", "write_gbp_embed_faq", "refresh_gbp_embed_facts", "try_reward_game", "apply_gbp_optimizer"]) expect(kindOf(id), id).toBe("spends");
    for (const id of ["create_lead_source", "create_booking", "reschedule_booking", "cancel_booking", "update_lead", "set_lead_stage", "create_lead_note", "archive_conversation", "mark_conversation_read", "unenroll_automation", "dismiss_reply_suggestion"]) expect(kindOf(id), id).toBe("safe");
  });

  it("F-B1 body rules read the body; on means anything but absent, null or false", () => {
    const k = (id: string, body?: unknown) => confirmKind(op(id), body);
    expect(k("create_gbp_post", { body: "x" })).toBeNull();
    expect(k("create_gbp_post", { body: "x", approve: true })).toBe("reaches");
    expect(k("create_gbp_post", { approve: "yes" })).toBe("reaches");
    expect(k("update_scheduled_message", { status: "cancelled" })).toBeNull();
    expect(k("update_scheduled_message", { status: "cancelled", body: "x" })).toBe("changes_sending");
    expect(k("update_scheduled_message", { status: "pending" })).toBe("changes_sending");
    expect(k("update_scheduled_message")).toBe("changes_sending");
    expect(k("set_lead_ai_pause", { paused: true })).toBeNull();
    expect(k("set_lead_ai_pause", { paused: false })).toBe("changes_sending");
    expect(k("set_lead_ai_pause", { paused: "true" })).toBe("changes_sending");
    expect(k("update_booking", { notes: "x" })).toBeNull();
    expect(k("update_booking", { notify_lead: true })).toBe("changes_sending");
    expect(k("update_booking", { status: "confirmed" })).toBe("changes_sending");
    expect(k("update_booking", { status: "no_show" })).toBeNull();
    expect(k("move_dm_leads", {})).toBeNull();
    expect(k("move_dm_leads", { apply: true })).toBe("changes_sending");
    expect(k("apply_gbp_optimizer", { dry_run: true })).toBeNull();
    expect(k("apply_gbp_optimizer", { dry_run: "true" })).toBe("spends");
    expect(k("apply_gbp_optimizer", {})).toBe("spends");
    expect(k("create_email_campaign", { name: "x" })).toBeNull();
    expect(k("create_email_campaign", { brief: "a spring promo" })).toBe("spends");
    expect(k("update_report", { name: "x" })).toBeNull();
    expect(k("update_report", { prompt: "email it monthly" })).toBe("changes_sending");
    expect(k("update_reward_game", { status: "live" })).toBe("changes_sending");
    expect(k("update_smart_form", { is_published: true })).toBe("changes_sending");
    expect(k("create_proposal", { build: { brief: "x" } })).toBe("spends");
  });

  it("F-B1 an unclassified or moved write fails closed as reaching people", () => {
    const ghost = { ...op("update_lead"), id: "brand_new_write" };
    expect(sendKind(ghost)).toBe("reaches");
    const moved = { ...op("update_lead"), path: "/v1/leads/{lead_id}/v2" };
    expect(confirmKind(moved)).toBe("reaches");
    expect(confirmKind(op("list_leads"))).toBeNull();
  });

  it("needsConfirm: every non-safe kind and every DELETE", () => {
    for (const o of ops) expect(needsConfirm(o), o.id).toBe(o.method !== "GET" && (sendKind(o) !== "safe" || o.method === "DELETE"));
    expect(needsConfirm(op("list_leads"))).toBe(false);
    expect(needsConfirm(op("delete_lead"))).toBe(true);
    for (const o of ops) expect(needsConfirm(o)).toBe(confirmKind(o) !== null);
  });

  it("confirmKind names why, for the dialog", () => {
    expect(confirmKind(op("send_message"))).toBe("reaches");
    expect(confirmKind(op("set_nurture"))).toBe("changes_sending");
    expect(confirmKind(op("invite_member"))).toBe("exposes");
    expect(confirmKind(op("start_listings"))).toBe("spends");
    expect(confirmKind(op("delete_lead"))).toBe("delete");
    expect(confirmKind(op("create_lead"))).toBeNull();
    expect(confirmKind(op("list_leads"))).toBeNull();
  });

  it("X-06 create_lead needs confirm only when run_intake would start the new-lead texts", () => {
    const create = op("create_lead");
    expect(needsConfirmFor(create, { full_name: "x" })).toBe(false);
    expect(needsConfirmFor(create, undefined)).toBe(false);
    expect(needsConfirmFor(create, { full_name: "x", run_intake: false })).toBe(false);
    expect(needsConfirmFor(create, { full_name: "x", run_intake: true })).toBe(true);
    expect(needsConfirmFor(create, { full_name: "x", run_intake: "true" })).toBe(true);
    expect(needsConfirmFor(op("update_lead"), { run_intake: true })).toBe(false);
    const flags = { writesOn: true, adminKey: false };
    expect(gate(create, flags, false, { full_name: "x", run_intake: true })).toEqual({ ok: false, code: "needs_confirm", reason: "Confirm before this runs: it starts the new-lead texts for this person." });
    expect(gate(create, flags, true, { full_name: "x", run_intake: true })).toEqual({ ok: true });
    expect(gate(create, flags, false, { full_name: "x" })).toEqual({ ok: true });
  });
});

describe("level and gate", () => {
  it("GET is read, :admin scope is admin, everything else write", () => {
    expect(level(op("list_leads"))).toBe("read");
    expect(level(op("delete_lead"))).toBe("admin");
    expect(level(op("create_lead"))).toBe("write");
    for (const o of ops) if (o.method === "GET") expect(level(o)).toBe("read");
  });

  it("X-01 writes refuse when the switch is off, reads pass", () => {
    expect(gate(op("list_leads"), { writesOn: false, adminKey: false }, false)).toEqual({ ok: true });
    expect(gate(op("create_lead"), { writesOn: false, adminKey: true }, true)).toMatchObject({ ok: false, code: "read_only", reason: "This deployment is read only against Zuops." });
  });

  it("X-08 admin ops need the Full access key", () => {
    expect(gate(op("delete_lead"), { writesOn: true, adminKey: false }, true)).toMatchObject({ ok: false, code: "needs_admin_key", reason: "Needs a Full access key." });
    expect(gate(op("delete_lead"), { writesOn: true, adminKey: true }, true)).toEqual({ ok: true });
  });

  it("X-06 reaching ops need confirm", () => {
    expect(gate(op("send_message"), { writesOn: true, adminKey: false }, false)).toEqual({ ok: false, code: "needs_confirm", reason: CONFIRM_REASONS.reaches });
    expect(gate(op("start_listings"), { writesOn: true, adminKey: false }, false)).toEqual({ ok: false, code: "needs_confirm", reason: "Confirm before this runs: it uses credits or starts paid work." });
    expect(gate(op("create_alert_recipient"), { writesOn: true, adminKey: true }, false)).toEqual({ ok: false, code: "needs_confirm", reason: "Confirm before this runs: it sends lead data outside the account or changes who can access it." });
    expect(gate(op("set_ai_texting"), { writesOn: true, adminKey: false }, false)).toEqual({ ok: false, code: "needs_confirm", reason: "Confirm before this runs: it changes what is sent automatically to real people." });
    expect(gate(op("delete_lead"), { writesOn: true, adminKey: true }, false)).toEqual({ ok: false, code: "needs_confirm", reason: "Confirm before this runs: it deletes something." });
    expect(gate(op("send_message"), { writesOn: true, adminKey: false }, true)).toEqual({ ok: true });
  });
});

describe("buildPath", () => {
  const getLead = op("get_lead");
  it("substitutes and encodes", () => {
    expect(buildPath(getLead, { lead_id: "3f9a-11" })).toEqual({ ok: true, path: "/v1/leads/3f9a-11" });
    expect(buildPath(getLead, { lead_id: "a:b@c" })).toEqual({ ok: true, path: "/v1/leads/a%3Ab%40c" });
    expect(buildPath(op("list_leads"), undefined)).toEqual({ ok: true, path: "/v1/leads" });
  });
  it("S-04 refuses missing, unknown, traversal and slash values", () => {
    for (const v of ["", ".", "..", "../x", "a/b", "a b", "a?b", "a#b", "%2e%2e", "x".repeat(129)]) {
      expect(buildPath(getLead, { lead_id: v }).ok, v).toBe(false);
    }
    expect(buildPath(getLead, {}).ok).toBe(false);
    expect(buildPath(getLead, { lead_id: "a", other: "b" }).ok).toBe(false);
  });
});

describe("pickFields", () => {
  const create = op("create_lead");
  it("S-04 refuses an unknown key and names it", () => {
    const r = pickFields(create.body, { full_name: "x", is_admin: true }, "body");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.reason).toContain("is_admin");
  });
  it("A-06 drops workspace_id silently", () => {
    expect(pickFields(create.body, { full_name: "x", workspace_id: "w" }, "body")).toEqual({ ok: true, value: { full_name: "x" } });
    expect(pickFields(op("list_leads").query, { limit: 5, workspace_id: "w" }, "query")).toEqual({ ok: true, value: { limit: 5 } });
  });
  it("does not refuse a missing required field (Zuops's 400 explains it better)", () => {
    expect(pickFields(op("send_message").body, { lead_id: "l1" }, "body").ok).toBe(true);
  });
  it("query values must be scalars; input must be a plain object", () => {
    expect(pickFields(op("list_leads").query, { limit: [1] }, "query").ok).toBe(false);
    expect(pickFields(op("list_leads").query, { limit: Number.NaN }, "query").ok).toBe(false);
    expect(pickFields(create.body, ["full_name"], "body").ok).toBe(false);
    expect(pickFields(create.body, "x", "body").ok).toBe(false);
    expect(pickFields(create.body, undefined, "body")).toEqual({ ok: true, value: {} });
  });
  it("openBody: field-less PATCH and PUT and every DELETE are open; POST stays strict; suggest is advisory", () => {
    for (const o of ops) {
      const open = o.method === "DELETE" || ((o.method === "PATCH" || o.method === "PUT") && o.body.length === 0);
      expect(o.openBody === true, o.id).toBe(open);
      if (o.suggest) {
        expect(o.openBody, o.id).toBe(true);
        expect(o.suggest.some((f) => f.required), o.id).toBe(false);
      }
    }
    expect(op("update_stage").suggest!.map((f) => f.name)).toEqual(expect.arrayContaining(["label", "color"]));
    expect(op("archive_conversation").openBody).toBeUndefined(); // a field-less POST is a pure action: strict
  });

  it("openBody accepts documented-in-prose keys, drops workspace_id at any depth, refuses odd key names", () => {
    const stage = op("update_stage");
    expect(pickFields(stage.body, { label: "Quoted", color: "amber", hidden: false }, "body", true)).toEqual({ ok: true, value: { label: "Quoted", color: "amber", hidden: false } });
    expect(pickFields(stage.body, { label: "x", workspace_id: "w", meta: { workspace_id: "w", keep: [{ workspace_id: "w", a: 1 }] } }, "body", true)).toEqual({
      ok: true, value: { label: "x", meta: { keep: [{ a: 1 }] } },
    });
    for (const bad of ["la bel", "a.b", "__proto__x-", "x".repeat(65), ""]) expect(pickFields(stage.body, { [bad]: 1 }, "body", true).ok, bad).toBe(false);
    expect(pickFields(stage.body, ["label"], "body", true).ok).toBe(false);
    expect(pickFields(stage.body, { label: "x".repeat(BODY_MAX_BYTES) }, "body", true).ok).toBe(false);
    // Without the open flag the same op is strict, and queries are always strict.
    expect(pickFields(stage.body, { label: "x" }, "body").ok).toBe(false);
    expect(pickFields([], { label: "x" }, "query", true).ok).toBe(false);
  });

  it("caps a body at 64 KB", () => {
    expect(pickFields(create.body, { full_name: "x".repeat(BODY_MAX_BYTES) }, "body").ok).toBe(false);
  });
});
