import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { assertWithinLimit, meterStorageUpload, recordUsage } from "./usage";
import { PLAN_LIMITS } from "./lib/plans";

/* Plan-cap enforcement: assertWithinLimit (AI credits, magic links) and
   meterStorageUpload (storage GB) hard-block once a studio-tier org is at cap. */

const DEMO = "pulse-demo";
const BYTES_PER_GB = 1024 * 1024 * 1024;

async function seedStudioOrg(t: ReturnType<typeof convexTest>) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: DEMO,
      name: "Demo",
      slug: "demo",
      plan: "studio",
      status: "active",
      tier: "studio",
    });
  });
}

describe("plan-cap enforcement", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema);
    await seedStudioOrg(t);
  });

  it("allows AI credits under the cap and throws at the cap", async () => {
    const cap = PLAN_LIMITS.studio.aiCreditsPerMonth; // 100
    await t.run((ctx) => recordUsage(ctx, DEMO, "ai_credits", cap - 1));
    // One more is fine (99 + 1 = 100, not over).
    await t.run((ctx) => assertWithinLimit(ctx, DEMO, "ai_credits", 1));
    await t.run((ctx) => recordUsage(ctx, DEMO, "ai_credits", 1)); // now at 100
    // The next one would exceed -> throw.
    await expect(
      t.run((ctx) => assertWithinLimit(ctx, DEMO, "ai_credits", 1)),
    ).rejects.toThrow();
  });

  it("throws at the magic-link grant cap", async () => {
    const cap = PLAN_LIMITS.studio.magicLinkGrantsPerMonth; // 5
    await t.run((ctx) => recordUsage(ctx, DEMO, "magic_links", cap));
    await expect(
      t.run((ctx) => assertWithinLimit(ctx, DEMO, "magic_links", 1)),
    ).rejects.toThrow();
  });

  it("meterStorageUpload records bytes under cap, blocks + deletes over cap", async () => {
    // Under cap: a tiny file is recorded.
    const okId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["hello"], { type: "text/plain" })),
    );
    await t.run((ctx) => meterStorageUpload(ctx, DEMO, okId));
    const used = await t.run(async (ctx) => {
      const row = (await ctx.db.query("usageCounters").collect()).find(
        (r) => r.orgId === DEMO && r.metric === "storage_bytes",
      );
      return row?.value ?? 0;
    });
    expect(used).toBeGreaterThan(0);

    // Pre-fill near the 5 GB cap, then a new upload should be rejected + deleted.
    await t.run((ctx) =>
      recordUsage(ctx, DEMO, "storage_bytes", 5 * BYTES_PER_GB),
    );
    const overId = await t.run((ctx) =>
      ctx.storage.store(new Blob(["x".repeat(1024)], { type: "text/plain" })),
    );
    await expect(
      t.run((ctx) => meterStorageUpload(ctx, DEMO, overId)),
    ).rejects.toThrow();
    // The throw rolled the mutation back, so the over-cap bytes were NOT added
    // to the counter (still exactly the pre-filled 5 GB + the first small file).
    const after = await t.run(async (ctx) => {
      const row = (await ctx.db.query("usageCounters").collect()).find(
        (r) => r.orgId === DEMO && r.metric === "storage_bytes",
      );
      return row?.value ?? 0;
    });
    expect(after).toBe(used + 5 * BYTES_PER_GB);
  });

  it("does not throw on an unlimited (agency) tier", async () => {
    await t.run(async (ctx) => {
      const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === DEMO)!;
      await ctx.db.patch(org._id, { tier: "agency" });
    });
    await t.run((ctx) => recordUsage(ctx, DEMO, "ai_credits", 1_000_000));
    // agency aiCreditsPerMonth is the unlimited sentinel -> never throws.
    await t.run((ctx) => assertWithinLimit(ctx, DEMO, "ai_credits", 1));
  });
});
