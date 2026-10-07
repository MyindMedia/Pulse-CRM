import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  PUBLIC_TIERS,
  priceLabel,
  tierAtLeast,
  type CapabilityKey,
} from "./lib/plans";
import {
  capabilitiesForTier,
  hasCapability,
  lockedNavFeatures,
  minTierFor,
  effectiveDisabledFeatures,
  entitlementForCapability,
  requireFeature,
  orgHasFeature,
  NAV_CAPABILITIES,
  ENTITLEMENT_FOR_CAPABILITY,
} from "./lib/entitlements";
import { tierForOrg, tierForPlan, DEMO_ORG } from "./lib/tier";

/* The tier ladder is revenue logic. These tests exist so a future edit cannot
   quietly hand a paid capability to a cheaper tier, or strip one from a tier
   that already paid for it. */

describe("price book", () => {
  it("sells three tiers at the published prices", () => {
    expect(SELLABLE_TIERS).toEqual(["core", "growth", "max"]);
    expect(priceLabel("core")).toBe("$149");
    expect(priceLabel("growth")).toBe("$297");
    expect(priceLabel("max")).toBe("$699");
  });

  it("orders public tiers cheapest first", () => {
    const prices = PUBLIC_TIERS.map((t) => PLAN_LIMITS[t].priceCents).filter((c) => c > 0);
    expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
  });

  it("sells exactly the three tiers, nothing legacy", () => {
    expect(Object.keys(PLAN_LIMITS).sort()).toEqual(["core", "growth", "max"]);
    expect(PUBLIC_TIERS).toEqual(["core", "growth", "max"]);
  });
});

describe("capability ladder", () => {
  it("is strictly cumulative - a higher tier never loses a capability", () => {
    for (let i = 1; i < SELLABLE_TIERS.length; i++) {
      const lower = capabilitiesForTier(SELLABLE_TIERS[i - 1]);
      const higher = capabilitiesForTier(SELLABLE_TIERS[i]);
      for (const cap of lower) {
        expect(
          higher.has(cap),
          `${SELLABLE_TIERS[i]} is missing "${cap}" held by ${SELLABLE_TIERS[i - 1]}`,
        ).toBe(true);
      }
    }
  });

  it("gives every tier a strictly larger capability set than the one below", () => {
    for (let i = 1; i < SELLABLE_TIERS.length; i++) {
      expect(capabilitiesForTier(SELLABLE_TIERS[i]).size).toBeGreaterThan(
        capabilitiesForTier(SELLABLE_TIERS[i - 1]).size,
      );
    }
  });

  it("keeps the whole money loop on the entry tier", () => {
    // The $149 pitch is "book it, hold the card, collect the money". If any
    // of these ever moves up a tier, that pitch stops being true.
    const mustBeEntry: CapabilityKey[] = [
      "bookings",
      "calendar",
      "payments",
      "clients",
      "studio",
      "cardOnFile",
      "noShowShield",
      "dunning",
      "clientPortal",
    ];
    for (const cap of mustBeEntry) {
      expect(hasCapability("core", cap), `${cap} must ship on Core`).toBe(true);
    }
  });

  it("reserves white-label UI and custom domain for the top tier", () => {
    expect(hasCapability("core", "whiteLabelUi")).toBe(false);
    expect(hasCapability("growth", "whiteLabelUi")).toBe(false);
    expect(hasCapability("max", "whiteLabelUi")).toBe(true);
    expect(minTierFor("whiteLabelUi")).toBe("max");
    expect(minTierFor("customDomain")).toBe("max");
  });

  it("reserves staff, the assistant and reporting for Growth and up", () => {
    for (const cap of ["schedule", "payroll", "timeClock", "agent", "reports", "aiReceptionist"] as CapabilityKey[]) {
      expect(hasCapability("core", cap), `${cap} must not ship on Core`).toBe(false);
      expect(hasCapability("growth", cap), `${cap} must ship on Growth`).toBe(true);
    }
  });

  it("ships the moved features at their new tiers", () => {
    // Growth to Core
    for (const cap of ["calendarSync", "gmailSend", "dailySummary", "healthScore"] as CapabilityKey[]) {
      expect(minTierFor(cap), cap).toBe("core");
    }
    // Max to Growth
    for (const cap of ["patch", "software"] as CapabilityKey[]) {
      expect(minTierFor(cap), cap).toBe("growth");
    }
  });

  it("unlocks everything at the top tier", () => {
    const all = new Set<CapabilityKey>();
    for (const t of SELLABLE_TIERS) for (const c of capabilitiesForTier(t)) all.add(c);
    for (const c of all) expect(hasCapability("max", c), `max missing ${c}`).toBe(true);
  });

  it("reports the cheapest tier that unlocks a capability", () => {
    expect(minTierFor("bookings")).toBe("core");
    expect(minTierFor("noShowShield")).toBe("core");
    expect(minTierFor("reviewsReferrals")).toBe("core");
    expect(minTierFor("discountCodes")).toBe("core");
    expect(minTierFor("payroll")).toBe("growth");
    expect(minTierFor("patch")).toBe("growth");
    expect(minTierFor("patchHistory")).toBe("max");
  });
});

