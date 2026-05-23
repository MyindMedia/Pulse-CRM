import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

describe("ops backbone fan-out", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("listActiveOrgIds returns active, non-demo orgs only", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org_b", name: "B", slug: "b", plan: "studio", status: "paused" });
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
    const ids = await t.query(internal.orgs.listActiveOrgIds, {});
    expect(ids).toEqual(["org_a"]);
  });

  it("scanAllOrgs schedules a per-org scan for each active subaccount", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "org_b", name: "B", slug: "b", plan: "studio", status: "active" });
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
    const res = await t.mutation(internal.opsBrain.scanAllOrgs, {});
    expect(res).toEqual({ scheduled: 2 });
  });
});
