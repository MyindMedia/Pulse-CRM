import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALL_FEATURES,
  ALLOWANCES,
  CAPABILITY_KEYS,
  CAPABILITY_TIER,
  EXISTING_GROUPS,
  FEATURE_GROUPS,
  NOT_BUILT_YET,
  PRICING,
  PULSE_APP_CAPABILITIES,
  STRIPE_PRICE_ENV,
  TIERS,
  TIER_ACCESS,
  TIER_ROLES,
  UNLIMITED,
  UNMETERED,
  featureTier,
  featuresForTier,
  featuresIncludedIn,
  publicFeatureGroups,
  tierAtLeast,
  tierRank,
  tierTotals,
} from "./lib/pricing";

/* The pricing config is the single source of truth for the ladder. These
   tests pin it to the approved checklist (openspec/changes/
   core-growth-max-pricing) so a later edit cannot quietly move a feature,
   change a price, or leak an internal note onto a public page. */

describe("tiers", () => {
  it("are core, growth and max, cheapest first", () => {
    expect(TIERS).toEqual(["core", "growth", "max"]);
    expect(tierRank("core")).toBe(0);
    expect(tierRank("max")).toBe(2);
    expect(tierRank("not-a-tier")).toBe(0);
    expect(tierAtLeast("max", "growth")).toBe(true);
    expect(tierAtLeast("core", "growth")).toBe(false);
  });

  it("are priced as approved, annual is ten months", () => {
    expect([PRICING.core.monthlyUsd, PRICING.growth.monthlyUsd, PRICING.max.monthlyUsd]).toEqual([149, 297, 699]);
    expect([PRICING.core.annualUsd, PRICING.growth.annualUsd, PRICING.max.annualUsd]).toEqual([1490, 2970, 6990]);
    for (const t of TIERS) {
      expect(PRICING[t].monthlyCents).toBe(PRICING[t].monthlyUsd * 100);
      expect(PRICING[t].annualCents).toBe(PRICING[t].annualUsd * 100);
      expect(PRICING[t].annualCents).toBe(PRICING[t].monthlyCents * 10);
    }
    expect([PRICING.core.name, PRICING.growth.name, PRICING.max.name]).toEqual(["Core", "Growth", "Max"]);
  });

  it("gives Max unlimited studios with no per-studio price", () => {
    expect(PRICING.max.unlimitedStudios).toBe(true);
    expect(PRICING.core.unlimitedStudios).toBe(false);
    expect(ALLOWANCES.max.studios).toBe(UNLIMITED);
    expect(Object.keys(PRICING.max).some((k) => /perStudio|seat/i.test(k))).toBe(false);
  });

  it("names the six Stripe price env vars", () => {
    expect(Object.values(STRIPE_PRICE_ENV).flatMap((m) => Object.values(m)).sort()).toEqual([
      "STRIPE_PRICE_CORE_ANNUAL", "STRIPE_PRICE_CORE_MONTHLY",
      "STRIPE_PRICE_GROWTH_ANNUAL", "STRIPE_PRICE_GROWTH_MONTHLY",
      "STRIPE_PRICE_MAX_ANNUAL", "STRIPE_PRICE_MAX_MONTHLY",
    ]);
  });
});

