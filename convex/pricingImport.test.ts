import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

/* Loading a studio's rate card. The line that matters: the numbers that land
   in the account are the numbers on the brochure, and running it twice does
   not put two prices on one product. */

const ORG = "slang-city";
const OTHER = "someone-else";

type Result = {
  applied: boolean;
  studio: string;
  created: number;
  updated: number;
  unchanged: number;
  items: {
    table: string;
    name: string;
    action: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
  }[];
  stale: { table: string; name: string; cents: number; active: boolean }[];
};

async function studio(t: ReturnType<typeof convexTest>, orgId = ORG, name = "Slang City Studios") {
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", {
      orgId, name, slug: orgId, plan: "studio", tier: "label",
      status: "active", agencyId: "ag1", ownerEmail: "o@x",
    } as never);
  });
}

/** A slice of the real brochure - one of each kind of row. */
const BROCHURE = {
  memberships: [
    {
      name: "Podcast Residency Membership",
      description: "8-10 episodes (20 hours).",
      priceCents: 240000,
      bundledHoursPerPeriod: 20,
    },
  ],
  packages: [
    { name: "Podcast Bundle", hours: 2, priceCents: 45000, description: "2-hour podcast." },
  ],
  addOns: [{ label: "Mix/Master", amountCents: 10000, description: "Per song." }],
};