describe("nav gating", () => {
  it("locks nav surfaces the tier did not buy", () => {
    const locked = lockedNavFeatures("core");
    expect(locked).toContain("patch");
    expect(locked).toContain("schedule");
    expect(locked).not.toContain("bookings");
    expect(lockedNavFeatures("growth")).toContain("releases");
    expect(lockedNavFeatures("growth")).not.toContain("patch");
    expect(lockedNavFeatures("max")).toEqual([]);
  });

  it("merges operator toggles with tier locks, and toggles cannot unlock", () => {
    // The operator switched off Reports; the tier already locked Releases.
    const eff = effectiveDisabledFeatures("growth", ["reports"]);
    expect(eff).toContain("reports");
    expect(eff).toContain("releases");
    // An operator cannot hand a Growth org a capability it never bought,
    // because the tier locks are unioned in, never subtracted.
    const cannotUnlock = effectiveDisabledFeatures("growth", []);
    expect(cannotUnlock).toContain("releases");
  });

  it("never disables a core module, whatever the stored list says", () => {
    // A stale or hand-edited row must not be able to leave a studio unable to
    // take a booking or see it on a calendar.
    const eff = effectiveDisabledFeatures("max", ["bookings", "calendar"]);
    expect(eff).not.toContain("bookings");
    expect(eff).not.toContain("calendar");
  });

  it("ignores unknown keys in a toggle list", () => {
    const eff = effectiveDisabledFeatures("max", ["not_a_feature"]);
    expect(eff).not.toContain("not_a_feature");
  });

  it("maps every nav capability to a real feature key", () => {
    for (const k of NAV_CAPABILITIES) {
      expect(minTierFor(k), `${k} is sold by no tier`).not.toBeNull();
    }
  });
});

