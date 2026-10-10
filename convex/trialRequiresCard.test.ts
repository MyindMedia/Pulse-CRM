import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { evaluateBillingGate, DAY_MS } from "./lib/billingGate";
import {
  buildSubscriptionCheckoutParams,
  initialBillingFor,
  isDuplicateSubscription,
  isGrandfatheredCardFreeTrial,
  orgPatchFromSubscription,
  trialSpec,
  MIN_TRIAL_END_LEAD_MS,
} from "./lib/trialCheckout";
import { needsTrialCheckout, trialForOrg } from "./agencyBilling";
import { warningMarkFor } from "./betaClock";
import { PLATFORM_TRIAL_DAYS, BETA_TERM_DAYS } from "./lib/pricing";
import { BETA_PLAN_NAME, betaTermMs } from "./lib/plans";

/* Owner rule, 2026-10-07: "For the pricing for trials, users must enter a
   card. It will auto charge on renewal after the trial period. Beta is the
   only one that doesn't require a payment, but will require payment after
   the term, 365 days." These tests hold every half of that sentence. */

/* ── A fake Stripe. Captures every checkout it is asked to create. ── */
const stripeCalls: { checkout: Record<string, unknown>[]; liveSubStatus: string | null } = {
  checkout: [],
  liveSubStatus: null,
};
vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    priceIdForTier: (tier: string, interval: string) => `price_${tier}_${interval}`,
    stripeClient: () => ({
      customers: { create: async () => ({ id: "cus_new" }) },
      coupons: { create: async () => ({ id: "coupon_x" }) },
      subscriptions: {
        retrieve: async (id: string) => {
          if (!stripeCalls.liveSubStatus) throw new Error("No such subscription");
          return { id, status: stripeCalls.liveSubStatus };
        },
      },
      checkout: {
        sessions: {
          create: async (params: Record<string, unknown>) => {
            stripeCalls.checkout.push(params);
            return { id: "cs_test", url: "https://checkout.stripe.test/cs_test" };
          },
        },
      },
    }),
  };
});

const NOW = 1_800_000_000_000;
const initT = () => convexTest(schema);
type TestT = ReturnType<typeof initT>;

