import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import {
  ALL_FEATURES,
  CAPABILITY_TIER,
  TIERS,
  tierRank,
  type TierKey,
} from "./lib/pricing";
import { hasCapability, minTierFor } from "./lib/entitlements";
import { PLAN_LIMITS } from "./lib/plans";

/* ============================================================
   Every feature's gate in code matches its tier in the config.

   Two halves. The config half: a feature's gate capability must be
   sold at exactly the feature's tier, present there and absent one
   tier down. The code half: the call sites that were split out of a
   shared block (songs, the cable map, software vs licensing, the
   assistant's settings, the beta flag) refuse and allow at the right
   tier through the real access engine.
   ============================================================ */

describe("config: every gated feature is sold at its own tier", () => {
  const gated = ALL_FEATURES.filter((f) => f.gate);

  it("has a gate for most features", () => {
    expect(gated.length).toBeGreaterThan(120);
  });

  for (const f of ALL_FEATURES.filter((x) => x.gate)) {
    it(`${f.name} (${f.tier}) via ${f.gate}`, () => {
      const gate = f.gate!;
      expect(CAPABILITY_TIER[gate]).toBe(f.tier);
      expect(minTierFor(gate)).toBe(f.tier);
      expect(hasCapability(f.tier, gate)).toBe(true);
      const below = TIERS[tierRank(f.tier) - 1];
      if (below) expect(hasCapability(below, gate)).toBe(false);
    });
  }

  it("documents every feature sold above Core with no tier gate of its own", () => {
    // These are sold at Growth or Max but nothing in code checks the tier for
    // them specifically (they ride an ungated surface). Listed so the gap is
    // visible and cannot grow without someone updating this list.
    const ungated = ALL_FEATURES.filter((f) => !f.gate && f.tier !== "core").map((f) => `${f.tier}: ${f.name}`);
    expect(ungated).toEqual([
      "growth: New staff set themselves up",
      "growth: Alerts for each person",
      "growth: Arrange the home screen",
      "growth: How much of the plan is used",
      "growth: Their brand inside the app",
    ]);
  });
});

async function studio(
  t: ReturnType<typeof convexTest>,
  orgId: string,
  tier: TierKey,
  extra: Record<string, unknown> = {},
) {
  const user = `u_${orgId}`;
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId, name: orgId, slug: orgId, tier, status: "active", ...extra });
    await ctx.db.insert("members", { orgId, name: "Owner", role: "owner", skills: [], clerkUserId: user });
  });
  return t.withIdentity({ subject: user, name: "Owner", orgId });
}

const UPGRADE = { data: { code: "UPGRADE_REQUIRED" } };

const SOFTWARE = {
  name: "Pro Tools", vendor: "Avid", category: "daw" as const,
  licenseType: "subscription" as const, costCents: 29900, billingInterval: "annual" as const,
};

describe("code: split gates refuse and allow at the configured tier", () => {
  it("software subscriptions are Growth, though they share a permission with Licensing", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    const growth = await studio(t, "o_growth", "growth");
    await expect(core.mutation(api.software.create, SOFTWARE)).rejects.toMatchObject(UPGRADE);
    await expect(growth.mutation(api.software.create, SOFTWARE)).resolves.toBeTruthy();
  });

  it("licensing stays Max", async () => {
    const t = convexTest(schema);
    const growth = await studio(t, "o_growth", "growth");
    const songId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "o_growth", name: "A", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      } as never);
      return ctx.db.insert("songs", { orgId: "o_growth", title: "S", artistId, stage: "writing", kind: "single", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 } as never);
    });
    await expect(
      growth.mutation(api.licensing.createSync, { songId, supervisorName: "X", outlet: "Film" }),
    ).rejects.toMatchObject(UPGRADE);
  });

  it("a Core studio can create the song its finished mixes hang off, not manage the catalog", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    const artistId = await t.run((ctx) =>
      ctx.db.insert("artists", {
        orgId: "o_core", name: "A", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      } as never),
    );
    const songId = await core.mutation(api.songs.create, { title: "Mix me", artistId, kind: "single" });
    expect(songId).toBeTruthy();
    // Deleting from the catalog is the Growth catalog.
    await expect(core.mutation(api.songs.remove, { id: songId })).rejects.toMatchObject(UPGRADE);
  });

  it("the cable map is Growth, its device profiles are Max", async () => {
    const t = convexTest(schema);
    const growth = await studio(t, "o_growth", "growth");
    const max = await studio(t, "o_max", "max");
    const profile = { name: "My Pre", manufacturer: "Me", category: "preamp", portTemplate: [] };
    await expect(growth.query(api.patchManager.spaces, {})).resolves.toBeDefined();
    await expect(growth.mutation(api.patchManager.createProfile, profile)).rejects.toMatchObject(UPGRADE);
    await expect(max.mutation(api.patchManager.createProfile, profile)).resolves.toBeTruthy();
  });

  it("the cable map is locked on Core", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    await expect(core.query(api.patchManager.spaces, {})).rejects.toMatchObject(UPGRADE);
  });

  it("the daily summary switch is Core, the rest of the assistant is Growth, autonomy is Max", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    const growth = await studio(t, "o_growth", "growth");
    const max = await studio(t, "o_max", "max");
    await expect(core.mutation(api.agent.updatePolicy, { digestEnabled: false, digestHourLocal: 9 })).resolves.toBeNull();
    await expect(core.mutation(api.agent.updatePolicy, { defaultTone: "friendly" })).rejects.toMatchObject(UPGRADE);
    await expect(growth.mutation(api.agent.updatePolicy, { defaultTone: "friendly" })).resolves.toBeNull();
    await expect(growth.mutation(api.agent.updatePolicy, { autonomy: "auto_low" })).rejects.toMatchObject(UPGRADE);
    await expect(max.mutation(api.agent.updatePolicy, { autonomy: "auto_low" })).resolves.toBeNull();
  });

  it("the studio health score and money won back read on Core", async () => {
    const t = convexTest(schema);
    const core = await studio(t, "o_core", "core");
    await expect(core.query(api.agentHealth.studioHealth, {})).resolves.toBeDefined();
    await expect(core.query(api.recovery.summary, {})).resolves.toBeDefined();
  });

  it("print who owns what is Max: Growth gets nothing to export, without an error", async () => {
    const t = convexTest(schema);
    const growth = await studio(t, "o_growth", "growth");
    const songId = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: "o_growth", name: "A", type: "artist", genres: [], tags: [], status: "active",
        lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      } as never);
      return ctx.db.insert("songs", { orgId: "o_growth", title: "S", artistId, stage: "writing", kind: "single", moodTags: [], referenceTracks: [], revisionsIncluded: 3, revisionsUsed: 0 } as never);
    });
    await expect(growth.query(api.rightsExport.packet, { songId })).resolves.toBeNull();
  });
});