describe("tier resolution", () => {
  it("falls back to the least privileged tier for an unknown plan", () => {
    expect(tierForPlan(undefined)).toBe("core");
    expect(tierForPlan("nonsense")).toBe("core");
    expect(tierForPlan("growth")).toBe("growth");
  });

  it("resolves the demo sandbox at the top tier", async () => {
    const t = convexTest(schema);
    expect(await t.run((ctx) => tierForOrg(ctx, DEMO_ORG))).toBe("max");
  });

  it("reads orgs.tier when set", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: "o1", name: "A", slug: "a", tier: "max" }),
    );
    expect(await t.run((ctx) => tierForOrg(ctx, "o1"))).toBe("max");
  });

  it("lets the agency's plan override orgs.tier, as on main", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "ag1", name: "Ag", slug: "ag", plan: "max", status: "active",
        ownerClerkUserId: "u_ag_owner", ownerEmail: "ag@example.com",
      });
      await ctx.db.insert("orgs", {
        orgId: "sub1", name: "Sub", slug: "sub", tier: "core", agencyId: "ag1",
      });
      await ctx.db.insert("orgs", {
        orgId: "sub2", name: "Sub2", slug: "sub2", agencyId: "ag1",
      });
      await ctx.db.insert("orgs", {
        orgId: "sub3", name: "Sub3", slug: "sub3", tier: "growth", agencyId: "missing-agency",
      });
    });
    // A studio stamped Core by the agency console still runs at the agency's tier.
    expect(await t.run((ctx) => tierForOrg(ctx, "sub1"))).toBe("max");
    expect(await t.run((ctx) => tierForOrg(ctx, "sub2"))).toBe("max");
    // A missing agency row falls back to the studio's own tier.
    expect(await t.run((ctx) => tierForOrg(ctx, "sub3"))).toBe("growth");
  });

  it("follows an agency up/downgrade that only changes agencies.plan", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "agp", name: "Ag", slug: "agp", plan: "max", status: "active",
        ownerClerkUserId: "u_agp", ownerEmail: "agp@example.com",
      });
      await ctx.db.insert("orgs", { orgId: "s", name: "S", slug: "s", tier: "core", agencyId: "agp" });
    });
    expect(await t.run((ctx) => tierForOrg(ctx, "s"))).toBe("max");
    await t.run(async (ctx) => {
      const ag = await ctx.db.query("agencies").first();
      await ctx.db.patch(ag!._id, { plan: "growth" });
    });
    expect(await t.run((ctx) => tierForOrg(ctx, "s"))).toBe("growth");
  });

  it("gives a beta studio Max until it graduates, then the agency plan", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "ag2", name: "Ag", slug: "ag2", plan: "core", status: "active",
        ownerClerkUserId: "u_ag2", ownerEmail: "ag2@example.com",
      });
      await ctx.db.insert("orgs", {
        orgId: "beta1", name: "Beta", slug: "beta1", tier: "core", agencyId: "ag2", betaCohort: true,
      });
      await ctx.db.insert("orgs", {
        orgId: "grad1", name: "Grad", slug: "grad1", tier: "growth", agencyId: "ag2",
        betaCohort: true, graduatedAt: 1,
      });
      await ctx.db.insert("orgs", {
        orgId: "grad2", name: "Grad2", slug: "grad2", tier: "growth",
        betaCohort: true, graduatedAt: 1,
      });
    });
    expect(await t.run((ctx) => tierForOrg(ctx, "beta1"))).toBe("max");
    // Graduated under an agency: follows the agency plan like every other studio.
    expect(await t.run((ctx) => tierForOrg(ctx, "grad1"))).toBe("core");
    // Graduated and standalone: its own tier.
    expect(await t.run((ctx) => tierForOrg(ctx, "grad2"))).toBe("growth");
  });

  it("treats a missing org row as the least privileged tier", async () => {
    const t = convexTest(schema);
    expect(await t.run((ctx) => tierForOrg(ctx, "ghost"))).toBe("core");
  });
});

describe("hard gate", () => {
  it("throws UPGRADE_REQUIRED with the tier that unlocks it", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: "o2", name: "B", slug: "b", tier: "core" }),
    );
    await expect(
      t.run((ctx) => requireFeature(ctx, "o2", "payroll")),
    ).rejects.toMatchObject({
      data: {
        code: "UPGRADE_REQUIRED",
        capability: "payroll",
        currentTier: "core",
        requiredTier: "growth",
        price: "$297",
      },
    });
  });

  it("passes for a capability the tier owns", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: "o3", name: "C", slug: "c", tier: "core" }),
    );
    await expect(t.run((ctx) => requireFeature(ctx, "o3", "bookings"))).resolves.toBeNull();
    expect(await t.run((ctx) => orgHasFeature(ctx, "o3", "bookings"))).toBe(true);
    expect(await t.run((ctx) => orgHasFeature(ctx, "o3", "patch"))).toBe(false);
  });

  it("maps permission capabilities onto entitlements, and leaves core ones unmetered", () => {
    expect(entitlementForCapability("schedule.manage")).toBe("schedule");
    expect(entitlementForCapability("theme.edit")).toBe("whiteLabelUi");
    // Core money-loop permissions must never be tier-gated.
    expect(entitlementForCapability("sessions.edit")).toBeNull();
    expect(entitlementForCapability("invoices.send")).toBeNull();
    expect(entitlementForCapability("rooms.edit")).toBeNull();
    expect(entitlementForCapability("members.invite")).toBeNull();
  });

  it("only maps capabilities that some tier actually sells", () => {
    for (const [cap, ent] of Object.entries(ENTITLEMENT_FOR_CAPABILITY)) {
      expect(minTierFor(ent), `${cap} -> ${ent} is sold by no tier`).not.toBeNull();
    }
  });
});

describe("white label", () => {
  it("escalates the white-label level with price", () => {
    expect(PLAN_LIMITS.core.whitelabel).toBe(false);
    expect(PLAN_LIMITS.growth.whitelabel).toBe("studio_level");
    expect(PLAN_LIMITS.max.whitelabel).toBe("full");
  });

  it("ranks tiers for at-least comparisons", () => {
    expect(tierAtLeast("max", "growth")).toBe(true);
    expect(tierAtLeast("core", "growth")).toBe(false);
    expect(tierAtLeast("growth", "growth")).toBe(true);
  });
});