/* ── 1. Checkout params: card always, trial days, cancel without a card ── */
describe("trial checkout params", () => {
  it("collects the card always, sets the trial days, and cancels a trial with no card", () => {
    const p = buildSubscriptionCheckoutParams({
      customer: "cus_1",
      lineItems: [{ price: "price_x", quantity: 1 }],
      trial: trialSpec({ trialDays: 14, now: NOW }),
      metadata: { kind: "subaccount_trial", orgId: "org_1" },
      successUrl: "https://x/ok",
      cancelUrl: "https://x/no",
    });
    expect(p.mode).toBe("subscription");
    expect(p.payment_method_collection).toBe("always");
    expect(p.subscription_data?.trial_period_days).toBe(14);
    expect(p.subscription_data?.trial_settings?.end_behavior.missing_payment_method).toBe("cancel");
    expect(p.subscription_data?.metadata).toEqual({ kind: "subaccount_trial", orgId: "org_1" });
    expect(p.metadata).toEqual({ kind: "subaccount_trial", orgId: "org_1" });
  });

  it("keeps a promised end date as trial_end, and drops it inside Stripe's 48-hour floor", () => {
    const at = NOW + 10 * DAY_MS;
    expect(trialSpec({ trialEndsAt: at, now: NOW })).toEqual({ kind: "until", at });
    const p = buildSubscriptionCheckoutParams({
      lineItems: [], trial: trialSpec({ trialEndsAt: at, now: NOW }), metadata: {}, successUrl: "", cancelUrl: "",
    });
    expect(p.subscription_data?.trial_end).toBe(Math.floor(at / 1000));
    expect(p.subscription_data?.trial_period_days).toBeUndefined();
    expect(trialSpec({ trialEndsAt: NOW + MIN_TRIAL_END_LEAD_MS - 1, now: NOW })).toEqual({ kind: "none" });
  });

  it("no trial still takes the card, and adds no trial fields", () => {
    const p = buildSubscriptionCheckoutParams({
      lineItems: [], trial: trialSpec({ trialDays: 0, now: NOW }), metadata: {}, successUrl: "", cancelUrl: "",
    });
    expect(p.payment_method_collection).toBe("always");
    expect(p.subscription_data?.trial_period_days).toBeUndefined();
    expect(p.subscription_data?.trial_settings).toBeUndefined();
  });

  it("the public Core/Growth/Max checkout starts a 14-day card-required trial", () => {
    expect(PLATFORM_TRIAL_DAYS).toBe(14);
    expect(trialSpec({ trialDays: PLATFORM_TRIAL_DAYS, now: NOW })).toEqual({ kind: "days", days: 14 });
  });

  it("routes paid trial plans through the trial checkout, never the beta", () => {
    const paid = { name: "Studio", priceCents: 9900, trialDays: 14, billingInterval: "month" as const, _id: "p" };
    const beta = { ...paid, name: BETA_PLAN_NAME, priceCents: 0, trialDays: 365 };
    expect(needsTrialCheckout({ plan: paid, billingStatus: "pending_card", billingSubscriptionId: null })).toBe(true);
    expect(needsTrialCheckout({ plan: paid, billingStatus: "trialing", billingSubscriptionId: null })).toBe(true);
    expect(needsTrialCheckout({ plan: paid, billingStatus: "trialing", billingSubscriptionId: "sub_1" })).toBe(false);
    expect(needsTrialCheckout({ plan: beta, billingStatus: "trialing", billingSubscriptionId: null })).toBe(false);
    expect(trialForOrg({ plan: paid, billingStatus: "pending_card", trialEndsAt: null }, NOW)).toEqual({ kind: "days", days: 14 });
    // Grandfathered: keeps the date already promised.
    const at = NOW + 5 * DAY_MS;
    expect(trialForOrg({ plan: paid, billingStatus: "trialing", trialEndsAt: at }, NOW)).toEqual({ kind: "until", at });
    // One trial per studio: coming back after a cancel bills on subscribe.
    expect(trialForOrg({ plan: paid, billingStatus: "canceled", trialEndsAt: at }, NOW)).toEqual({ kind: "none" });
  });

  it("a paid trial plan starts in pending_card, never trialing", () => {
    const t = initialBillingFor({ priceCents: 9900, trialDays: 14 }, false, NOW, DAY_MS);
    expect(t).toEqual({ billingStatus: "pending_card", trialStartedAt: undefined, trialEndsAt: undefined });
    expect(initialBillingFor({ priceCents: 0, trialDays: 30, isPromo: true }, false, NOW, DAY_MS)).toBeNull();
  });
});

/* ── 2. Webhook mirror: Stripe owns the trial ───────────────────────── */
async function seedAgency(t: TestT) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "org_ag", name: "AG", slug: "ag", plan: "max", status: "active",
      ownerClerkUserId: "u_agency", ownerEmail: "a@x",
    });
    const planId = await ctx.db.insert("agencyPlans", {
      agencyId: "org_ag", name: "Studio", priceCents: 9900, billingInterval: "month",
      trialDays: 14, requireCardAfterTrial: true, isPromo: false, isDefault: false,
      active: true, createdAt: 0,
    });
    const betaPlanId = await ctx.db.insert("agencyPlans", {
      agencyId: "org_ag", name: BETA_PLAN_NAME, priceCents: 0, billingInterval: "month",
      trialDays: 365, requireCardAfterTrial: false, isBeta: true, isPromo: true, isDefault: true,
      active: true, createdAt: 1,
    });
    await ctx.db.insert("orgs", {
      orgId: "org_s", name: "Studio S", slug: "s", tier: "growth", status: "active",
      agencyId: "org_ag", ownerEmail: "owner@s.com", ownerName: "Sam",
      agencyPlanId: planId, billingStatus: "pending_card",
    });
    await ctx.db.insert("members", {
      orgId: "org_s", name: "Sam", email: "owner@s.com", role: "owner", skills: [], clerkUserId: "u_s",
    });
    return { planId, betaPlanId };
  });
}

