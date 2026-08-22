import { describe, it, expect } from "vitest";
import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  earlyAdopterApplies,
  earlyAdopterPriceCents,
} from "@convex/lib/plans";
import { marketingTiers, fromPriceLabel } from "./pricing-tiers";

/* The public price tiles were hand-typed for months and every field drifted:
   $49/$129/$199 against "Solo / Studio / Label", and the top tile checking
   out on `growth` - a legacy tier that grants less than the Label it was
   advertising. These tests are the reason it cannot happen again. */

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

describe("the public price tiles", () => {
  const tiers = marketingTiers();

  it("shows exactly the tiers we sell, cheapest first", () => {
    expect(tiers.map((t) => t.tier)).toEqual(SELLABLE_TIERS);
  });

  it("never checks out on a legacy or non-public tier", () => {
    for (const t of tiers) {
      expect(PLAN_LIMITS[t.tier].publicTier).toBe(true);
      expect(t.tier).not.toBe("growth");
      expect(t.tier).not.toBe("agency");
    }
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
