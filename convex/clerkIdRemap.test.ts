import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

const MAP = {
  org_devAAA: "org_prodAAA",
  user_devXXX: "user_prodXXX",
};

describe("clerk id remap (dev -> production instance)", () => {
  it("swaps org ids, user ids, and nested strings across tables", async () => {
    const t = convexTest(schema);
    const ids = await t.run(async (ctx) => {
      const org = await ctx.db.insert("orgs", {
        orgId: "org_devAAA", name: "Studio", slug: "studio", plan: "studio", status: "active",
      });
      const member = await ctx.db.insert("members", {
        orgId: "org_devAAA", name: "Eng", role: "engineer", clerkUserId: "user_devXXX", skills: [],
      });
      const activity = await ctx.db.insert("activity", {
        orgId: "org_devAAA", kind: "booking.created", summary: "x",
        entityType: "session", entityId: "whatever", accent: "gold",
      });
      const untouched = await ctx.db.insert("orgs", {
        orgId: "org_other", name: "Other", slug: "other", plan: "studio", status: "active",
      });
      return { org, member, activity, untouched };
    });

    const summary = await t.action(internal.clerkIdRemap.run, { map: MAP });
    expect(summary.orgs).toBe(1);
    expect(summary.members).toBe(1);
    expect(summary.activity).toBe(1);

    await t.run(async (ctx) => {
      expect((await ctx.db.get(ids.org))!.orgId).toBe("org_prodAAA");
      const m = await ctx.db.get(ids.member);
      expect(m!.orgId).toBe("org_prodAAA");
      expect(m!.clerkUserId).toBe("user_prodXXX");
      expect((await ctx.db.get(ids.activity))!.orgId).toBe("org_prodAAA");
      // non-mapped rows untouched
      expect((await ctx.db.get(ids.untouched))!.orgId).toBe("org_other");
    });
  });

  it("is idempotent - second run changes nothing", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_devAAA", name: "S", slug: "s", plan: "studio", status: "active" });
    });
    await t.action(internal.clerkIdRemap.run, { map: MAP });
    const second = await t.action(internal.clerkIdRemap.run, { map: MAP });
    expect(Object.keys(second).length).toBe(0);
  });
});