async function org(t: TestT, orgId = "org_s") {
  return (await t.run(async (ctx) => await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first()))!;
}

function subEvent(type: string, sub: Record<string, unknown>, id = `evt_${type}_${String(sub.id)}_${String(sub.status)}`) {
  return { id, type, data: { object: { object: "subscription", ...sub } } };
}

describe("no trial without a completed checkout; Stripe's trial end is mirrored", () => {
  let t: TestT;
  beforeEach(() => { t = initT(); stripeCalls.checkout = []; stripeCalls.liveSubStatus = null; });

  it("checkout.session.completed schedules the sync and starts nothing locally", async () => {
    await seedAgency(t);
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_cs_1", type: "checkout.session.completed",
        data: { object: { id: "cs_1", customer: "cus_s", subscription: "sub_1", metadata: { kind: "subaccount_trial", orgId: "org_s" } } },
      },
    });
    const o = await org(t);
    expect(o.billingStatus).toBe("pending_card");
    expect(o.trialEndsAt).toBeUndefined();
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("syncOrgSubscription"))).toBe(true);
    // No agency was provisioned from a studio's own checkout.
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies).toHaveLength(1);
  });

  it("subscription.created (trialing) mirrors Stripe's trial window and the saved card", async () => {
    await seedAgency(t);
    const start = Math.floor(Date.now() / 1000);
    const end = start + 14 * 86_400;
    await t.mutation(internal.billingWebhooks.handle, {
      event: subEvent("customer.subscription.created", {
        id: "sub_1", status: "trialing", customer: "cus_s", trial_start: start, trial_end: end,
        default_payment_method: "pm_1", metadata: { kind: "subaccount_trial", orgId: "org_s" },
      }),
    });
    const o = await org(t);
    expect(o.billingStatus).toBe("trialing");
    expect(o.trialEndsAt).toBe(end * 1000);
    expect(o.trialStartedAt).toBe(start * 1000);
    expect(o.billingSubscriptionId).toBe("sub_1");
    expect(o.billingCustomerId).toBe("cus_s");
    expect(o.paymentMethodOnFile).toBe(true);
    const gate = evaluateBillingGate(o, { requireCardAfterTrial: true, priceCents: 9900 }, Date.now());
    expect(gate.locked).toBe(false);
    expect(gate.inTrial).toBe(true);

    // Stripe moves the date (an extension): the mirror follows Stripe.
    await t.mutation(internal.billingWebhooks.handle, {
      event: subEvent("customer.subscription.updated", {
        id: "sub_1", status: "trialing", customer: "cus_s", trial_start: start, trial_end: end + 86_400,
        default_payment_method: "pm_1", metadata: { orgId: "org_s" },
      }, "evt_ext"),
    });
    expect((await org(t)).trialEndsAt).toBe((end + 86_400) * 1000);

    // Trial converts: Stripe charged the card.
    await t.mutation(internal.billingWebhooks.handle, {
      event: subEvent("customer.subscription.updated", {
        id: "sub_1", status: "active", customer: "cus_s", trial_start: start, trial_end: end + 86_400,
        default_payment_method: "pm_1", metadata: { orgId: "org_s" },
      }),
    });
    const paid = await org(t);
    expect(paid.billingStatus).toBe("active");
    expect(paid.paidSince).toBeGreaterThan(0);
  });

  it("a canceled Stripe subscription is a paywall, data kept", async () => {
    await seedAgency(t);
    await t.mutation(internal.billingWebhooks.handle, {
      event: subEvent("customer.subscription.deleted", {
        id: "sub_1", status: "canceled", customer: "cus_s", metadata: { orgId: "org_s" },
      }),
    });
    const o = await org(t);
    expect(o.billingStatus).toBe("canceled");
    const gate = evaluateBillingGate(o, { requireCardAfterTrial: true, priceCents: 9900 }, Date.now());
    expect(gate.locked).toBe(true);
    expect(gate.reason).toBe("canceled");
    expect(o.name).toBe("Studio S");
  });

  it("trial_will_end schedules the owner email, which is sent branded and recorded", async () => {
    await seedAgency(t);
    const end = Math.floor(Date.now() / 1000) + 3 * 86_400;
    await t.mutation(internal.billingWebhooks.handle, {
      event: subEvent("customer.subscription.trial_will_end", {
        id: "sub_1", status: "trialing", customer: "cus_s", trial_end: end, metadata: { orgId: "org_s" },
      }),
    });
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("notifyTrialWillEnd"))).toBe(true);

    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const r = await t.action(internal.trialBilling.notifyTrialWillEnd, { orgId: "org_s", trialEndMs: end * 1000 });
      expect(r.status).toBe("simulated");
    } finally {
      if (saved !== undefined) process.env.RESEND_API_KEY = saved;
    }
    expect((await org(t)).trialWillEndNotifiedAt).toBeGreaterThan(0);
    const acts = await t.run(async (ctx) => await ctx.db.query("activity").collect());
    expect(acts.some((a) => a.kind === "billing.trial_will_end")).toBe(true);
  });

  it("a connected-account subscription with an orgId never touches studio billing", async () => {
    await seedAgency(t);
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        ...subEvent("customer.subscription.updated", {
          id: "sub_x", status: "active", customer: "cus_x", metadata: { orgId: "org_s" },
        }),
        account: "acct_studio",
      },
    });
    expect((await org(t)).billingStatus).toBe("pending_card");
  });
});

