import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { PLAN_LIMITS } from "./lib/plans";

const DEMO = "pulse-demo";
/** A real (non-demo) studio. The demo sandbox always resolves to Max, so
 *  anything about a specific tier needs its own org and a signed-in owner. */
const ORG = "org_usage";
const OWNER = "u_usage_owner";

async function seedOrg(t: ReturnType<typeof convexTest>, tier?: "core" | "growth" | "max") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: DEMO,
      name: "Demo",
      slug: "demo",
      status: "active",
    });
  });
  return seedStudio(t, ORG, tier);
}

async function seedStudio(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  tier?: "core" | "growth" | "max",
  agencyId?: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId,
      name: orgId,
      slug: orgId,
      status: "active",
      ...(tier ? { tier } : {}),
      ...(agencyId ? { agencyId } : {}),
    });
    await ctx.db.insert("members", {
      orgId, name: "Owner", role: "owner", skills: [], clerkUserId: `${OWNER}_${orgId}`,
    });
  });
  return t.withIdentity({ subject: `${OWNER}_${orgId}`, orgId });
}

describe("usage.record", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("upserts then increments a monthly counter", async () => {
    await t.mutation(internal.usage.record, { orgId: DEMO, metric: "ai_credits", amount: 10 });
    await t.mutation(internal.usage.record, { orgId: DEMO, metric: "ai_credits", amount: 5 });
    const rows = await t.run(async (ctx) =>
      (await ctx.db.query("usageCounters").collect()).filter((r) => r.orgId === DEMO),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe(15);
    expect(rows[0].metric).toBe("ai_credits");
    // Monthly metric -> period is "YYYY-MM", not "all".
    expect(rows[0].period).toMatch(/^\d{4}-\d{2}$/);
  });

  it("uses the 'all' period for cumulative metrics", async () => {
    await t.mutation(internal.usage.record, { orgId: DEMO, metric: "storage_bytes", amount: 2048 });
    const row = await t.run(async (ctx) =>
      (await ctx.db.query("usageCounters").collect()).find((r) => r.orgId === DEMO),
    );
    expect(row?.period).toBe("all");
    expect(row?.value).toBe(2048);
  });
});

describe("usage.summary", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("returns plan caps for the resolved tier and current usage", async () => {
    const owner = await seedOrg(t, "growth");
    await t.mutation(internal.usage.record, { orgId: ORG, metric: "ai_credits", amount: 42 });
    const summary = await owner.query(api.usage.summary, {});
    expect(summary.tier).toBe("growth");
    expect(summary.caps.aiCreditsPerMonth).toBe(PLAN_LIMITS.growth.aiCreditsPerMonth);
    expect(summary.caps.magicLinkGrantsPerMonth).toBe(PLAN_LIMITS.growth.magicLinkGrantsPerMonth);
    const ai = summary.metrics.find((m) => m.metric === "ai_credits");
    expect(ai?.used).toBe(42);
    expect(ai?.limit).toBe(PLAN_LIMITS.growth.aiCreditsPerMonth);
  });

  it("defaults to the core tier when org tier is unset", async () => {
    const owner = await seedOrg(t);
    const summary = await owner.query(api.usage.summary, {});
    expect(summary.tier).toBe("core");
    expect(summary.caps.subAccountCap).toBe(PLAN_LIMITS.core.subAccountCap);
  });
});

describe("invites grant-quota enforcement", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("throws once the monthly magic-link cap is exceeded", async () => {
    await seedOrg(t, "core");
    const cap = PLAN_LIMITS.core.magicLinkGrantsPerMonth;
    for (let i = 0; i < cap; i++) {
      await t.mutation(internal.invites.record, {
        orgId: ORG, email: `a${i}@x.com`, ownerName: "A", studioName: "X",
        invitedBy: "system", emailStatus: "sent",
      });
    }
    // The (cap+1)th issuance must throw.
    await expect(
      t.mutation(internal.invites.record, {
        orgId: ORG, email: "over@x.com", ownerName: "A", studioName: "X",
        invitedBy: "system", emailStatus: "sent",
      }),
    ).rejects.toThrow(/grant limit reached/i);

    // The email counter recorded exactly `cap` successful sends.
    const counter = await t.run(async (ctx) =>
      (await ctx.db.query("usageCounters").collect()).find(
        (r) => r.orgId === ORG && r.metric === "email",
      ),
    );
    expect(counter?.value).toBe(cap);
  });
});

