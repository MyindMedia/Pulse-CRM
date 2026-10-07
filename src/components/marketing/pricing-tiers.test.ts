import { describe, it, expect } from "vitest";
import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  earlyAdopterApplies,
  earlyAdopterPriceCents,
} from "@convex/lib/plans";
import { formatUsd } from "@convex/lib/pricing";
import { marketingTiers, fromPriceLabel } from "./pricing-tiers";

/* The public price tiles were hand-typed for months and every field drifted.
   These tests hold them to the pricing config so it cannot happen again. */

const money = formatUsd;

describe("the public price tiles", () => {
  const tiers = marketingTiers();

  it("shows exactly the tiers we sell, cheapest first", () => {
    expect(tiers.map((t) => t.tier)).toEqual(SELLABLE_TIERS);
  });

  it("only ever checks out on core, growth or max", () => {
    for (const t of tiers) expect(["core", "growth", "max"]).toContain(t.tier);
  });

  it("names each tile the way the plan book names the tier", () => {
    for (const t of tiers) {
      expect(t.name).toBe(PLAN_LIMITS[t.tier].label);
      expect(t.tagline).toBe(PLAN_LIMITS[t.tier].tagline);
    }
  });

  it("quotes the price the till will actually charge", () => {
    for (const t of tiers) {
      const intro = earlyAdopterApplies(t.tier, "month");
      const headline = intro
        ? earlyAdopterPriceCents(t.tier)
        : PLAN_LIMITS[t.tier].priceCents;
      expect(t.price).toBe(money(headline));
    }
  });

  it("never shows an intro price without the step-up beside it", () => {
    for (const t of tiers) {
      if (t.introBadge) {
        expect(t.stepUp).toContain(money(PLAN_LIMITS[t.tier].priceCents));
      } else {
        expect(t.stepUp).toBeNull();
        expect(t.price).toBe(money(PLAN_LIMITS[t.tier].priceCents));
      }
    }
  });

  it("gives every tile something to say", () => {
    for (const t of tiers) expect(t.features.length).toBeGreaterThan(0);
  });

  it("features exactly one tile", () => {
    expect(tiers.filter((t) => t.featured)).toHaveLength(1);
  });
});

describe("the entry price in metadata", () => {
  it("matches the cheapest tile, so a search result cannot quote a dead price", () => {
    const cheapest = marketingTiers()[0];
    expect(fromPriceLabel()).toBe(`From ${cheapest.price}/mo`);
  });
});