/* ── 3. Double-charge guard ─────────────────────────────────────────── */
describe("double-charge guard", () => {
  let t: TestT;
  beforeEach(() => { t = initT(); stripeCalls.checkout = []; stripeCalls.liveSubStatus = null; });

  it("pure rule: a second live subscription is a duplicate", () => {
    expect(isDuplicateSubscription({ billingSubscriptionId: "sub_a", billingStatus: "trialing" }, { id: "sub_b", status: "trialing" })).toBe(true);
    expect(isDuplicateSubscription({ billingSubscriptionId: "sub_a", billingStatus: "active" }, { id: "sub_a", status: "active" })).toBe(false);
    expect(isDuplicateSubscription({ billingSubscriptionId: "sub_a", billingStatus: "canceled" }, { id: "sub_b", status: "active" })).toBe(false);
  });

  it("the webhook cancels a duplicate and keeps the first subscription", async () => {
    await seedAgency(t);
    await t.run(async (ctx) => {
      const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
      await ctx.db.patch(o!._id, { billingStatus: "trialing", billingSubscriptionId: "sub_a", paymentMethodOnFile: true });
    });
    await t.mutation(internal.billingWebhooks.handle, {
      event: subEvent("customer.subscription.created", {
        id: "sub_b", status: "trialing", customer: "cus_s", metadata: { orgId: "org_s" },
      }),
    });
    expect((await org(t)).billingSubscriptionId).toBe("sub_a");
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("_cancelDuplicateSubscription"))).toBe(true);
  });

  it("the agency cannot move a live-subscribed studio to another plan", async () => {
    const { planId } = await seedAgency(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_agency", email: "a@x", name: "A", role: "owner", status: "active", invitedAt: 0,
      });
      const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
      await ctx.db.patch(o!._id, { billingStatus: "active", billingSubscriptionId: "sub_a" });
    });
    const agency = t.withIdentity({ subject: "u_agency", name: "A", orgId: "org_ag", orgType: "agency" } as never);
    await expect(agency.mutation(api.agencyBilling.assignPlan, { orgId: "org_s", planId })).rejects.toThrow(/live Stripe subscription/);
  });
});

