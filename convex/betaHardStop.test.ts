import { describe, it, expect } from "vitest";
import { evaluateBillingGate } from "./lib/billingGate";
import {
  annualPriceCents, annualPerMonthCents, annualSavingCents,
  priceLabelFor, ANNUAL_DISCOUNT_PCT, PLAN_LIMITS,
} from "./lib/plans";

/* A beta licence is a promise with an end date. These tests hold both halves:
   it really does stop, and subscribing really does clear it. */

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const plan = {
  priceCents: 0,
  trialDays: 0,
  // The shared agency plan these studios sit on. A beta year must end
  // regardless of what this says, which is the whole point of the test.
  requireCardAfterTrial: false,
};

const betaOrg = (over: Record<string, unknown> = {}) => ({
  billingStatus: "trialing" as const,
  agencyPlanId: "plan1" as never,
  betaCohort: true,
  betaLicenseUntil: NOW - DAY, // ended yesterday
  ...over,
});

describe("the beta year actually stops", () => {
  it("locks once the licence date passes", () => {
    const gate = evaluateBillingGate(betaOrg(), plan, NOW);
    expect(gate.locked).toBe(true);
    expect(gate.reason).toBe("beta_expired");
  });

  it("stops even though the shared plan does not require a card", () => {
    // requireCardAfterTrial is false above. If the beta stop deferred to the
    // plan, this would pass straight through unlocked.
    expect(evaluateBillingGate(betaOrg(), plan, NOW).locked).toBe(true);
  });

  it("stops even with no agency plan at all", () => {
    // A studio that claimed its workspace from an invite has no plan, and
    // would otherwise fall through to "no_plan" and never lock.
    const gate = evaluateBillingGate(
      betaOrg({ agencyPlanId: undefined, billingStatus: undefined }),
      null,
      NOW,
    );
    expect(gate.locked).toBe(true);
    expect(gate.reason).toBe("beta_expired");
  });

  it("does not lock while the licence is still running", () => {
    const gate = evaluateBillingGate(
      betaOrg({ betaLicenseUntil: NOW + 30 * DAY, trialEndsAt: NOW + 30 * DAY }),
      plan,
      NOW,
    );
    expect(gate.locked).toBe(false);
    expect(gate.inTrial).toBe(true);
  });

  it("clears the moment they subscribe", () => {
    const gate = evaluateBillingGate(betaOrg({ billingStatus: "active" }), plan, NOW);
    expect(gate.locked).toBe(false);
    expect(gate.reason).toBe("active");
  });

  it("does not lock a studio that graduated onto a paid tier", () => {
    /* graduateBeta keeps betaCohort (provenance) and never rewinds
       betaLicenseUntil, so the old date still passes. Without the graduatedAt
       check the studio gets locked out for having upgraded. */
    const gate = evaluateBillingGate(
      betaOrg({ graduatedAt: NOW - 10 * DAY, billingStatus: "trialing", trialEndsAt: NOW + 5 * DAY }),
      plan,
      NOW,
    );
    expect(gate.locked).toBe(false);
    expect(gate.reason).not.toBe("beta_expired");
  });

  it("leaves a non-beta comped studio alone", () => {
    const gate = evaluateBillingGate(
      { billingStatus: "comped", agencyPlanId: "plan1" as never },
      plan,
      NOW,
    );
    expect(gate.locked).toBe(false);
    expect(gate.reason).toBe("comped");
  });
});

describe("annual billing", () => {
  it("takes 15% off twelve months", () => {
    expect(ANNUAL_DISCOUNT_PCT).toBe(15);
    // Pro: $297 x 12 = $3,564. Less 15% = $3,029.40, saving $534.60.
    expect(annualPriceCents("pro")).toBe(302_940);
    expect(annualSavingCents("pro")).toBe(53_460);
  });

  it("is derived from the monthly price, so a repricing cannot leave it stale", () => {
    for (const t of ["studio", "pro", "label"] as const) {
      const monthly = PLAN_LIMITS[t].priceCents;
      expect(annualPriceCents(t)).toBe(Math.round(monthly * 12 * 0.85));
      // The per-month figure is what people actually compare against.
      expect(annualPerMonthCents(t)).toBeLessThan(monthly);
    }
  });

  it("formats both intervals", () => {
    expect(priceLabelFor("studio", "month")).toBe("$149.99");
    expect(priceLabelFor("studio", "year")).toBe("$1,529.90");
  });
});