describe("the feature list", () => {
  it("has the 14 original groups plus the new 15th", () => {
    expect(EXISTING_GROUPS).toHaveLength(14);
    expect(FEATURE_GROUPS).toHaveLength(15);
    expect(FEATURE_GROUPS[14].isNew).toBe(true);
    expect(FEATURE_GROUPS[14].title).toBe("Production, media and gear check-out");
  });

  it("totals Core 76 / Growth 49 / Max 30 over the 155 existing features", () => {
    const totals = tierTotals(EXISTING_GROUPS);
    // Actual computed totals, asserted exactly:
    expect(totals).toEqual({ core: 76, growth: 49, max: 30 });
    expect(totals.core + totals.growth + totals.max).toBe(155);
  });

  it("keeps the group sizes from the checklist", () => {
    expect(EXISTING_GROUPS.map((g) => g.items.length)).toEqual([16, 16, 7, 10, 11, 9, 11, 10, 16, 8, 7, 11, 11, 12]);
  });

  it("marks the eight moved features", () => {
    const moved = ALL_FEATURES.filter((f) => f.moved).map((f) => `${f.name} -> ${f.tier}`).sort();
    expect(moved).toEqual([
      "A map of the cables -> growth",
      "Daily summary -> core",
      "Google Calendar, both ways -> core",
      "Look up what a socket does -> growth",
      "Other calendars mark hours busy -> core",
      "Send from your own Gmail -> core",
      "Software subscriptions -> growth",
      "Studio health score -> core",
    ]);
  });

  it("places the three new features on Growth with Max cross-studio adds", () => {
    expect(featureTier("Post-production project tracking")).toBe("growth");
    expect(featureTier("Media file management with version control")).toBe("growth");
    expect(featureTier("Barcode equipment check-in and check-out")).toBe("growth");
    expect(featureTier("Projects across every studio")).toBe("max");
    expect(featureTier("One media library shared across studios")).toBe("max");
  });

  it("gives a name that appears twice the same tier both times", () => {
    const byName = new Map<string, Set<string>>();
    for (const f of ALL_FEATURES) byName.set(f.name, (byName.get(f.name) ?? new Set()).add(f.tier));
    for (const [name, tiers] of byName) expect(tiers.size, name).toBe(1);
    // The only duplicate is the reseller price list, listed under Money and
    // under Running many studios.
    const dupes = [...byName.keys()].filter((n) => ALL_FEATURES.filter((f) => f.name === n).length > 1);
    expect(dupes).toEqual(["Your own price list"]);
  });

  it("answers featureTier, featuresForTier and featuresIncludedIn", () => {
    expect(featureTier("Payroll")).toBe("growth");
    expect(featureTier("No such feature")).toBeNull();
    expect(featuresForTier("max").every((f) => f.tier === "max")).toBe(true);
    expect(featuresIncludedIn("growth").length).toBe(
      featuresForTier("core").length + featuresForTier("growth").length,
    );
    expect(featuresIncludedIn("max", { builtOnly: true }).every((f) => f.built)).toBe(true);
  });

  it("only gates on capabilities that exist", () => {
    for (const f of ALL_FEATURES) if (f.gate) expect(CAPABILITY_KEYS).toContain(f.gate);
  });
});

describe("the public table", () => {
  const groups = publicFeatureGroups();
  const text = JSON.stringify(groups);

  it("carries no internal sales notes or gates", () => {
    for (const g of groups) {
      expect(Object.keys(g).sort()).toEqual(["id", "items", "title"]);
      for (const f of g.items) expect(Object.keys(f).sort()).toEqual(["detail", "name", "tier"]);
    }
    for (const g of FEATURE_GROUPS) expect(text).not.toContain(g.salesNote);
  });

  it("never lists a not-built-yet item", () => {
    expect(NOT_BUILT_YET).toHaveLength(9);
    for (const item of NOT_BUILT_YET) expect(text).not.toContain(item);
  });

  it("hides a feature until it is built", () => {
    const unbuilt = ALL_FEATURES.filter((f) => !f.built);
    for (const f of unbuilt) expect(groups.flatMap((g) => g.items).map((x) => x.name)).not.toContain(f.name);
    // All 155 existing features are built and public.
    expect(groups.filter((g) => g.id !== "production").flatMap((g) => g.items)).toHaveLength(155);
  });

  it("never says CRM, and uses no em dashes, anywhere in the config", () => {
    const all = JSON.stringify({ PRICING, FEATURE_GROUPS, TIER_ACCESS, PULSE_APP_CAPABILITIES });
    expect(all).not.toMatch(/\bCRM\b/i);
    expect(all).not.toContain("—");
  });
});

describe("allowances", () => {
  it("leave texts and email unmetered on every tier", () => {
    expect(UNMETERED).toEqual(["texts", "email"]);
    for (const t of TIERS) {
      const keys = Object.keys(ALLOWANCES[t]).join(" ");
      expect(keys).not.toMatch(/sms|text|email/i);
    }
  });

  it("never step down from one tier to the next", () => {
    const numeric = ["assistantPerMonth", "storageGb", "rooms", "staff", "studios", "inviteLinksPerMonth", "socialAccounts", "socialPostsPerMonth"] as const;
    for (const k of numeric) {
      expect(ALLOWANCES.growth[k], k).toBeGreaterThanOrEqual(ALLOWANCES.core[k]);
      expect(ALLOWANCES.max[k], k).toBeGreaterThanOrEqual(ALLOWANCES.growth[k]);
    }
  });

  it("sells roles by tier: Core has no manager, Growth and Max have all five", () => {
    expect(TIER_ROLES.core).not.toContain("manager");
    expect(TIER_ROLES.growth).toEqual(["owner", "manager", "engineer", "staff", "guest"]);
    expect(TIER_ROLES.max).toEqual(TIER_ROLES.growth);
  });
});

describe("the Pulse app", () => {
  it("lists something on every tier and nothing that is not built", () => {
    for (const t of TIERS) expect(PULSE_APP_CAPABILITIES[t].length).toBeGreaterThan(0);
    const all = Object.values(PULSE_APP_CAPABILITIES).flat().join(" ");
    // Blocked or unbuilt on the phone today (pulse-native docs/WEB_PARITY.md).
    expect(all).not.toMatch(/barcode|scan|project status|approve .*draft|gear photo/i);
  });
});

