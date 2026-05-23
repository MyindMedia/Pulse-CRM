import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { PLAN_LIMITS } from "./lib/plans";

const DEMO = "pulse-demo";

async function seedOrg(t: ReturnType<typeof convexTest>, tier?: "studio" | "pro" | "agency") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId: DEMO,
      name: "Demo",
      slug: "demo",
      plan: "studio",
      status: "active",
      ...(tier ? { tier } : {}),
    });
  });
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
    await seedOrg(t, "pro");
    await t.mutation(internal.usage.record, { orgId: DEMO, metric: "ai_credits", amount: 42 });
    const summary = await t.query(api.usage.summary, {});
    expect(summary.tier).toBe("pro");
    expect(summary.caps.aiCreditsPerMonth).toBe(PLAN_LIMITS.pro.aiCreditsPerMonth);
    expect(summary.caps.magicLinkGrantsPerMonth).toBe(PLAN_LIMITS.pro.magicLinkGrantsPerMonth);
    const ai = summary.metrics.find((m) => m.metric === "ai_credits");
    expect(ai?.used).toBe(42);
    expect(ai?.limit).toBe(PLAN_LIMITS.pro.aiCreditsPerMonth);
  });

  it("defaults to the studio tier when org tier is unset", async () => {
    await seedOrg(t);
    const summary = await t.query(api.usage.summary, {});
    expect(summary.tier).toBe("studio");
    expect(summary.caps.subAccountCap).toBe(PLAN_LIMITS.studio.subAccountCap);
  });
});

describe("invites grant-quota enforcement", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  it("throws once the monthly magic-link cap is exceeded", async () => {
    await seedOrg(t, "studio"); // studio cap = 5
    const cap = PLAN_LIMITS.studio.magicLinkGrantsPerMonth;
    for (let i = 0; i < cap; i++) {
      await t.mutation(internal.invites.record, {
        orgId: DEMO, email: `a${i}@x.com`, ownerName: "A", studioName: "X",
        invitedBy: "system", emailStatus: "sent",
      });
    }
    // The (cap+1)th issuance must throw.
    await expect(
      t.mutation(internal.invites.record, {
        orgId: DEMO, email: "over@x.com", ownerName: "A", studioName: "X",
        invitedBy: "system", emailStatus: "sent",
      }),
    ).rejects.toThrow(/grant limit reached/i);

    // The email counter recorded exactly `cap` successful sends.
    const counter = await t.run(async (ctx) =>
      (await ctx.db.query("usageCounters").collect()).find(
        (r) => r.orgId === DEMO && r.metric === "email",
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