describe("exports CSV shape", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("clientsCsv returns a header + escaped row and meters one export", async () => {
    await seedOrg(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("artists", {
        orgId: DEMO, name: "Nova, Inc", type: "band", email: "nova@x.com",
        genres: ["pop", "rnb"], tags: [], status: "active",
        lifetimeValueCents: 250000, sessionCount: 4, reliability: "solid",
      });
    });
    const out = await t.mutation(api.exports.clientsCsv, {});
    expect(out.filename).toBe("pulse-clients.csv");
    const lines = out.csv.split("\r\n");
    expect(lines[0]).toContain("Name");
    // Comma in the name forces RFC-4180 quoting.
    expect(lines[1]).toContain('"Nova, Inc"');
    expect(lines[1]).toContain("2500.00"); // lifetime value in dollars
    expect(lines[1]).toContain("pop; rnb"); // joined genres

    const exportsCounter = await t.run(async (ctx) =>
      (await ctx.db.query("usageCounters").collect()).find(
        (r) => r.orgId === DEMO && r.metric === "exports",
      ),
    );
    expect(exportsCounter?.value).toBe(1);
  });
});

describe("pooled allowances on Max", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function agency(plan: "core" | "growth" | "max") {
    await t.run((ctx) => ctx.db.insert("agencies", {
      agencyId: "ag_pool", name: "Pool", slug: "pool", plan, status: "active",
      ownerClerkUserId: "u_pool", ownerEmail: "pool@x",
    }));
  }

  it("counts every Max studio in the group against one cap", async () => {
    await agency("max");
    const a = await seedStudio(t, "pool_a", "max", "ag_pool");
    await seedStudio(t, "pool_b", "max", "ag_pool");
    await t.mutation(internal.usage.record, { orgId: "pool_a", metric: "ai_credits", amount: 300 });
    await t.mutation(internal.usage.record, { orgId: "pool_b", metric: "ai_credits", amount: 200 });
    const summary = await a.query(api.usage.summary, {});
    expect(summary.pooled).toBe(true);
    expect(summary.metrics.find((m) => m.metric === "ai_credits")?.used).toBe(500);
  });

  it("refuses an assistant run once the group, not the studio, is over the cap", async () => {
    await agency("max");
    await seedStudio(t, "pool_a", "max", "ag_pool");
    await seedStudio(t, "pool_b", "max", "ag_pool");
    const cap = PLAN_LIMITS.max.aiCreditsPerMonth;
    await t.mutation(internal.usage.record, { orgId: "pool_b", metric: "ai_credits", amount: cap });
    await expect(
      t.query(internal.usage.checkLimit, { orgId: "pool_a", metric: "ai_credits", add: 1 }),
    ).rejects.toMatchObject({ data: { code: "LIMIT_REACHED" } });
  });

  it("does not pool a cheaper sibling into the Max group", async () => {
    await agency("max");
    const a = await seedStudio(t, "pool_a", "max", "ag_pool");
    await seedStudio(t, "pool_core", "core", "ag_pool");
    await t.mutation(internal.usage.record, { orgId: "pool_core", metric: "ai_credits", amount: 90 });
    const summary = await a.query(api.usage.summary, {});
    expect(summary.metrics.find((m) => m.metric === "ai_credits")?.used).toBe(0);
  });

  it("keeps Core and Growth allowances per studio", async () => {
    await agency("growth");
    const a = await seedStudio(t, "solo_a", "growth", "ag_pool");
    await seedStudio(t, "solo_b", "growth", "ag_pool");
    await t.mutation(internal.usage.record, { orgId: "solo_b", metric: "ai_credits", amount: 50 });
    const summary = await a.query(api.usage.summary, {});
    expect(summary.pooled).toBe(false);
    expect(summary.metrics.find((m) => m.metric === "ai_credits")?.used).toBe(0);
  });
});
