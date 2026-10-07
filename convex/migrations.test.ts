import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import {
  migratedAgencyPlan,
  migratedOrgFields,
  migratedPlanName,
} from "./migrations";
import { tierForOrg } from "./lib/tier";

/* The Core / Growth / Max migration. Runs only against the in-memory test
   database here; it has NOT been run against any deployment.

   This file and convex/migrations.ts + convex/lib/legacyPlans.ts are the only
   places allowed to spell the old plan values (see noOldPlanKeys.test.ts). */

describe("mapping", () => {
  it("maps every old orgs.tier value", () => {
    expect(migratedOrgFields({ tier: "studio" }).tier).toBe("core");
    expect(migratedOrgFields({ tier: "pro" }).tier).toBe("growth");
    expect(migratedOrgFields({ tier: "label" }).tier).toBe("max");
    expect(migratedOrgFields({ tier: "growth" }).tier).toBe("growth");
    expect(migratedOrgFields({ tier: "flow" }).tier).toBe("core");
    expect(migratedOrgFields({ tier: "enterprise" }).tier).toBe("max");
    expect(migratedOrgFields({ tier: "agency" }).tier).toBe("max");
  });

  it("folds the retired orgs.plan into tier with its OWN meaning", () => {
    // orgs.plan "studio" was the old pro tier, not the old studio tier.
    expect(migratedOrgFields({ plan: "solo" })).toEqual({ tier: "core", clearPlan: true, changed: true });
    expect(migratedOrgFields({ plan: "studio" })).toEqual({ tier: "growth", clearPlan: true, changed: true });
    expect(migratedOrgFields({ plan: "label" })).toEqual({ tier: "max", clearPlan: true, changed: true });
  });

  it("lets an existing tier win over the retired plan, and clears the plan", () => {
    expect(migratedOrgFields({ tier: "label", plan: "solo" })).toEqual({ tier: "max", clearPlan: true, changed: true });
  });

  it("leaves a migrated row alone", () => {
    expect(migratedOrgFields({ tier: "growth" }).changed).toBe(false);
    expect(migratedOrgFields({}).changed).toBe(false);
  });

  it("maps every old agencies.plan value", () => {
    expect(migratedAgencyPlan("studio")).toBe("core");
    expect(migratedAgencyPlan("pro")).toBe("growth");
    expect(migratedAgencyPlan("label")).toBe("max");
    expect(migratedAgencyPlan("growth")).toBe("growth");
    expect(migratedAgencyPlan("flow")).toBe("core");
    expect(migratedAgencyPlan("enterprise")).toBe("max");
    expect(migratedAgencyPlan("agency")).toBe("max");
    expect(migratedAgencyPlan("agency_plus")).toBe("max");
    expect(migratedAgencyPlan("nonsense")).toBe("core");
  });

  it("renames the seeded price-book plans and nothing else", () => {
    expect(migratedPlanName("Studio")).toBe("Core");
    expect(migratedPlanName("Studio Pro")).toBe("Growth");
    expect(migratedPlanName("Label")).toBe("Max");
    expect(migratedPlanName("Studio - Early Adopter")).toBe("Core - Early Adopter");
    expect(migratedPlanName("Studio Pro - Early Adopter")).toBe("Growth - Early Adopter");
    expect(migratedPlanName("Beta - free for a year")).toBe("Beta - free for a year");
    expect(migratedPlanName("My custom plan")).toBe("My custom plan");
  });
});

