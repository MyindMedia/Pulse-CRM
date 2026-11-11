import { describe, it, expect } from "vitest";
import { ZU_OPS, ZU_OPS_GENERATED_FROM } from "./ops.generated";
import { REACHES, REACHES_PATHS, CHANGES_SENDING, CHANGES_SENDING_PATHS, CONFIRM_REASONS, opIdFor, level, needsConfirm, needsConfirmFor, confirmKind, gate, buildPath, pickFields, BODY_MAX_BYTES } from "./policy";

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

describe("REACHES", () => {
  it("X-06 every listed (method, path) exists in the registry, so a rename fails here", () => {
    for (const [m, p] of REACHES_PATHS) expect(opIdFor(m, p), `${m} ${p}`).toBeTruthy();
    expect(REACHES.size).toBe(REACHES_PATHS.length);
    expect(REACHES.size).toBe(20);
    for (const id of ["send_message", "send_scheduled_message_now", "approve_reply_suggestion", "send_email_campaign", "send_email_campaign_rest", "enroll_automation", "toggle_ws_automation", "react_to_message"]) {
      expect(REACHES.has(id)).toBe(true);
    }
  });

  it("X-06 every CHANGES_SENDING (method, path) exists in the registry, so a rename fails here", () => {
    for (const [m, p] of CHANGES_SENDING_PATHS) expect(opIdFor(m, p), `${m} ${p}`).toBeTruthy();
    expect(CHANGES_SENDING.size).toBe(CHANGES_SENDING_PATHS.length);
    expect([...CHANGES_SENDING].sort()).toEqual([
      "configure_outreach", "create_automation", "duplicate_automation", "invite_member", "set_ai_receptionist", "set_ai_texting",
      "set_appointment_emails", "set_automated_texts_from", "set_nurture", "update_automation", "update_nurture", "update_survey_rules",
    ]);
    for (const id of CHANGES_SENDING) expect(REACHES.has(id)).toBe(false);
  });

  it("needsConfirm: reaching ops, ops that change automatic sending, and every DELETE", () => {
    for (const o of ops) expect(needsConfirm(o)).toBe(REACHES.has(o.id) || CHANGES_SENDING.has(o.id) || o.method === "DELETE");
    expect(needsConfirm(op("list_leads"))).toBe(false);
    expect(needsConfirm(op("delete_lead"))).toBe(true);
  });

  it("confirmKind names why, for the dialog", () => {
    expect(confirmKind(op("send_message"))).toBe("reaches");
    expect(confirmKind(op("set_nurture"))).toBe("changes_sending");
    expect(confirmKind(op("invite_member"))).toBe("changes_sending");
    expect(confirmKind(op("delete_lead"))).toBe("delete");
    expect(confirmKind(op("create_lead"))).toBeNull();
    expect(confirmKind(op("list_leads"))).toBeNull();
    for (const o of ops) expect(needsConfirm(o)).toBe(confirmKind(o) !== null);
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
