import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { provisionOnOrgInsert } from "./lib/orgBucketTrigger";

/* A new studio gets its own R2 buckets automatically, whichever path created it. */

afterEach(() => vi.unstubAllEnvs());

async function newStudio(t: ReturnType<typeof convexTest>, orgId: string) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, status: "active" } as never);
    const org = (await ctx.db.get(id))!;
    await provisionOnOrgInsert(ctx as never, { operation: "insert", newDoc: org });
    const after = (await ctx.db.get(id))!;
    const scheduled = await ctx.db.system.query("_scheduled_functions").collect();
    return { status: after.r2BucketStatus, scheduled: scheduled.length };
  });
}

describe("per-studio buckets are created when a studio is created", () => {
  it("a new studio is marked pending and provisioning is scheduled", async () => {
    vi.stubEnv("R2_PER_ORG_BUCKETS", "1");
    const r = await newStudio(convexTest(schema), "new-studio");
    expect(r.status).toBe("pending");
    expect(r.scheduled).toBe(1);
  });

  it("does nothing on update or delete", async () => {
    vi.stubEnv("R2_PER_ORG_BUCKETS", "1");
    const t = convexTest(schema);
    const out = await t.run(async (ctx) => {
      const id = await ctx.db.insert("orgs", { orgId: "s", name: "s", slug: "s", status: "active" } as never);
      const org = (await ctx.db.get(id))!;
      await provisionOnOrgInsert(ctx as never, { operation: "update", newDoc: org });
      await provisionOnOrgInsert(ctx as never, { operation: "delete", newDoc: null });
      return (await ctx.db.system.query("_scheduled_functions").collect()).length;
    });
    expect(out).toBe(0);
  });

  it("does nothing while per-studio buckets are switched off", async () => {
    const r = await newStudio(convexTest(schema), "off-studio");
    expect(r.status).toBeUndefined();
    expect(r.scheduled).toBe(0);
  });

  it("is registered as a trigger on the orgs table, and the hourly sweep is on the cron list", () => {
    expect(readFileSync("convex/functions.ts", "utf8")).toMatch(/triggers\.register\("orgs"[\s\S]*provisionOnOrgInsert/);
    expect(readFileSync("convex/crons.ts", "utf8")).toMatch(/org-buckets-sweep[\s\S]*orgBuckets\.sweepNewOrgs/);
  });

  it("fires through a real mutation that creates a studio (orgs.update on a new workspace)", async () => {
    vi.stubEnv("R2_PER_ORG_BUCKETS", "1");
    const t = convexTest(schema);
    await t.run((ctx) => ctx.db.insert("members", { orgId: "fresh-studio", name: "Owner", role: "owner", skills: [], clerkUserId: "u_new", email: "o@x.com" } as never));
    const as = t.withIdentity({ subject: "u_new", name: "Owner", orgId: "fresh-studio" });
    await as.mutation(api.orgs.update, { name: "Fresh Studio" } as never);
    const org = await t.run((ctx) => ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "fresh-studio")).first());
    expect(org?.r2BucketStatus).toBe("pending");
  });
});