describe("migrateToCoreGrowthMax (in-memory database only)", () => {
  async function seedLegacy(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "ag1", name: "Ag", slug: "ag", plan: "agency_plus", status: "active",
        ownerClerkUserId: "u", ownerEmail: "u@x",
      });
      await ctx.db.insert("agencies", {
        agencyId: "ag2", name: "Ag2", slug: "ag2", plan: "pro", status: "active",
        ownerClerkUserId: "u2", ownerEmail: "u2@x",
      });
      await ctx.db.insert("orgs", { orgId: "a", name: "A", slug: "a", plan: "studio", tier: "pro" });
      await ctx.db.insert("orgs", { orgId: "b", name: "B", slug: "b", plan: "studio" });
      await ctx.db.insert("orgs", { orgId: "c", name: "C", slug: "c", plan: "solo", tier: "label" });
      await ctx.db.insert("orgs", { orgId: "d", name: "D", slug: "d", tier: "flow" });
      await ctx.db.insert("orgs", { orgId: "e", name: "E", slug: "e", tier: "growth" });
      await ctx.db.insert("orgs", { orgId: "f", name: "F", slug: "f", agencyId: "ag2" });
      const base = {
        agencyId: "ag1", priceCents: 0, billingInterval: "month" as const, trialDays: 0,
        requireCardAfterTrial: false, isPromo: false, isDefault: false, active: true, createdAt: 0,
      };
      await ctx.db.insert("agencyPlans", { ...base, name: "Studio" });
      await ctx.db.insert("agencyPlans", { ...base, name: "Studio Pro - Early Adopter" });
      await ctx.db.insert("agencyPlans", { ...base, name: "Label" });
      await ctx.db.insert("agencyPlans", { ...base, name: "Beta - free for a year" });
    });
  }

  it("reports without writing on a dry run", async () => {
    const t = convexTest(schema);
    await seedLegacy(t);
    const dry = await t.mutation(internal.migrations.migrateToCoreGrowthMax, { dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, orgs: 4, agencies: 2, agencyPlans: 3 });
    const b = await t.run(async (ctx) => (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "b"));
    expect(b?.plan).toBe("studio");
  });

  it("rewrites every legacy value, and a second run changes nothing", async () => {
    const t = convexTest(schema);
    await seedLegacy(t);
    const first = await t.mutation(internal.migrations.migrateToCoreGrowthMax, {});
    expect(first).toMatchObject({ dryRun: false, orgs: 4, agencies: 2, agencyPlans: 3 });

    const rows = await t.run(async (ctx) => ({
      orgs: await ctx.db.query("orgs").collect(),
      agencies: await ctx.db.query("agencies").collect(),
      plans: await ctx.db.query("agencyPlans").collect(),
    }));
    const tier = (id: string) => rows.orgs.find((o) => o.orgId === id);
    expect(tier("a")).toMatchObject({ tier: "growth" });
    expect(tier("b")).toMatchObject({ tier: "growth" });
    expect(tier("c")).toMatchObject({ tier: "max" });
    expect(tier("d")).toMatchObject({ tier: "core" });
    expect(tier("e")).toMatchObject({ tier: "growth" });
    expect(tier("f")?.tier).toBeUndefined();          // still follows its agency
    for (const o of rows.orgs) expect(o.plan).toBeUndefined();
    expect(rows.agencies.map((a) => a.plan).sort()).toEqual(["growth", "max"]);
    expect(rows.plans.map((p) => p.name).sort()).toEqual([
      "Beta - free for a year", "Core", "Growth - Early Adopter", "Max",
    ]);

    // f follows its (now growth) agency.
    expect(await t.run((ctx) => tierForOrg(ctx, "f"))).toBe("growth");

    const second = await t.mutation(internal.migrations.migrateToCoreGrowthMax, {});
    expect(second).toMatchObject({ orgs: 0, agencies: 0, agencyPlans: 0 });
  });

  it("resolves rows the migration has not reached yet, so a deploy cannot demote anyone", async () => {
    const t = convexTest(schema);
    await seedLegacy(t);
    expect(await t.run((ctx) => tierForOrg(ctx, "a"))).toBe("growth");
    expect(await t.run((ctx) => tierForOrg(ctx, "b"))).toBe("growth");
    expect(await t.run((ctx) => tierForOrg(ctx, "c"))).toBe("max");
    expect(await t.run((ctx) => tierForOrg(ctx, "d"))).toBe("core");
  });
});
