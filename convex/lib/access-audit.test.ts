import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "../schema";
import { api } from "../_generated/api";

describe("access engine - audit log", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("logs an allow row when an owner refunds", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "O", role: "owner", clerkUserId: "u_o", skills: [] });
    });
    const owner = t.withIdentity({ subject: "u_o", name: "O", orgId: "org_a" });
    await owner.mutation(api.testHarness.require_, { cap: "finance.refund", orgId: "org_a" });
    const events = await t.run(async (ctx) =>
      await ctx.db.query("auditEvents").collect(),
    );
    const refundEvents = events.filter((e) => e.action === "finance.refund");
    expect(refundEvents.length).toBe(1);
    expect(refundEvents[0].result).toBe("allow");
  });

  it("logs a deny row when an engineer attempts to delete a song", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "E", role: "engineer", clerkUserId: "u_e", skills: [] });
    });
    const eng = t.withIdentity({ subject: "u_e", name: "E", orgId: "org_a" });
    await eng.mutation(api.testHarness.require_, { cap: "songs.delete", orgId: "org_a" });
    const events = await t.run(async (ctx) =>
      await ctx.db.query("auditEvents").collect(),
    );
    const deleteEvents = events.filter((e) => e.action === "songs.delete");
    expect(deleteEvents.length).toBe(1);
    expect(deleteEvents[0].result).toBe("deny");
    expect(deleteEvents[0].reason).toBe("missing capability");
  });

  it("does NOT log read actions (not sensitive)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
      await ctx.db.insert("members", { orgId: "org_a", name: "I", role: "intern", clerkUserId: "u_i", skills: [] });
    });
    const intern = t.withIdentity({ subject: "u_i", name: "I", orgId: "org_a" });
    await intern.mutation(api.testHarness.require_, { cap: "songs.read", orgId: "org_a" });
    const events = await t.run(async (ctx) =>
      await ctx.db.query("auditEvents").collect(),
    );
    expect(events.length).toBe(0);
  });
});
