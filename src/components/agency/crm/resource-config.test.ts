import { describe, expect, it } from "vitest";
import { ZU_OPS } from "@convex/crm/ops.generated";
import { BODY_RULES, confirmKind } from "@convex/crm/policy";
import { CURATED_AREAS, RESOURCES, type ActionDef, type FieldDef, type ResourceDef } from "./resource-config";
import { actionPlan } from "./resource-action";
import { kindFor } from "./crm-op-form-kind";

/* The resource config against the registry (tests may import it; the screens may
   not). Every op exists, every field is one the op takes, every operation the
   server gates behind a confirm has a confirm block, every :admin op is marked
   admin, and every registry area is reachable from a screen. */

const all: ResourceDef[] = Object.values(RESOURCES).flat();
const actions: Array<{ res: ResourceDef; a: ActionDef }> = all.flatMap((res) => (res.actions ?? []).map((a) => ({ res, a })));
/** Bodies an action can send: nothing, its fields all turned on, and all turned
 *  off (a step-down rule such as dry_run needs the exact value). */
function bodies(a: ActionDef): Array<Record<string, unknown>> {
  const fill = (f: FieldDef, on: boolean): unknown => {
    if (f.type === "boolean") return on;
    if (f.type === "number") return on ? 1 : 0;
    if (f.list) return ["x"];
    if (f.type === "json") return f.jsonShape === "array" ? [{}] : {};
    if (f.type === "select") return f.options?.[0] ?? "x";
    return "x";
  };
  const make = (on: boolean) => ({
    ...Object.fromEntries((a.fields ?? []).filter((f) => (f.in ?? "body") === "body").map((f) => [f.name, fill(f, on)])),
    ...(a.body ?? {}),
  });
  return [{ ...(a.body ?? {}) }, make(true), make(false)];
}

const opsOf = (res: ResourceDef): string[] =>
  [res.list?.op, res.single?.op, res.detail?.op, ...(res.actions ?? []).map((a) => a.op)].filter((x): x is string => !!x);

