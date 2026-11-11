import { describe, it, expect } from "vitest";
import { ZU_OPS, ZU_OPS_GENERATED_FROM } from "./ops.generated";
import { REACHES, REACHES_PATHS, opIdFor, level, needsConfirm, gate, buildPath, pickFields, BODY_MAX_BYTES } from "./policy";

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

  it("needsConfirm: reaching ops and every DELETE", () => {
    for (const o of ops) expect(needsConfirm(o)).toBe(REACHES.has(o.id) || o.method === "DELETE");
    expect(needsConfirm(op("list_leads"))).toBe(false);
    expect(needsConfirm(op("delete_lead"))).toBe(true);
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
    const r = gate(op("send_message"), { writesOn: true, adminKey: false }, false);
    expect(r).toMatchObject({ ok: false, code: "needs_confirm" });
    if (!r.ok) expect(r.reason).toMatch(/reaches real people or deletes something/);
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
  it("caps a body at 64 KB", () => {
    expect(pickFields(create.body, { full_name: "x".repeat(BODY_MAX_BYTES) }, "body").ok).toBe(false);
  });
});