/* ── 4. Studio actions build the right checkout ─────────────────────── */
describe("studio checkouts", () => {
  let t: TestT;
  let savedKey: string | undefined;
  beforeEach(() => {
    t = initT();
    stripeCalls.checkout = [];
    stripeCalls.liveSubStatus = null;
    savedKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  });

  it("a studio with a live subscription cannot open a second checkout", async () => {
    await seedAgency(t);
    await t.run(async (ctx) => {
      const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
      await ctx.db.patch(o!._id, { betaCohort: true, betaLicenseUntil: Date.now() + 30 * DAY_MS, billingSubscriptionId: "sub_a", billingStatus: "trialing" });
    });
    stripeCalls.liveSubStatus = "trialing";
    const owner = t.withIdentity({ subject: "u_s", name: "Sam", email: "owner@s.com" });
    await expect(owner.action(api.billing.beginBetaConversionCheckout, { tier: "core", interval: "month" })).rejects.toThrow(/already has a subscription/);
    expect(stripeCalls.checkout).toHaveLength(0);
  });

  it("'add a card' on a paid trial plan opens a subscription checkout with the trial, card always", async () => {
    await seedAgency(t);
    const owner = t.withIdentity({ subject: "u_s", name: "Sam", email: "owner@s.com" });
    const r = await owner.action(api.agencyBilling.startMyPaymentSetup, {});
    expect(r.url).toContain("checkout.stripe.test");
    const p = stripeCalls.checkout[0] as {
      mode: string; payment_method_collection: string;
      subscription_data: { trial_period_days: number; trial_settings: { end_behavior: { missing_payment_method: string } } };
      metadata: Record<string, string>;
    };
    expect(p.mode).toBe("subscription");
    expect(p.payment_method_collection).toBe("always");
    expect(p.subscription_data.trial_period_days).toBe(14);
    expect(p.subscription_data.trial_settings.end_behavior.missing_payment_method).toBe("cancel");
    expect(p.metadata.kind).toBe("subaccount_trial");
    // Opening checkout starts nothing: the trial begins when it completes.
    expect((await org(t)).billingStatus).toBe("pending_card");
  });

  it("beta to paid before the term ends defers the first charge to the end date", async () => {
    await seedAgency(t);
    const until = Date.now() + 30 * DAY_MS;
    await t.run(async (ctx) => {
      const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
      await ctx.db.patch(o!._id, { betaCohort: true, betaLicenseUntil: until, billingStatus: "trialing" });
    });
    const owner = t.withIdentity({ subject: "u_s", name: "Sam", email: "owner@s.com" });
    const r = await owner.action(api.billing.beginBetaConversionCheckout, { tier: "growth", interval: "month" });
    expect(r.deferredUntil).toBe(until);
    const p = stripeCalls.checkout[0] as {
      payment_method_collection: string;
      subscription_data: { trial_end: number; trial_period_days?: number };
      metadata: Record<string, string>;
    };
    expect(p.payment_method_collection).toBe("always");
    expect(p.subscription_data.trial_end).toBe(Math.floor(until / 1000));
    expect(p.subscription_data.trial_period_days).toBeUndefined();
    expect(p.metadata).toMatchObject({ kind: "beta_conversion", orgId: "org_s", tier: "growth" });
  });

  it("beta to paid after the term charges on subscribe (no trial)", async () => {
    await seedAgency(t);
    await t.run(async (ctx) => {
      const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
      await ctx.db.patch(o!._id, { betaCohort: true, betaLicenseUntil: Date.now() - DAY_MS, billingStatus: "trialing" });
    });
    const owner = t.withIdentity({ subject: "u_s", name: "Sam", email: "owner@s.com" });
    const r = await owner.action(api.billing.beginBetaConversionCheckout, { tier: "core", interval: "year" });
    expect(r.deferredUntil).toBeNull();
    const p = stripeCalls.checkout[0] as { subscription_data: Record<string, unknown> };
    expect(p.subscription_data.trial_end).toBeUndefined();
    expect(p.subscription_data.trial_period_days).toBeUndefined();
  });
});