describe("resource config", () => {
  it("has unique keys and a blurb on every resource", () => {
    const keys = all.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of all) {
      expect(r.blurb.length, r.key).toBeGreaterThan(10);
      expect(!!r.list !== !!r.single, `${r.key}: exactly one of list or single`).toBe(true);
      expect(r.blurb, r.key).not.toMatch(/—/);
    }
  });

  it("every operation id exists in the registry", () => {
    const missing = all.flatMap(opsOf).filter((id) => !ZU_OPS[id]);
    expect(missing).toEqual([]);
  });

  it("lists, singles and details are reads", () => {
    for (const r of all) {
      for (const id of [r.list?.op, r.single?.op, r.detail?.op]) if (id) expect(ZU_OPS[id].method, `${r.key} ${id}`).toBe("GET");
    }
  });

  it("F-B1: every action whose operation the server can gate has its own confirm wording (policy.ts is the source of truth)", () => {
    const missing = actions
      .filter(({ a }) => ZU_OPS[a.op].method !== "GET" && bodies(a).some((b) => confirmKind(ZU_OPS[a.op], b) !== null) && !a.confirm)
      .map(({ res, a }) => `${res.key}: ${a.label} (${a.op})`);
    expect(missing).toEqual([]);
  });

  it("F-B1: no action can run an operation with a confirm kind outside ConfirmDialog, for any body it can send", () => {
    const leaks: string[] = [];
    for (const { res, a } of actions) {
      const isRead = ZU_OPS[a.op].method === "GET";
      for (const b of bodies(a)) {
        const kind = kindFor(a.op, b);
        expect(kind, `${a.op} kind from the lazy module matches policy`).toBe(confirmKind(ZU_OPS[a.op], b));
        if (kind !== null && actionPlan(a, kind, isRead) !== "confirm") leaks.push(`${res.key}: ${a.label} ${JSON.stringify(b)}`);
      }
      // A kind that could not be looked up fails closed.
      if (!isRead) expect(actionPlan(a, undefined, false), a.op).toBe("confirm");
    }
    expect(leaks).toEqual([]);
  });

  it("F-B1: body-dependent kinds are decided by the body (an apply flag confirms, a preview does not)", () => {
    expect(kindFor("apply_gbp_optimizer", { dry_run: true })).toBeNull();
    expect(kindFor("apply_gbp_optimizer", {})).toBe("spends");
    expect(kindFor("create_email_campaign", { name: "Fall" })).toBeNull();
    expect(kindFor("create_email_campaign", { brief: "Fall tune-up" })).toBe("spends");
    expect(kindFor("create_outbound_webhook", { name: "Zap" })).toBe("exposes");
    expect(kindFor("no_such_op", {})).toBe("reaches");
    for (const id of Object.keys(BODY_RULES)) expect(ZU_OPS[id], id).toBeDefined();
  });

  it("confirm templates only name values the dialog has", () => {
    const wrong: string[] = [];
    for (const { res, a } of actions) {
      if (!a.confirm) continue;
      const known = new Set(["count", "name", "email_audience", ...(a.fields ?? []).map((f) => f.name)]);
      for (const m of `${a.confirm.title} ${a.confirm.body}`.matchAll(/\{([a-z_]+)\}/g)) if (!known.has(m[1])) wrong.push(`${res.key}: ${a.label} {${m[1]}}`);
    }
    expect(wrong).toEqual([]);
  });

  it("every :admin operation is marked admin, and only those", () => {
    const wrong = actions
      .filter(({ a }) => ZU_OPS[a.op].scope.endsWith(":admin") !== !!a.admin)
      .map(({ res, a }) => `${res.key}: ${a.label} (${a.op})`);
    expect(wrong).toEqual([]);
  });

  it("row path params are the op's path params; panel actions fill theirs from a path field", () => {
    for (const { res, a } of actions) {
      const op = ZU_OPS[a.op];
      const fromFields = (a.fields ?? []).filter((f) => f.in === "path").map((f) => f.name);
      const filled = [...(a.pathParam ? [a.pathParam] : []), ...fromFields].sort();
      expect(filled, `${res.key}: ${a.label}`).toEqual([...op.pathParams].sort());
      if (a.scope === "panel") expect(a.pathParam, `${res.key}: ${a.label}`).toBeUndefined();
    }
    for (const r of all) if (r.detail) expect(ZU_OPS[r.detail.op].pathParams, r.key).toEqual([r.detail.pathParam]);
  });

  it("every field is one the operation takes", () => {
    const wrong: string[] = [];
    for (const { res, a } of actions) {
      const op = ZU_OPS[a.op];
      const bodyNames = new Set([...op.body, ...(op.suggest ?? [])].map((f) => f.name));
      const queryNames = new Set(op.query.map((f) => f.name));
      const check = (name: string, where: string) => {
        const ok = where === "query" ? queryNames.has(name) : where === "path" ? op.pathParams.includes(name) : op.openBody || bodyNames.has(name);
        if (!ok) wrong.push(`${res.key}: ${a.label} ${where}.${name}`);
      };
      for (const f of a.fields ?? []) check(f.name, f.in ?? "body");
      for (const k of Object.keys(a.body ?? {})) check(k, "body");
      for (const rb of a.rowBody ?? []) check(rb.field, "body");
    }
    for (const r of all) {
      const q = { ...(r.list?.query ?? {}), ...(r.single?.query ?? {}) };
      const op = ZU_OPS[(r.list ?? r.single)!.op];
      const names = new Set(op.query.map((f) => f.name));
      for (const k of Object.keys(q)) if (!names.has(k)) wrong.push(`${r.key}: query.${k}`);
      for (const f of r.list?.filters ?? []) if (!names.has(f.param)) wrong.push(`${r.key}: filter ${f.param}`);
      if (r.list?.search && !names.has(r.list.search)) wrong.push(`${r.key}: search ${r.list.search}`);
      if (r.list?.paging === "cursor" && !names.has("cursor")) wrong.push(`${r.key}: cursor paging without a cursor param`);
      if (r.list?.paging === "offset" && !names.has("offset")) wrong.push(`${r.key}: offset paging without an offset param`);
    }
    expect(wrong).toEqual([]);
  });

  it("select fields carry their options, and enums match the registry", () => {
    for (const { res, a } of actions) {
      const op = ZU_OPS[a.op];
      for (const f of a.fields ?? []) {
        if (f.type === "select") expect(f.options?.length, `${res.key} ${f.name}`).toBeGreaterThan(0);
        const reg = [...op.body, ...(op.suggest ?? []), ...op.query].find((x) => x.name === f.name);
        if (reg?.enum && f.options) for (const o of f.options) expect(reg.enum, `${res.key} ${a.op} ${f.name}`).toContain(o);
      }
    }
  });

  it("writes only through actions; GET actions show their answer", () => {
    for (const { res, a } of actions) {
      if (ZU_OPS[a.op].method === "GET") expect(a.showResult, `${res.key}: ${a.label}`).toBe(true);
    }
  });

  it("confirm texts are plain sentences with no em dash", () => {
    for (const { a } of actions) {
      if (!a.confirm) continue;
      expect(a.confirm.body).not.toMatch(/—/);
      expect(a.confirm.title).not.toMatch(/—/);
      if (a.confirm.count) {
        const field = a.confirm.count.field;
        expect((a.fields ?? []).find((f) => f.name === field)?.list, `${a.op} count field`).toBe(true);
      }
    }
  });

  it("covers every one of the registry's areas, with the curated tabs", () => {
    const areas = new Set(Object.values(ZU_OPS).map((o) => o.area));
    expect(areas.size).toBe(32);
    const reached = new Map<string, string[]>();
    for (const r of all) for (const id of opsOf(r)) {
      const a = ZU_OPS[id].area;
      reached.set(a, [...new Set([...(reached.get(a) ?? []), r.title])]);
    }
    for (const a of CURATED_AREAS) reached.set(a, [...(reached.get(a) ?? []), "curated tab"]);
    const unreached = [...areas].filter((a) => !reached.has(a));
    expect(unreached).toEqual([]);
    expect([...reached.keys()].filter((a) => !areas.has(a))).toEqual([]);
  });
});
