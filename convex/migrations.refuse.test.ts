import { describe, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/* The refusal path. The real rule cannot lower anyone by construction, so the
   new-rule resolver is stubbed to force a regression and prove the migration
   throws before writing a single row. */
vi.mock("./lib/tier", async (orig) => ({
  ...(await orig<typeof import("./lib/tier")>()),
  resolveTierPure: () => "core",
}));

describe("migrateToCoreGrowthMax refusal", () => {
  async function seed() {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "agL", name: "L", slug: "l", plan: "label", status: "active",
        ownerClerkUserId: "u", ownerEmail: "u@x",
      });
      await ctx.db.insert("orgs", { orgId: "ag_studio", name: "A", slug: "a", tier: "studio", agencyId: "agL" });
      await ctx.db.insert("orgs", { orgId: "alone", name: "C", slug: "c", tier: "studio" });
    });
    return t;
  }

  it("throws and writes nothing when any org would resolve lower", async () => {
    const t = await seed();
    await expect(
      t.mutation(internal.migrations.migrateToCoreGrowthMax, {}),
    ).rejects.toThrow(/refused, nothing written.*ag_studio max -> core/);
    const rows = await t.run(async (ctx) => ({
      orgs: await ctx.db.query("orgs").collect(),
      agencies: await ctx.db.query("agencies").collect(),
    }));
    expect(rows.orgs.map((o) => o.tier).sort()).toEqual(["studio", "studio"]);
    expect(rows.agencies[0].plan).toBe("label");
  });

  it("the dry run lists the lowered orgs instead of throwing", async () => {
    const t = await seed();
    const dry = await t.mutation(internal.migrations.migrateToCoreGrowthMax, { dryRun: true });
    expect(dry.lowered).toEqual([{ orgId: "ag_studio", oldRule: "max", newRule: "core" }]);
  });
});
