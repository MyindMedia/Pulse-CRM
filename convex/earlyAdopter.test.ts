import { describe, it, expect } from "vitest";
import {
  PLAN_LIMITS, SELLABLE_TIERS, EARLY_ADOPTER_MONTHS, EARLY_ADOPTER_DISCOUNT_PCT,
  earlyAdopterPriceCents, earlyAdopterApplies, earlyAdopterLabel,
} from "./lib/plans";
import { inIntroWindow, currentPriceCents, DAY_MS } from "./lib/billingGate";

/* The launch offer. Two things have to hold or it stops being an offer and
   starts being a complaint: it must actually be cheaper, and it must step
   back up on its own. */

describe("early adopter pricing", () => {
  it("is cheaper than the regular price on every sellable tier", () => {
    for (const t of SELLABLE_TIERS) {
      const intro = earlyAdopterPriceCents(t);
      expect(intro).toBeGreaterThan(0);
      expect(intro).toBeLessThan(PLAN_LIMITS[t].priceCents);
    }
  });

  it("lands on the prices we actually advertise", () => {
    // Half of 149.99 / 297.00 / 499.99, floored to keep the .99 endings.
    expect(earlyAdopterPriceCents("studio")).toBe(7499);
    expect(earlyAdopterPriceCents("pro")).toBe(14850);
    expect(earlyAdopterPriceCents("label")).toBe(24999);
  });

  it("is derived, so a reprice cannot leave it stale", () => {
    for (const t of SELLABLE_TIERS) {
      const expected = Math.floor(
        (PLAN_LIMITS[t].priceCents * (100 - EARLY_ADOPTER_DISCOUNT_PCT)) / 100,
      );
      expect(earlyAdopterPriceCents(t)).toBe(expected);
    }
  });

  it("never applies to yearly", () => {
    /* Stripe counts a repeating discount in months, so 3 months against a
       yearly subscription discounts that year's single invoice - twelve
       months at half price instead of three. */
    for (const t of SELLABLE_TIERS) {
      expect(earlyAdopterApplies(t, "month")).toBe(true);
      expect(earlyAdopterApplies(t, "year")).toBe(false);
    }
  });

  it("never applies to a tier that is not sold", () => {
    expect(earlyAdopterApplies("enterprise", "month")).toBe(false);
    expect(earlyAdopterApplies("flow", "month")).toBe(false);
  });

  it("quotes the step-up alongside the intro price", () => {
    const label = earlyAdopterLabel("studio");
    expect(label).toContain("$74.99");
    expect(label).toContain("$149.99");   // the number people need to see
    expect(label).toContain(String(EARLY_ADOPTER_MONTHS));
  });
});

describe("the intro window closes", () => {
  const NOW = 1_800_000_000_000;
  const plan = {
    requireCardAfterTrial: true,
    priceCents: 14999,
    introPriceCents: 7499,
    introMonths: 3,
  };

  it("charges the intro price inside the window", () => {
    const paidSince = NOW - 30 * DAY_MS;
    expect(inIntroWindow(plan, paidSince, NOW)).toBe(true);
    expect(currentPriceCents(undefined, plan, paidSince, NOW)).toBe(7499);
  });

  it("steps up to the regular price after it", () => {
    const paidSince = NOW - 100 * DAY_MS; // past 3 x 30 days
    expect(inIntroWindow(plan, paidSince, NOW)).toBe(false);
    expect(currentPriceCents(undefined, plan, paidSince, NOW)).toBe(14999);
  });

  it("does not start before they have paid for anything", () => {
    expect(inIntroWindow(plan, undefined, NOW)).toBe(false);
    expect(currentPriceCents(undefined, plan, undefined, NOW)).toBe(14999);
  });

  it("an agency's hand-set override still beats the intro price", () => {
    const paidSince = NOW - 10 * DAY_MS;
    expect(currentPriceCents(5000, plan, paidSince, NOW)).toBe(5000);
  });

  it("a plan with no intro fields just charges its price", () => {
    const plain = {
      requireCardAfterTrial: true, priceCents: 29700,
      introPriceCents: undefined, introMonths: undefined,
    };
    expect(inIntroWindow(plain, NOW - DAY_MS, NOW)).toBe(false);
    expect(currentPriceCents(undefined, plain, NOW - DAY_MS, NOW)).toBe(29700);
  });
});
