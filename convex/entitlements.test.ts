import { describe, it, expect } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  PUBLIC_TIERS,
  priceLabel,
  takeCents,
  breakEvenCollectionsCents,
  tierAtLeast,
  type TierKey,
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
    // Flow is built but PARKED - it contradicts the founding "Pulse
    // facilitates, not platform-collected" principle, so it is not sold
    // until that is a deliberate decision.
    expect(SELLABLE_TIERS).toEqual(["studio", "pro", "label"]);
    expect(PLAN_LIMITS.flow.publicTier).toBe(false);
    expect(priceLabel("studio")).toBe("$149.99");
    expect(priceLabel("pro")).toBe("$297.00");
    expect(priceLabel("label")).toBe("$499.99");
  });

  it("prices the payments-monetized plan in its take rate, not a monthly fee", () => {
    expect(PLAN_LIMITS.flow.priceCents).toBe(0);
    expect(PLAN_LIMITS.flow.takeRateBps).toBe(200);
    expect(PLAN_LIMITS.flow.paymentsRequired).toBe(true);
    expect(priceLabel("flow")).toBe("2% of collections");
  });

  it("computes the take and the point where a subscription wins", () => {
    // 2% of $1,000 collected.
    expect(takeCents("flow", 100_000)).toBe(2_000);
    // A subscription plan takes nothing per transaction.
    expect(takeCents("studio", 100_000)).toBe(0);
    // $149.99 / 2% = $7,499.50 collected in a month.
    expect(breakEvenCollectionsCents("flow", "studio")).toBe(749_950);
    expect(breakEvenCollectionsCents("studio", "pro")).toBeNull();
  });

  it("orders public tiers cheapest first", () => {
    const prices = PUBLIC_TIERS.map((t) => PLAN_LIMITS[t].priceCents).filter((c) => c > 0);
    expect([...prices]).toEqual([...prices].sort((a, b) => a - b));
  });

  it("keeps legacy tiers off the pricing page", () => {
    expect(PUBLIC_TIERS).not.toContain("agency");
    expect(PUBLIC_TIERS).not.toContain("growth");
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
    // The $149.99 pitch is "book it, hold the card, collect the money". If any
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
      expect(hasCapability("studio", cap), `${cap} must ship on Studio`).toBe(true);
    }
  });

  it("reserves white-label UI and custom domain for the top tier", () => {
    expect(hasCapability("studio", "whiteLabelUi")).toBe(false);
    expect(hasCapability("pro", "whiteLabelUi")).toBe(false);
    expect(hasCapability("label", "whiteLabelUi")).toBe(true);
    expect(minTierFor("whiteLabelUi")).toBe("label");
    expect(minTierFor("customDomain")).toBe("label");
  });

  it("reserves staff, AI and reporting for Pro and up", () => {
    for (const cap of ["schedule", "payroll", "timeClock", "agent", "reports", "aiReceptionist"] as CapabilityKey[]) {
      expect(hasCapability("studio", cap), `${cap} must not ship on Studio`).toBe(false);
      expect(hasCapability("pro", cap), `${cap} must ship on Pro`).toBe(true);
    }
  });

  it("unlocks everything at the top tier", () => {
    const all = new Set<CapabilityKey>();
    for (const t of SELLABLE_TIERS) for (const c of capabilitiesForTier(t)) all.add(c);
    for (const c of all) expect(hasCapability("label", c), `label missing ${c}`).toBe(true);
  });

  it("reports the cheapest tier that unlocks a capability", () => {
    // Flow is parked, so Studio is again the cheapest sold tier.
    expect(minTierFor("bookings")).toBe("studio");
    expect(minTierFor("noShowShield")).toBe("studio");
    expect(minTierFor("reviewsReferrals")).toBe("studio");
    expect(minTierFor("discountCodes")).toBe("studio");
    expect(minTierFor("payroll")).toBe("pro");
    expect(minTierFor("patch")).toBe("label");
  });

  it("keeps the parked Flow tier scoped to the money loop", () => {
    for (const cap of ["bookings", "payments", "cardOnFile", "noShowShield", "dunning"] as CapabilityKey[]) {
      expect(hasCapability("flow", cap), `${cap} must ship on Flow`).toBe(true);
    }
    for (const cap of ["agent", "schedule", "reports", "clientPortal"] as CapabilityKey[]) {
      expect(hasCapability("flow", cap), `${cap} must not ship on Flow`).toBe(false);
    }
  });
});