describe("importing a studio's price list", () => {
  it("counts what it would write and writes nothing", async () => {
    const t = convexTest(schema);
    await studio(t);

    const dry = (await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG,
      ...BROCHURE,
    })) as Result;

    expect(dry.applied).toBe(false);
    expect(dry.studio).toBe("Slang City Studios");
    expect(dry.created).toBe(3);
    expect(dry.updated).toBe(0);

    const [plans, packages, fees] = await t.run(async (ctx) => [
      await ctx.db.query("membershipPlans").collect(),
      await ctx.db.query("packageProducts").collect(),
      await ctx.db.query("feeTemplates").collect(),
    ]);
    expect(plans).toHaveLength(0);
    expect(packages).toHaveLength(0);
    expect(fees).toHaveLength(0);
  });

  it("writes the brochure's numbers when told to apply", async () => {
    const t = convexTest(schema);
    await studio(t);

    const res = (await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG,
      apply: true,
      ...BROCHURE,
    })) as Result;
    expect(res.applied).toBe(true);
    expect(res.created).toBe(3);

    const [plans, packages, fees] = await t.run(async (ctx) => [
      await ctx.db.query("membershipPlans").collect(),
      await ctx.db.query("packageProducts").collect(),
      await ctx.db.query("feeTemplates").collect(),
    ]);

    expect(plans).toHaveLength(1);
    // $2,400, not $2,000. This is the whole point of the function.
    expect(plans[0].priceCents).toBe(240000);
    expect(plans[0].bundledHoursPerPeriod).toBe(20);
    expect(plans[0].billingInterval).toBe("month");
    expect(plans[0].active).toBe(true);
    // The studio links its own Stripe prices; we never invent one.
    expect(plans[0].stripePriceId).toBeUndefined();

    expect(packages[0].hours).toBe(2);
    expect(packages[0].priceCents).toBe(45000);
    expect(fees[0].label).toBe("Mix/Master");
    expect(fees[0].amountCents).toBe(10000);
  });

  it("patches the row it already made instead of adding a second one", async () => {
    const t = convexTest(schema);
    await studio(t);
    await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG, apply: true, ...BROCHURE,
    });

    // The brochure was misread the first time; the corrected run must not
    // leave two "Podcast Bundle" rows behind.
    const corrected = (await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG,
      apply: true,
      ...BROCHURE,
      packages: [{ ...BROCHURE.packages[0], priceCents: 50000 }],
    })) as Result;

    expect(corrected.created).toBe(0);
    expect(corrected.updated).toBe(1);
    expect(corrected.unchanged).toBe(2);
    const change = corrected.items.find((i) => i.name === "Podcast Bundle")!.changes!;
    expect(change.priceCents).toEqual({ from: 45000, to: 50000 });

    const packages = await t.run((ctx) => ctx.db.query("packageProducts").collect());
    expect(packages).toHaveLength(1);
    expect(packages[0].priceCents).toBe(50000);
  });

  it("re-running an unchanged brochure reports nothing to do", async () => {
    const t = convexTest(schema);
    await studio(t);
    await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG, apply: true, ...BROCHURE,
    });

    const again = (await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG, apply: true, ...BROCHURE,
    })) as Result;
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  it("treats a name that differs only by case or spacing as the same row", async () => {
    const t = convexTest(schema);
    await studio(t);
    await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG, apply: true, ...BROCHURE,
    });

    const shouty = (await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG,
      apply: true,
      packages: [{ ...BROCHURE.packages[0], name: "  PODCAST   BUNDLE " }],
      addOns: [{ ...BROCHURE.addOns[0], label: "mix/master" }],
    })) as Result;

    expect(shouty.created).toBe(0);
    expect(shouty.updated).toBe(2); // both rename back to the brochure's casing

    const [packages, fees] = await t.run(async (ctx) => [
      await ctx.db.query("packageProducts").collect(),
      await ctx.db.query("feeTemplates").collect(),
    ]);
    expect(packages).toHaveLength(1);
    expect(fees).toHaveLength(1);
    expect(packages[0].name).toBe("PODCAST BUNDLE");
    expect(fees[0].label).toBe("mix/master");
  });

  it("refuses a payload that names one product twice", async () => {
    const t = convexTest(schema);
    await studio(t);
    await expect(
      t.mutation(internal.pricingImport._importPricing, {
        orgId: ORG,
        apply: true,
        packages: [
          { name: "Podcast Bundle", hours: 2, priceCents: 45000 },
          { name: "podcast bundle", hours: 2, priceCents: 50000 },
        ],
      }),
    ).rejects.toThrow();

    const packages = await t.run((ctx) => ctx.db.query("packageProducts").collect());
    expect(packages).toHaveLength(0);
  });

  it("reports what the brochure did not mention without deleting it", async () => {
    const t = convexTest(schema);
    await studio(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("feeTemplates", {
        orgId: ORG, label: "Annual Maintenance Fee", amountCents: 7900,
        active: true, createdAt: 1,
      } as never);
    });

    const res = (await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG, apply: true, ...BROCHURE,
    })) as Result;

    expect(res.stale).toEqual([
      { table: "feeTemplates", name: "Annual Maintenance Fee", cents: 7900, active: true },
    ]);
    const fees = await t.run((ctx) => ctx.db.query("feeTemplates").collect());
    expect(fees).toHaveLength(2); // the old one is still there, untouched
  });

  it("touches nothing in another studio", async () => {
    const t = convexTest(schema);
    await studio(t);
    await studio(t, OTHER, "Playback");
    await t.mutation(internal.pricingImport._importPricing, {
      orgId: OTHER,
      apply: true,
      packages: [{ name: "Podcast Bundle", hours: 2, priceCents: 99900 }],
    });

    await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG, apply: true, ...BROCHURE,
    });

    const packages = await t.run((ctx) => ctx.db.query("packageProducts").collect());
    expect(packages).toHaveLength(2);
    const theirs = packages.find((p) => p.orgId === OTHER)!;
    expect(theirs.priceCents).toBe(99900); // their price, not ours
    expect(packages.find((p) => p.orgId === ORG)!.priceCents).toBe(45000);
  });

  it("refuses an orgId that does not exist", async () => {
    const t = convexTest(schema);
    await expect(
      t.mutation(internal.pricingImport._importPricing, { orgId: "nope", apply: true, ...BROCHURE }),
    ).rejects.toThrow();
  });

  it("refuses a price that is not a number", async () => {
    const t = convexTest(schema);
    await studio(t);
    await expect(
      t.mutation(internal.pricingImport._importPricing, {
        orgId: ORG,
        apply: true,
        addOns: [{ label: "Mix/Master", amountCents: Number.NaN }],
      }),
    ).rejects.toThrow();
  });

  it("turns a retired tier back on when the brochure still lists it", async () => {
    const t = convexTest(schema);
    await studio(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("membershipPlans", {
        orgId: ORG, name: "Podcast Residency Membership", priceCents: 200000,
        billingInterval: "month", bundledHoursPerPeriod: 20, active: false, createdAt: 1,
      } as never);
    });

    await t.mutation(internal.pricingImport._importPricing, {
      orgId: ORG, apply: true, ...BROCHURE,
    });

    const plans = await t.run((ctx) => ctx.db.query("membershipPlans").collect());
    expect(plans).toHaveLength(1);
    expect(plans[0].active).toBe(true);
    expect(plans[0].priceCents).toBe(240000);
  });
});