/* ── 5. Beta: untouched during the term, paywalled after it ─────────── */
describe("beta term and the end of it", () => {
  it("is 365 days for the default 12 months", () => {
    expect(BETA_TERM_DAYS).toBe(365);
    expect(betaTermMs(12)).toBe(365 * DAY_MS);
  });

  it("the Beta plan starts card-free and nothing else does", () => {
    const beta = initialBillingFor({ name: BETA_PLAN_NAME, priceCents: 0, trialDays: 365, isPromo: true }, false, NOW, DAY_MS);
    expect(beta).toEqual({ billingStatus: "trialing", trialStartedAt: NOW, trialEndsAt: NOW + 365 * DAY_MS });
  });

  it("cohort: open during the term, beta_expired paywall after, cleared by a subscription", () => {
    const base = { betaCohort: true, billingStatus: "trialing" as const, agencyPlanId: "p" };
    const plan = { requireCardAfterTrial: false, priceCents: 0 };
    expect(evaluateBillingGate({ ...base, betaLicenseUntil: NOW + DAY_MS }, plan, NOW).locked).toBe(false);
    const ended = evaluateBillingGate({ ...base, betaLicenseUntil: NOW - DAY_MS }, plan, NOW);
    expect(ended.locked).toBe(true);
    expect(ended.reason).toBe("beta_expired");
    // Subscribed early: Stripe is trialing toward the first charge. Not locked.
    expect(
      evaluateBillingGate({ ...base, betaLicenseUntil: NOW - DAY_MS, billingSubscriptionId: "sub_1" }, plan, NOW).locked,
    ).toBe(false);
  });

  it("an agency-enrolled Beta plan studio is paywalled after its window too", () => {
    const org = { billingStatus: "trialing" as const, agencyPlanId: "p", trialEndsAt: NOW - DAY_MS };
    const plan = { requireCardAfterTrial: false, priceCents: 0, name: BETA_PLAN_NAME };
    const g = evaluateBillingGate(org, plan, NOW);
    expect(g.locked).toBe(true);
    expect(g.reason).toBe("beta_expired");
    expect(evaluateBillingGate({ ...org, trialEndsAt: NOW + DAY_MS }, plan, NOW).locked).toBe(false);
    // Graduated by the agency onto other terms: not this lock.
    expect(evaluateBillingGate({ ...org, graduatedAt: NOW - 1 }, plan, NOW).locked).toBe(false);
  });

  it("pending_card is the 'start your trial' gate", () => {
    const g = evaluateBillingGate({ billingStatus: "pending_card", agencyPlanId: "p" }, { requireCardAfterTrial: true, priceCents: 9900 }, NOW);
    expect(g).toMatchObject({ locked: true, reason: "trial_needs_card", inTrial: false });
  });

  it("reminders go at T-30, T-7 and T-1, the closest one reached", () => {
    expect(warningMarkFor(90, [])).toBeUndefined();
    expect(warningMarkFor(30, [])).toBe(30);
    expect(warningMarkFor(29, [30])).toBeUndefined();
    expect(warningMarkFor(7, [30])).toBe(7);
    expect(warningMarkFor(6, [])).toBe(7); // first seen late: the 7-day mail, not a stale 30
    expect(warningMarkFor(1, [30, 7])).toBe(1);
    expect(warningMarkFor(0, [30, 7, 1])).toBeUndefined();
  });

  describe("with the database", () => {
    let t: TestT;
    beforeEach(() => { t = initT(); });

    it("warns cohort and Beta-plan studios, skips anyone already subscribed, and retires further marks", async () => {
      const { betaPlanId } = await seedAgency(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("orgs", {
          orgId: "org_cohort", name: "C", slug: "c", status: "active", betaCohort: true,
          ownerEmail: "c@x", betaLicenseUntil: Date.now() + 6.5 * DAY_MS,
        });
        await ctx.db.insert("orgs", {
          orgId: "org_planbeta", name: "P", slug: "p", status: "active", agencyId: "org_ag",
          ownerEmail: "p@x", agencyPlanId: betaPlanId, billingStatus: "trialing",
          trialStartedAt: Date.now() - 300 * DAY_MS, trialEndsAt: Date.now() + 29.5 * DAY_MS,
        });
        await ctx.db.insert("orgs", {
          orgId: "org_subscribed", name: "S", slug: "ss", status: "active", betaCohort: true,
          ownerEmail: "s@x", betaLicenseUntil: Date.now() + 6.5 * DAY_MS,
          billingStatus: "trialing", billingSubscriptionId: "sub_1",
        });
      });
      const due = await t.query(internal.betaClock._dueForWarning, {});
      const byOrg = Object.fromEntries(due.map((d) => [d.orgId, d.mark]));
      expect(byOrg).toEqual({ org_cohort: 7, org_planbeta: 30 });

      await t.mutation(internal.betaClock._markWarned, { orgId: "org_cohort", mark: 7 });
      expect((await org(t, "org_cohort")).betaWarningsSent?.sort((a, b) => a - b)).toEqual([7, 30]);
    });

    it("provisioning: Beta default starts card-free; a paid trial default waits for a card", async () => {
      const { planId } = await seedAgency(t);
      await t.mutation(internal.agency.provision, {
        orgId: "org_new1", name: "New One", slug: "new-one", ownerName: "N", ownerEmail: "n@x", agencyId: "org_ag",
      });
      const beta = await org(t, "org_new1");
      expect(beta.billingStatus).toBe("trialing");
      expect(beta.trialEndsAt! - beta.trialStartedAt!).toBe(365 * DAY_MS);
      expect(beta.billingSubscriptionId).toBeUndefined();

      await t.run(async (ctx) => {
        for (const p of await ctx.db.query("agencyPlans").collect()) await ctx.db.patch(p._id, { isDefault: p._id === planId });
      });
      await t.mutation(internal.agency.provision, {
        orgId: "org_new2", name: "New Two", slug: "new-two", ownerName: "N", ownerEmail: "n2@x", agencyId: "org_ag",
      });
      const paid = await org(t, "org_new2");
      expect(paid.billingStatus).toBe("pending_card");
      expect(paid.trialEndsAt).toBeUndefined();
    });

    it("beta conversion: tier recorded at checkout, graduation on the first charge, data kept", async () => {
      await seedAgency(t);
      await t.run(async (ctx) => {
        const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org_s")).first();
        await ctx.db.patch(o!._id, { betaCohort: true, betaLicenseUntil: Date.now() + 30 * DAY_MS, billingStatus: "trialing", trialStartedAt: Date.now() - 300 * DAY_MS });
      });
      const until = Math.floor((Date.now() + 30 * DAY_MS) / 1000);
      const meta = { kind: "beta_conversion", orgId: "org_s", tier: "core" };
      await t.mutation(internal.trialBilling._applyOrgSubscription, {
        orgId: "org_s",
        sub: { id: "sub_b", status: "trialing", customer: "cus_s", trial_start: 1, trial_end: until, default_payment_method: "pm", metadata: meta },
      });
      let o = await org(t);
      expect(o.tier).toBe("core");
      expect(o.graduatedAt).toBeUndefined();
      expect(o.trialStartedAt).toBeLessThan(Date.now() - 200 * DAY_MS); // original start kept
      await t.mutation(internal.trialBilling._applyOrgSubscription, {
        orgId: "org_s",
        sub: { id: "sub_b", status: "active", customer: "cus_s", trial_end: until, default_payment_method: "pm", metadata: meta },
      });
      o = await org(t);
      expect(o.graduatedAt).toBeGreaterThan(0);
      expect(o.billingStatus).toBe("active");
      expect(o.name).toBe("Studio S");
    });
  });
});