describe("nav gating", () => {
  it("locks nav surfaces the tier did not buy", () => {
    const locked = lockedNavFeatures("studio");
    expect(locked).toContain("patch");
    expect(locked).toContain("schedule");
    expect(locked).not.toContain("bookings");
    expect(lockedNavFeatures("label")).toEqual([]);
  });

  it("merges operator toggles with tier locks, and toggles cannot unlock", () => {
    // The operator switched off Reports; the tier already locked Patch.
    const eff = effectiveDisabledFeatures("pro", ["reports"]);
    expect(eff).toContain("reports");
    expect(eff).toContain("patch");
    // An operator cannot hand a Pro-tier org a capability it never bought,
    // because the tier locks are unioned in, never subtracted.
    const cannotUnlock = effectiveDisabledFeatures("pro", []);
    expect(cannotUnlock).toContain("patch");
  });

  it("never disables a core module, whatever the stored list says", () => {
    // A stale or hand-edited row must not be able to leave a studio unable to
    // take a booking or see it on a calendar.
    const eff = effectiveDisabledFeatures("label", ["bookings", "calendar"]);
    expect(eff).not.toContain("bookings");
    expect(eff).not.toContain("calendar");
  });

  it("ignores unknown keys in a toggle list", () => {
    const eff = effectiveDisabledFeatures("label", ["not_a_feature"]);
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
    expect(tierForPlan(undefined)).toBe("studio");
    expect(tierForPlan("nonsense")).toBe("studio");
    expect(tierForPlan("agency_plus")).toBe("agency");
  });

  it("resolves the demo sandbox at the top tier", async () => {
    const t = convexTest(schema);
    expect(await t.run((ctx) => tierForOrg(ctx, DEMO_ORG))).toBe("label");
  });

  it("reads orgs.tier when set", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: "o1", name: "A", slug: "a", plan: "solo", tier: "label" }),
    );
    expect(await t.run((ctx) => tierForOrg(ctx, "o1"))).toBe("label");
  });

  it("falls back to orgs.plan for legacy rows with no tier", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "legacy_solo", name: "S", slug: "s", plan: "solo" });
      await ctx.db.insert("orgs", { orgId: "legacy_studio", name: "T", slug: "t", plan: "studio" });
      await ctx.db.insert("orgs", { orgId: "legacy_label", name: "L", slug: "l", plan: "label" });
    });
    expect(await t.run((ctx) => tierForOrg(ctx, "legacy_solo"))).toBe("studio");
    expect(await t.run((ctx) => tierForOrg(ctx, "legacy_studio"))).toBe("pro");
    expect(await t.run((ctx) => tierForOrg(ctx, "legacy_label"))).toBe("label");
  });

  it("lets an agency plan override the org's own tier", async () => {
    const t = convexTest(schema);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "ag1", name: "Ag", slug: "ag", plan: "label", status: "active",
        ownerClerkUserId: "u_ag_owner", ownerEmail: "ag@example.com",
      });
      await ctx.db.insert("orgs", {
        orgId: "sub1", name: "Sub", slug: "sub", plan: "solo", tier: "studio", agencyId: "ag1",
      });
    });
    expect(await t.run((ctx) => tierForOrg(ctx, "sub1"))).toBe("label");
  });

  it("treats a missing org row as the least privileged tier", async () => {
    const t = convexTest(schema);
    expect(await t.run((ctx) => tierForOrg(ctx, "ghost"))).toBe("studio");
  });
});

describe("hard gate", () => {
  it("throws UPGRADE_REQUIRED with the tier that unlocks it", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: "o2", name: "B", slug: "b", plan: "solo", tier: "studio" }),
    );
    await expect(
      t.run((ctx) => requireFeature(ctx, "o2", "payroll")),
    ).rejects.toMatchObject({
      data: {
        code: "UPGRADE_REQUIRED",
        capability: "payroll",
        currentTier: "studio",
        requiredTier: "pro",
        price: "$297.00",
      },
    });
  });

  it("passes for a capability the tier owns", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("orgs", { orgId: "o3", name: "C", slug: "c", plan: "solo", tier: "studio" }),
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
    expect(PLAN_LIMITS.studio.whitelabel).toBe(false);
    expect(PLAN_LIMITS.pro.whitelabel).toBe("studio_level");
    expect(PLAN_LIMITS.label.whitelabel).toBe("full");
  });

  it("ranks tiers for at-least comparisons", () => {
    expect(tierAtLeast("label", "pro")).toBe(true);
    expect(tierAtLeast("studio", "pro")).toBe(false);
    expect(tierAtLeast("pro", "pro")).toBe(true);
  });
});

describe("the take rate is actually taken", () => {
  it("charges a platform fee only on the payments-monetized plan", () => {
    // 2% of a $500 deposit.
    expect(takeCents("flow", 50_000)).toBe(1_000);
    // Subscription plans pay monthly and must never ALSO be charged a
    // percentage of what they collect.
    for (const t of ["studio", "pro", "label"] as const) {
      expect(takeCents(t, 50_000), `${t} must take nothing per transaction`).toBe(0);
    }
  });

  it("rounds the fee to whole cents", () => {
    // Stripe rejects a fractional application_fee_amount.
    const fee = takeCents("flow", 3_333);
    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(67);
  });

  it("takes nothing from a zero-value charge", () => {
    expect(takeCents("flow", 0)).toBe(0);
  });
});