describe("the Stripe scripts agree with the config", () => {
  for (const file of ["scripts/stripe-create-products.mjs", "scripts/verify-go-live.mjs"]) {
    it(file, () => {
      const src = readFileSync(file, "utf8");
      for (const t of TIERS) {
        for (const [interval, cents] of [["MONTHLY", PRICING[t].monthlyCents], ["ANNUAL", PRICING[t].annualCents]] as const) {
          const env = `STRIPE_PRICE_${t.toUpperCase()}_${interval}`;
          const line = src.split("\n").find((l) => l.includes(`"${env}"`) && l.includes("cents"));
          expect(line, `${file} has no line for ${env}`).toBeTruthy();
          expect(line).toContain(`cents: ${cents}`);
        }
      }
    });
  }
});

describe("feature explainers (the drop downs on /pricing)", () => {
  const all = FEATURE_GROUPS.flatMap((g) => g.items.map((x) => ({ g, x })));
  const LONG_DASH = /[\u2013\u2014]/;
  // Words the copy rules forbid: the customer-relationship acronym, rival
  // product names, and hype words.
  const BANNED_WORDS = [
    "crm", "seamless", "seamlessly", "powerful", "revolutionary", "effortless",
    "effortlessly", "cutting-edge", "game-changing", "supercharge", "unlock",
    "leverage", "robust", "streamline", "world-class", "best-in-class",
    "studiobricks", "bandlab", "soundtrap", "splice", "hubspot", "salesforce",
    "acuity", "calendly", "squarespace", "mindbody",
  ];
  const BRITISH = [/colour/i, /cancelled/i, /organis/i, /centre\b/i, /favour/i, /catalogue/i];

  it("every feature has a non-empty what, does and tiers", () => {
    for (const { g, x } of all) {
      const label = `${g.id}: ${x.name}`;
      expect(x.detail, label).toBeTruthy();
      expect(x.detail.what.trim().length, `${label} what`).toBeGreaterThan(15);
      expect(x.detail.does.trim().length, `${label} does`).toBeGreaterThan(30);
      expect(x.detail.tiers.trim().length, `${label} tiers`).toBeGreaterThan(10);
    }
  });

  it("no long dashes, banned words, hype or British spellings", () => {
    for (const { g, x } of all) {
      const text = `${x.detail.what} ${x.detail.does} ${x.detail.tiers}`;
      const label = `${g.id}: ${x.name}`;
      expect(LONG_DASH.test(text), `${label} has a long dash`).toBe(false);
      const lower = text.toLowerCase();
      for (const w of BANNED_WORDS) {
        expect(new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(lower), `${label} uses "${w}"`).toBe(false);
      }
      for (const re of BRITISH) expect(re.test(text), `${label} British spelling ${re}`).toBe(false);
    }
  });

  it("the plan line matches the capability tier and the feature tier", () => {
    const name = (t: "core" | "growth" | "max") => PRICING[t].name;
    for (const { g, x } of all) {
      const label = `${g.id}: ${x.name}`;
      if (x.gate) expect(CAPABILITY_TIER[x.gate], `${label} gate tier`).toBe(x.tier);
      const first = x.detail.tiers;
      if (x.tier === "core") {
        expect(first, label).toContain("every plan");
        expect(first, label).toContain(name("core"));
      } else if (x.tier === "growth") {
        expect(first, label).toContain(`${name("growth")} and ${name("max")}`);
        expect(first, label).toContain(`Not included on ${name("core")}`);
      } else {
        expect(first, label).toContain(`${name("max")} only`);
      }
    }
  });

  it("limits quoted in the plan line come from ALLOWANCES", () => {
    const find = (n: string) => FEATURE_GROUPS.flatMap((g) => g.items).find((x) => x.name === n)!;
    expect(find("Rooms").detail.tiers).toContain(`Rooms: ${ALLOWANCES.core.rooms} on ${PRICING.core.name}`);
    const agent = find("Pulse Agent").detail.tiers;
    expect(agent).toContain(`${ALLOWANCES.growth.assistantPerMonth} on ${PRICING.growth.name}`);
    expect(agent).toContain(`${ALLOWANCES.max.assistantPerMonth} on ${PRICING.max.name}`);
    expect(agent.split("Assistant credits")[1]).not.toContain(`on ${PRICING.core.name}`);
  });

  it("the public table carries the same detail", () => {
    for (const g of publicFeatureGroups()) {
      for (const x of g.items) expect(x.detail.what.length).toBeGreaterThan(0);
    }
  });
});