describe("beta access", () => {
  it("gives a beta studio Max through the flag, whatever tier is stored", async () => {
    const t = convexTest(schema);
    const beta = await studio(t, "o_beta", "core", { betaCohort: true });
    const profile = { name: "Beta Pre", manufacturer: "Me", category: "preamp", portTemplate: [] };
    await expect(beta.mutation(api.patchManager.createProfile, profile)).resolves.toBeTruthy();
    const current = await beta.query(api.orgs.current, {});
    expect(current?.tier).toBe("max");
  });

  it("graduation hands over the real tier", async () => {
    const t = convexTest(schema);
    const grad = await studio(t, "o_grad", "core", { betaCohort: true, graduatedAt: 1 });
    await expect(grad.mutation(api.software.create, SOFTWARE)).rejects.toMatchObject(UPGRADE);
    const current = await grad.query(api.orgs.current, {});
    expect(current?.tier).toBe("core");
  });
});

describe("plan changes are a billing act", () => {
  it("orgs.update no longer accepts a plan or tier", async () => {
    const t = convexTest(schema);
    const owner = await studio(t, "o_lock", "core");
    await expect(
      owner.mutation(api.orgs.update, { name: "X", plan: "max" } as never),
    ).rejects.toThrow();
    await expect(
      owner.mutation(api.orgs.update, { name: "X", tier: "max" } as never),
    ).rejects.toThrow();
    const org = await t.run(async (ctx) =>
      (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "o_lock"),
    );
    expect(org?.tier).toBe("core");
  });
});

describe("allowances", () => {
  it("steps up from Core to Growth to Max", () => {
    expect(PLAN_LIMITS.core.aiCreditsPerMonth).toBe(100);
    expect(PLAN_LIMITS.growth.aiCreditsPerMonth).toBe(1_000);
    expect(PLAN_LIMITS.max.aiCreditsPerMonth).toBe(5_000);
    expect(PLAN_LIMITS.core.storageGb).toBe(10);
    expect(PLAN_LIMITS.growth.storageGb).toBe(100);
    expect(PLAN_LIMITS.max.storageGb).toBe(1_000);
    expect(PLAN_LIMITS.core.roomCap).toBe(2);
    expect(PLAN_LIMITS.core.staffCap).toBe(3);
    expect(PLAN_LIMITS.growth.staffCap).toBe(15);
  });

  it("gives Growth unlimited rooms and Max unlimited studios, pooled", () => {
    expect(PLAN_LIMITS.growth.roomCap).toBeGreaterThanOrEqual(999_999);
    expect(PLAN_LIMITS.growth.subAccountCap).toBe(1);
    expect(PLAN_LIMITS.max.subAccountCap).toBeGreaterThanOrEqual(999_999);
    expect(PLAN_LIMITS.max.pooled).toBe(true);
    expect(PLAN_LIMITS.growth.pooled).toBe(false);
  });
});