/* ── 6. Grandfathered card-free trials ──────────────────────────────── */
describe("grandfathered card-free trials", () => {
  let t: TestT;
  beforeEach(() => { t = initT(); });

  it("pure rule: running, not beta, no Stripe subscription", () => {
    const plan = { priceCents: 9900, trialDays: 14 };
    expect(isGrandfatheredCardFreeTrial({ billingStatus: "trialing", trialStartedAt: 1 }, plan)).toBe(true);
    expect(isGrandfatheredCardFreeTrial({ billingStatus: "trialing", trialStartedAt: 1, billingSubscriptionId: "s" }, plan)).toBe(false);
    expect(isGrandfatheredCardFreeTrial({ billingStatus: "trialing", trialStartedAt: 1, betaCohort: true }, plan)).toBe(false);
    expect(isGrandfatheredCardFreeTrial({ billingStatus: "trialing", trialStartedAt: 1 }, { ...plan, name: BETA_PLAN_NAME })).toBe(false);
  });

  it("are reported by id (no names, no emails), reminded once, and owe a card at the end", async () => {
    const { planId, betaPlanId } = await seedAgency(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_old", name: "Old Trial", slug: "old", status: "active", agencyId: "org_ag",
        ownerEmail: "old@x", agencyPlanId: planId, billingStatus: "trialing",
        trialStartedAt: Date.now() - 5 * DAY_MS, trialEndsAt: Date.now() + 9 * DAY_MS,
      });
      // Beta-plan studio: the exception, never reported.
      await ctx.db.insert("orgs", {
        orgId: "org_betaplan", name: "B", slug: "bp", status: "active", agencyId: "org_ag",
        ownerEmail: "b@x", agencyPlanId: betaPlanId, billingStatus: "trialing",
        trialStartedAt: Date.now(), trialEndsAt: Date.now() + 300 * DAY_MS,
      });
    });
    const report = await t.query(internal.trialBilling.cardFreeTrialReport, {});
    expect(report.count).toBe(1);
    expect(report.orgIds).toEqual(["org_old"]);
    expect(JSON.stringify(report)).not.toMatch(/@|Old Trial/);

    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const dry = await t.action(internal.trialBilling.sendTrialCardRequiredReminders, {});
      expect(dry).toMatchObject({ dryRun: true, eligible: 1, sent: 0 });
      expect((await org(t, "org_old")).trialCardRequiredBy).toBeUndefined();

      await t.action(internal.trialBilling.sendTrialCardRequiredReminders, { apply: true });
      const o = await org(t, "org_old");
      expect(o.trialCardRequiredBy).toBe(o.trialEndsAt);
      expect(o.trialCardReminderSentAt).toBeGreaterThan(0);
      // The trial itself is untouched: grandfathered, not cut short.
      expect(o.billingStatus).toBe("trialing");

      const again = await t.action(internal.trialBilling.sendTrialCardRequiredReminders, { apply: true });
      expect(again.eligible).toBe(0);
    } finally {
      if (saved !== undefined) process.env.RESEND_API_KEY = saved;
    }

    // At the end, the card is due even on a plan whose switch said optional.
    const lapsed = { billingStatus: "trialing" as const, agencyPlanId: "p", trialEndsAt: NOW - 1, trialCardRequiredBy: NOW - 1 };
    const g = evaluateBillingGate(lapsed, { requireCardAfterTrial: false, priceCents: 9900 }, NOW);
    expect(g.locked).toBe(true);
    expect(g.reason).toBe("trial_expired_needs_card");
  });

  it("orgPatchFromSubscription clears nothing it should not and maps statuses", () => {
    expect(orgPatchFromSubscription({ id: "s", status: "incomplete" }, {}, NOW).billingStatus).toBeUndefined();
    expect(orgPatchFromSubscription({ id: "s", status: "unpaid" }, {}, NOW).billingStatus).toBe("past_due");
    expect(orgPatchFromSubscription({ id: "s", status: "active" }, { paidSince: 5 }, NOW).paidSince).toBeUndefined();
  });
});
