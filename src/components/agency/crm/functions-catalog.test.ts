import { describe, expect, it } from "vitest";
import { ZU_OPS } from "@convex/crm/ops.generated";
import { CATALOG } from "./crm-op-form-catalog";
import { confirmKind } from "@convex/crm/policy";
import { ALL, KINDS, KIND_LABEL, NO_KIND, areaCounts, catalogStats, filterCatalog, groupByArea, searchCatalog } from "./functions-catalog";

describe("Functions catalog", () => {
  it("holds every registry operation: 352 in 32 areas", () => {
    expect(CATALOG).toHaveLength(Object.keys(ZU_OPS).length);
    const s = catalogStats(CATALOG);
    expect(s.total).toBe(352);
    expect(s.areas).toBe(32);
    expect(s.byLevel.read + s.byLevel.write + s.byLevel.admin).toBe(352);
  });

  it("levels: GET is Read, :admin scope is Full access, the rest Write", () => {
    for (const e of CATALOG) {
      if (e.method === "GET") expect(e.level, e.id).toBe("read");
      else if (e.scope.endsWith(":admin")) expect(e.level, e.id).toBe("admin");
      else expect(e.level, e.id).toBe("write");
    }
  });

  it("markers: every DELETE deletes; sends reach people; follow-up changes are automatic sending", () => {
    for (const e of CATALOG) if (e.method === "DELETE") expect(e.kind, e.id).not.toBeNull();
    const by = (id: string) => CATALOG.find((e) => e.id === id)!;
    expect(by("send_message").kind).toBe("reaches");
    expect(by("set_nurture").kind).toBe("changes_sending");
    expect(by("delete_tag").kind).toBe("delete");
    expect(by("list_leads").kind).toBeNull();
  });

  it("F-B1: every marker comes from the server policy (convex/crm/policy.ts) for an empty body", () => {
    for (const e of CATALOG) expect(e.kind, e.id).toBe(confirmKind(ZU_OPS[e.id]));
    expect(KINDS.map((k) => KIND_LABEL[k])).toEqual(["Reaches people", "Changes automatic sending", "Uses credits", "Sends data outside the account", "Deletes"]);
  });

  it("F-B1: ops whose kind depends on the body are flagged", () => {
    const by = (id: string) => CATALOG.find((e) => e.id === id)!;
    expect(by("create_lead").dependsOnBody).toBe(true);
    expect(by("apply_gbp_optimizer").dependsOnBody).toBe(true);
    expect(by("list_leads").dependsOnBody).toBe(false);
  });

  it("filters by kind, including the ops that never ask first, and the kind counts add up", () => {
    for (const k of KINDS) {
      const hit = filterCatalog(CATALOG, { q: "", area: ALL, level: ALL, kind: k });
      expect(hit.length, k).toBeGreaterThan(0);
      expect(hit.every((e) => e.kind === k)).toBe(true);
    }
    const none = filterCatalog(CATALOG, { q: "", area: ALL, level: ALL, kind: NO_KIND });
    expect(none.every((e) => e.kind === null)).toBe(true);
    expect(none.map((e) => e.id)).toContain("list_leads");
    expect(filterCatalog(CATALOG, { q: "", area: ALL, level: ALL, kind: ALL })).toHaveLength(352);
    const { byKind } = catalogStats(CATALOG);
    // An op that asks first only for some bodies (kind null by default) is never listed as "never asks first".
    const sometimes = CATALOG.filter((e) => e.kind === null && e.dependsOnBody);
    expect(sometimes.map((e) => e.id)).toContain("create_lead");
    expect(none.some((e) => e.dependsOnBody)).toBe(false);
    expect(Object.values(byKind).reduce((a, b) => a + b, 0) + sometimes.length).toBe(352);
    expect(byKind[NO_KIND]).toBe(none.length);
    expect(searchCatalog(CATALOG, "uses credits").every((e) => e.kind === "spends" || /credit/i.test(`${e.summary} ${e.id}`))).toBe(true);
  });

  it("search matches every word over id, summary, path and area", () => {
    expect(searchCatalog(CATALOG, "send message").map((e) => e.id)).toContain("send_message");
    expect(searchCatalog(CATALOG, "/v1/short-links").every((e) => e.path.startsWith("/v1/short-links"))).toBe(true);
    expect(searchCatalog(CATALOG, "reward games").length).toBeGreaterThanOrEqual(10);
    expect(searchCatalog(CATALOG, "delete_tag")).toHaveLength(1);
    expect(searchCatalog(CATALOG, "zzzz nothing")).toHaveLength(0);
    expect(searchCatalog(CATALOG, "  ")).toHaveLength(352);
  });

  it("filters by area and level", () => {
    const admin = filterCatalog(CATALOG, { q: "", area: ALL, level: "admin" });
    expect(admin.length).toBeGreaterThan(0);
    expect(admin.every((e) => e.scope.endsWith(":admin"))).toBe(true);
    const calls = filterCatalog(CATALOG, { q: "", area: "Calls", level: ALL });
    expect(calls.map((e) => e.id).sort()).toEqual(["get_call", "list_call_campaigns", "list_calls", "pause_call_campaign"]);
    expect(filterCatalog(CATALOG, { q: "pause", area: "Calls", level: "write" }).map((e) => e.id)).toEqual(["pause_call_campaign"]);
  });

  it("groups by area with counts that add up", () => {
    const groups = groupByArea(CATALOG);
    expect(groups).toHaveLength(32);
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(352);
    expect(groups.map((g) => g.area)).toEqual([...groups.map((g) => g.area)].sort((a, b) => a.localeCompare(b)));
    const counts = areaCounts(CATALOG);
    for (const g of groups) expect(counts[g.area]).toBe(g.entries.length);
    expect(counts["Ads & Google"]).toBe(55);
  });
});
