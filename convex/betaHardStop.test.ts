import { describe, it, expect } from "vitest";
import { evaluateBillingGate } from "./lib/billingGate";
import {
  annualPriceCents, annualPerMonthCents, annualSavingCents,
  priceLabelFor, ANNUAL_MONTHS_FREE, PLAN_LIMITS,
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

  /* A Beta-plan studio (auto-enrolled, no cohort flag) that subscribed through
     the beta checkout and then canceled. The Beta plan costs nothing, so the
     canceled paywall (price > 0) never fired and the studio kept the app for
     free forever. Once its beta window has passed it is beta_expired. */
  it("locks a canceled Beta-plan studio once its beta window has passed", () => {
    const betaPlan = { ...plan, isBeta: true };
    const canceled = {
      billingStatus: "canceled" as const,
      agencyPlanId: "plan1" as never,
      billingSubscriptionId: "sub_beta",
      trialEndsAt: NOW - DAY,
    };
    const gate = evaluateBillingGate(canceled, betaPlan, NOW);
    expect(gate.locked).toBe(true);
    expect(gate.reason).toBe("beta_expired");
    // Still inside the window: canceling early does not cut the beta short.
    expect(evaluateBillingGate({ ...canceled, trialEndsAt: NOW + DAY }, betaPlan, NOW).locked).toBe(false);
    // A graduated studio is on the terms it was moved to.
    expect(evaluateBillingGate({ ...canceled, graduatedAt: NOW - 2 * DAY }, betaPlan, NOW).reason).not.toBe("beta_expired");
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
  it("a year costs ten months: two months free", () => {
    expect(ANNUAL_MONTHS_FREE).toBe(2);
    // Growth: $297 x 12 = $3,564. A year is $2,970, saving $594.
    expect(annualPriceCents("growth")).toBe(297_000);
    expect(annualSavingCents("growth")).toBe(59_400);
  });

  it("every tier's annual price is ten times its monthly price", () => {
    for (const t of ["core", "growth", "max"] as const) {
      const monthly = PLAN_LIMITS[t].priceCents;
      expect(annualPriceCents(t)).toBe(monthly * 10);
      // The per-month figure is what people actually compare against.
      expect(annualPerMonthCents(t)).toBeLessThan(monthly);
    }
  });

  it("formats both intervals", () => {
    expect(priceLabelFor("core", "month")).toBe("$149");
    expect(priceLabelFor("core", "year")).toBe("$1,490");
    expect(priceLabelFor("max", "year")).toBe("$6,990");
  });
});
