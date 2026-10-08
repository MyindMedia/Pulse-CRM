import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { DAY_MS, evaluateBillingGate } from "./lib/billingGate";
import { initialBillingFor } from "./lib/trialCheckout";
import { needsSubscriptionCheckout, trialForOrg } from "./agencyBilling";
import { BETA_PLAN_NAME } from "./lib/plans";

/* Owner rule: every paid plan is actually charged. A paid agency plan with
   no trial used to save a card (setup mode) and mark the studio active with
   no Stripe subscription behind it, so nothing ever charged the card. These
   tests hold the fix: a real subscription Checkout, active only once Stripe
   says so, no second subscription, the Beta plan untouched, and read-only
   reports for the studios the old flow left behind. */

/* ── A fake Stripe ─────────────────────────────────────────────────── */
const fake: {
  checkout: Record<string, unknown>[];
  expired: string[];
  subs: Record<string, string>;
  sessions: Record<string, { status: string; subscription?: string }>;
  nextSession: number;
} = { checkout: [], expired: [], subs: {}, sessions: {}, nextSession: 1 };

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      customers: { create: async () => ({ id: "cus_new" }) },
      coupons: { create: async () => ({ id: "coupon_x" }) },
      subscriptions: {
        retrieve: async (id: string) => {
          const status = fake.subs[id];
          if (!status) throw new Error("No such subscription");
          return { id, status };
        },
        cancel: async (id: string) => ({ id, status: "canceled" }),
      },
      checkout: {
        sessions: {
          create: async (params: Record<string, unknown>) => {
            fake.checkout.push(params);
            const id = `cs_${fake.nextSession++}`;
            fake.sessions[id] = { status: "open" };
            return { id, url: `https://checkout.stripe.test/${id}` };
          },
          retrieve: async (id: string) => {
            const s = fake.sessions[id];
            if (!s) throw new Error("No such checkout session");
            return { id, ...s };
          },
          expire: async (id: string) => {
            fake.expired.push(id);
            if (fake.sessions[id]) fake.sessions[id].status = "expired";
            return { id, status: "expired" };
          },
        },
      },
    }),
  };
});

const NOW = 1_800_000_000_000;
const initT = () => convexTest(schema);
type TestT = ReturnType<typeof initT>;

async function seed(t: TestT) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "org_ag", name: "AG", slug: "ag", plan: "max", status: "active",
      ownerClerkUserId: "u_agency", ownerEmail: "a@x",
    });
    await ctx.db.insert("agencyMembers", {
      agencyId: "org_ag", clerkUserId: "u_agency", email: "a@x", name: "A", role: "owner", status: "active", invitedAt: 0,
    });
    const paidPlanId = await ctx.db.insert("agencyPlans", {
      agencyId: "org_ag", name: "Studio Monthly", priceCents: 9900, billingInterval: "month",
      trialDays: 0, requireCardAfterTrial: true, isPromo: false, isDefault: false,
      active: true, createdAt: 0, stripePriceId: "price_studio_m",
    });
    const trialPlanId = await ctx.db.insert("agencyPlans", {
      agencyId: "org_ag", name: "Studio Trial", priceCents: 9900, billingInterval: "month",
      trialDays: 14, requireCardAfterTrial: true, isPromo: false, isDefault: false,
      active: true, createdAt: 1,
    });
    const betaPlanId = await ctx.db.insert("agencyPlans", {
      agencyId: "org_ag", name: BETA_PLAN_NAME, priceCents: 0, billingInterval: "month",
      trialDays: 365, requireCardAfterTrial: false, isBeta: true, isPromo: true, isDefault: true,
      active: true, createdAt: 2,
    });
    await ctx.db.insert("orgs", {
      orgId: "org_s", name: "Studio S", slug: "s", tier: "growth", status: "active",
      agencyId: "org_ag", ownerEmail: "owner@s.com", ownerName: "Sam",
      agencyPlanId: paidPlanId, billingStatus: "past_due",
    });
    await ctx.db.insert("members", {
      orgId: "org_s", name: "Sam", email: "owner@s.com", role: "owner", skills: [], clerkUserId: "u_s",
    });
    return { paidPlanId, trialPlanId, betaPlanId };
  });
}

async function org(t: TestT, orgId = "org_s") {
  return (await t.run(async (ctx) => await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first()))!;
}

async function patchOrg(t: TestT, fields: Record<string, unknown>, orgId = "org_s") {
  await t.run(async (ctx) => {
    const o = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    await ctx.db.patch(o!._id, fields);
  });
}

const owner = (t: TestT) => t.withIdentity({ subject: "u_s", name: "Sam", email: "owner@s.com" });
const agency = (t: TestT) =>
  t.withIdentity({ subject: "u_agency", name: "A", orgId: "org_ag", orgType: "agency" } as never);

type CheckoutParams = {
  mode: string;
  payment_method_collection?: string;
  line_items?: { price?: string; quantity: number }[];
  subscription_data?: { trial_period_days?: number; trial_end?: number; trial_settings?: unknown; metadata?: Record<string, string> };
  metadata: Record<string, string>;
};

function resetFake() {
  fake.checkout = [];
  fake.expired = [];
  fake.subs = {};
  fake.sessions = {};
  fake.nextSession = 1;
}

/* ── 1. Rules ──────────────────────────────────────────────────────── */
describe("which studios need a subscription checkout", () => {
  const paid = { _id: "p", name: "Studio Monthly", priceCents: 9900, trialDays: 0, billingInterval: "month" as const };
  const beta = { ...paid, name: BETA_PLAN_NAME, priceCents: 0, trialDays: 365, isBeta: true };

  it("a paid plan with no trial and no live subscription always opens a subscription", () => {
    for (const billingStatus of ["pending_card", "past_due", "active", "canceled"] as const) {
      expect(needsSubscriptionCheckout({ plan: paid, billingStatus, billingSubscriptionId: null })).toBe(true);
    }
  });

  it("not while a subscription is live, not for comped, not for the Beta plan, not at a $0 override", () => {
    expect(needsSubscriptionCheckout({ plan: paid, billingStatus: "active", billingSubscriptionId: "sub_1" })).toBe(false);
    expect(needsSubscriptionCheckout({ plan: paid, billingStatus: "comped", billingSubscriptionId: null })).toBe(false);
    expect(needsSubscriptionCheckout({ plan: beta, billingStatus: "trialing", billingSubscriptionId: null })).toBe(false);
    expect(needsSubscriptionCheckout({ plan: paid, billingStatus: "past_due", billingSubscriptionId: null, priceCentsOverride: 0 })).toBe(false);
  });

  it("a paid plan with no trial is assigned into pending_card, card or not", () => {
    const none = { billingStatus: "pending_card", trialStartedAt: undefined, trialEndsAt: undefined };
    expect(initialBillingFor({ priceCents: 9900, trialDays: 0 }, true, NOW, DAY_MS)).toEqual(none);
    expect(initialBillingFor({ priceCents: 9900, trialDays: 0 }, false, NOW, DAY_MS)).toEqual(none);
    expect(initialBillingFor({ priceCents: 9900, trialDays: 0, isPromo: true }, true, NOW, DAY_MS)).toEqual(none);
  });

  it("only a studio that never started gets a fresh trial; a card-only studio is charged now", () => {
    const trial = { ...paid, trialDays: 14 };
    expect(trialForOrg({ plan: trial, billingStatus: "pending_card", trialEndsAt: null }, NOW)).toEqual({ kind: "days", days: 14 });
    expect(trialForOrg({ plan: trial, billingStatus: "active", trialEndsAt: null }, NOW)).toEqual({ kind: "none" });
    expect(trialForOrg({ plan: trial, billingStatus: "past_due", trialEndsAt: NOW - DAY_MS }, NOW)).toEqual({ kind: "none" });
    expect(trialForOrg({ plan: paid, billingStatus: "pending_card", trialEndsAt: null }, NOW)).toEqual({ kind: "none" });
  });
});

/* ── 2. Assign + checkout + webhook ────────────────────────────────── */
describe("paid plan with no trial", () => {
  let t: TestT;
  let savedKey: string | undefined;
  beforeEach(() => {
    t = initT();
    resetFake();
    savedKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  });

  it("assigning it never marks the studio active, even with a card already saved", async () => {
    const { paidPlanId } = await seed(t);
    await patchOrg(t, { paymentMethodOnFile: true, billingStatus: "comped", agencyPlanId: undefined });
    const r = await agency(t).mutation(api.agencyBilling.assignPlan, { orgId: "org_s", planId: paidPlanId });
    expect(r.billingStatus).toBe("pending_card");
    const o = await org(t);
    expect(o.billingStatus).toBe("pending_card");
    const gate = evaluateBillingGate(o, { requireCardAfterTrial: true, priceCents: 9900 }, Date.now());
    expect(gate.locked).toBe(true);
  });

  it("'add a card' opens a subscription Checkout: plan price, card always, no trial", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "pending_card" });
    const r = await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    expect(r.url).toContain("checkout.stripe.test");
    expect(fake.checkout).toHaveLength(1);
    const p = fake.checkout[0] as CheckoutParams;
    expect(p.mode).toBe("subscription");
    expect(p.payment_method_collection).toBe("always");
    expect(p.line_items).toEqual([{ price: "price_studio_m", quantity: 1 }]);
    expect(p.subscription_data?.trial_period_days).toBeUndefined();
    expect(p.subscription_data?.trial_end).toBeUndefined();
    expect(p.subscription_data?.trial_settings).toBeUndefined();
    expect(p.metadata).toMatchObject({ kind: "subaccount_plan", orgId: "org_s" });
    expect(p.subscription_data?.metadata).toMatchObject({ kind: "subaccount_plan", orgId: "org_s" });
    // Opening Checkout changes nothing: active only once Stripe confirms.
    const o = await org(t);
    expect(o.billingStatus).toBe("pending_card");
    expect(o.paidSince).toBeUndefined();
    expect(o.billingCheckoutSessionId).toBe("cs_1");
  });

  it("the agency's 'send a card link' opens the same subscription Checkout", async () => {
    await seed(t);
    const r = await agency(t).action(api.agencyBilling.startPaymentSetup, { orgId: "org_s" });
    expect(r.url).toContain("checkout.stripe.test");
    expect((fake.checkout[0] as CheckoutParams).mode).toBe("subscription");
  });

  it("is active only after the webhook: session completed schedules a sync, the subscription event activates", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "pending_card" });
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_cs_plan", type: "checkout.session.completed",
        data: { object: { id: "cs_1", customer: "cus_s", subscription: "sub_1", metadata: { kind: "subaccount_plan", orgId: "org_s" } } },
      },
    });
    expect((await org(t)).billingStatus).toBe("pending_card");
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("syncOrgSubscription"))).toBe(true);

    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_sub_created", type: "customer.subscription.created",
        data: { object: { object: "subscription", id: "sub_1", status: "active", customer: "cus_s", default_payment_method: "pm_1", metadata: { kind: "subaccount_plan", orgId: "org_s" } } },
      },
    });
    const o = await org(t);
    expect(o.billingStatus).toBe("active");
    expect(o.billingSubscriptionId).toBe("sub_1");
    expect(o.billingCustomerId).toBe("cus_s");
    expect(o.paymentMethodOnFile).toBe(true);
    expect(o.paidSince).toBeGreaterThan(0);
  });

  it("an incomplete first payment leaves the studio where it was", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "pending_card" });
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_incomplete", type: "customer.subscription.created",
        data: { object: { object: "subscription", id: "sub_1", status: "incomplete", customer: "cus_s", metadata: { orgId: "org_s" } } },
      },
    });
    expect((await org(t)).billingStatus).toBe("pending_card");
  });

  it("a setup-mode card save (an old link) records the card but never activates a paid plan", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "pending_card" });
    await t.mutation(internal.agencyBilling._markPaymentMethodOnFile, { orgId: "org_s", customerId: "cus_s" });
    const o = await org(t);
    expect(o.paymentMethodOnFile).toBe(true);
    expect(o.billingCustomerId).toBe("cus_s");
    expect(o.billingStatus).toBe("pending_card");
    expect(o.paidSince).toBeUndefined();
  });

  it("a card-only studio confirming its plan is charged now, with no new trial even on a trial plan", async () => {
    const { trialPlanId } = await seed(t);
    await patchOrg(t, {
      agencyPlanId: trialPlanId, billingStatus: "active", paymentMethodOnFile: true,
      billingCustomerId: "cus_s", paidSince: Date.now() - 40 * DAY_MS,
    });
    await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    const p = fake.checkout[0] as CheckoutParams & { customer?: string };
    expect(p.mode).toBe("subscription");
    expect(p.customer).toBe("cus_s");
    expect(p.subscription_data?.trial_period_days).toBeUndefined();
    expect(p.metadata.kind).toBe("subaccount_plan");
  });

  it("without Stripe configured (demo), the simulated subscription is what activates it", async () => {
    await seed(t);
    delete process.env.STRIPE_SECRET_KEY;
    await patchOrg(t, { billingStatus: "pending_card" });
    const r = await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    expect(r.simulated).toBe(true);
    const o = await org(t);
    expect(o.billingStatus).toBe("active");
    expect(o.billingSubscriptionId).toBe("sub_simulated_org_s");
  });
});

/* ── 3. Double-charge protections ──────────────────────────────────── */
describe("no second subscription", () => {
  let t: TestT;
  let savedKey: string | undefined;
  beforeEach(() => {
    t = initT();
    resetFake();
    savedKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  });

  it("a studio with a live subscription cannot open another checkout", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "active", billingSubscriptionId: "sub_a", paymentMethodOnFile: true });
    fake.subs.sub_a = "active";
    await expect(owner(t).action(api.agencyBilling.startMyPaymentSetup, {})).rejects.toThrow(/already has a subscription/);
    expect(fake.checkout).toHaveLength(0);
  });

  it("a second click expires the first open Checkout before opening a new one", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "pending_card" });
    await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    expect(fake.expired).toEqual(["cs_1"]);
    expect(fake.checkout).toHaveLength(2);
    expect((await org(t)).billingCheckoutSessionId).toBe("cs_2");
  });

  it("a Checkout that already went through (webhook not here yet) blocks a second one", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "pending_card", billingCheckoutSessionId: "cs_done" });
    fake.sessions.cs_done = { status: "complete", subscription: "sub_paid" };
    fake.subs.sub_paid = "active";
    await expect(owner(t).action(api.agencyBilling.startMyPaymentSetup, {})).rejects.toThrow(/already has a subscription/);
    expect(fake.checkout).toHaveLength(0);
  });

  it("a completed Checkout whose subscription has since been canceled does not block resubscribing", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "canceled", billingSubscriptionId: "sub_old", billingCheckoutSessionId: "cs_old" });
    fake.sessions.cs_old = { status: "complete", subscription: "sub_old" };
    fake.subs.sub_old = "canceled";
    await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    expect(fake.checkout).toHaveLength(1);
  });

  it("the webhook still cancels a duplicate live subscription and keeps the first", async () => {
    await seed(t);
    await patchOrg(t, { billingStatus: "active", billingSubscriptionId: "sub_a", paymentMethodOnFile: true });
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_dup", type: "customer.subscription.created",
        data: { object: { object: "subscription", id: "sub_b", status: "active", customer: "cus_s", metadata: { kind: "subaccount_plan", orgId: "org_s" } } },
      },
    });
    expect((await org(t)).billingSubscriptionId).toBe("sub_a");
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("_cancelDuplicateSubscription"))).toBe(true);
  });
});

/* ── 4. Beta untouched ─────────────────────────────────────────────── */
describe("the Beta plan is untouched", () => {
  let t: TestT;
  let savedKey: string | undefined;
  beforeEach(() => {
    t = initT();
    resetFake();
    savedKey = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = savedKey;
  });

  it("assigning Beta starts its card-free 365 days; 'add a card' only saves a card, no subscription", async () => {
    const { betaPlanId } = await seed(t);
    await agency(t).mutation(api.agencyBilling.assignPlan, { orgId: "org_s", planId: betaPlanId });
    const o = await org(t);
    expect(o.billingStatus).toBe("trialing");
    expect(o.trialEndsAt! - o.trialStartedAt!).toBe(365 * DAY_MS);

    await owner(t).action(api.agencyBilling.startMyPaymentSetup, {});
    expect((fake.checkout[0] as CheckoutParams).mode).toBe("setup");
    expect((await org(t)).billingSubscriptionId).toBeUndefined();
  });
});

/* ── 5. Reports and the conversion reminder ────────────────────────── */
describe("reports", () => {
  let t: TestT;
  beforeEach(() => { t = initT(); resetFake(); });

  it("cardOnlyStudiosReport lists paid studios marked active with no subscription, by id only", async () => {
    const { paidPlanId, betaPlanId } = await seed(t);
    await t.run(async (ctx) => {
      const base = { status: "active" as const, agencyId: "org_ag" };
      await ctx.db.insert("orgs", { ...base, orgId: "org_card", name: "Card Only", slug: "c1", ownerEmail: "c1@x", agencyPlanId: paidPlanId, billingStatus: "active", paymentMethodOnFile: true, billingCustomerId: "cus_c1", paidSince: 5 });
      await ctx.db.insert("orgs", { ...base, orgId: "org_manual", name: "Paid By Check", slug: "c2", ownerEmail: "c2@x", agencyPlanId: paidPlanId, billingStatus: "active", paymentMethodOnFile: true });
      await ctx.db.insert("orgs", { ...base, orgId: "org_subbed", name: "Subscribed", slug: "c3", ownerEmail: "c3@x", agencyPlanId: paidPlanId, billingStatus: "active", paymentMethodOnFile: true, billingCustomerId: "cus_c3", billingSubscriptionId: "sub_c3" });
      await ctx.db.insert("orgs", { ...base, orgId: "org_beta", name: "Beta", slug: "c4", ownerEmail: "c4@x", agencyPlanId: betaPlanId, billingStatus: "active", paymentMethodOnFile: true, billingCustomerId: "cus_c4" });
      await ctx.db.insert("orgs", { ...base, orgId: "org_comped", name: "Comped", slug: "c5", ownerEmail: "c5@x", agencyPlanId: paidPlanId, billingStatus: "comped", paymentMethodOnFile: true, billingCustomerId: "cus_c5" });
    });
    const r = await t.query(internal.agencyBilling.cardOnlyStudiosReport, {});
    expect(r.count).toBe(2);
    expect(r.orgIds.sort()).toEqual(["org_card", "org_manual"]);
    const card = r.rows.find((x) => x.orgId === "org_card")!;
    expect(card).toMatchObject({ source: "stripe_card", priceCents: 9900, billingInterval: "month", reminderSentAt: null });
    expect(r.rows.find((x) => x.orgId === "org_manual")!.source).toBe("manual");
    expect(JSON.stringify(r)).not.toMatch(/@|Card Only|Paid By Check/);
  });

  it("sendCardOnlyConversionReminders is a dry run by default, emails once with apply, and never charges", async () => {
    const { paidPlanId } = await seed(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org_card", name: "Card Only", slug: "c1", status: "active", agencyId: "org_ag", ownerEmail: "c1@x", agencyPlanId: paidPlanId, billingStatus: "active", paymentMethodOnFile: true, billingCustomerId: "cus_c1" });
      await ctx.db.insert("orgs", { orgId: "org_manual", name: "Paid By Check", slug: "c2", status: "active", agencyId: "org_ag", ownerEmail: "c2@x", agencyPlanId: paidPlanId, billingStatus: "active", paymentMethodOnFile: true });
    });
    const saved = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const dry = await t.action(internal.agencyBilling.sendCardOnlyConversionReminders, {});
      expect(dry).toMatchObject({ dryRun: true, eligible: 1, sent: 0, orgIds: ["org_card"] });
      expect((await org(t, "org_card")).planConfirmReminderSentAt).toBeUndefined();

      const run = await t.action(internal.agencyBilling.sendCardOnlyConversionReminders, { apply: true });
      expect(run).toMatchObject({ dryRun: false, eligible: 1, orgIds: ["org_card"] });
      const o = await org(t, "org_card");
      expect(o.planConfirmReminderSentAt).toBeGreaterThan(0);
      // Untouched: still active, still no subscription, nothing charged.
      expect(o.billingStatus).toBe("active");
      expect(o.billingSubscriptionId).toBeUndefined();
      expect(fake.checkout).toHaveLength(0);

      const again = await t.action(internal.agencyBilling.sendCardOnlyConversionReminders, { apply: true });
      expect(again.eligible).toBe(0);
    } finally {
      if (saved !== undefined) process.env.RESEND_API_KEY = saved;
    }
  });

  it("betaPlanStudiosReport counts Beta-plan studios with start, end and days left", async () => {
    const { betaPlanId, paidPlanId } = await seed(t);
    const now = Date.now();
    await t.run(async (ctx) => {
      const base = { status: "active" as const, agencyId: "org_ag", agencyPlanId: betaPlanId };
      await ctx.db.insert("orgs", { ...base, orgId: "org_b1", name: "B1", slug: "b1", ownerEmail: "b1@x", billingStatus: "trialing", trialStartedAt: now - 65 * DAY_MS, trialEndsAt: now + 300 * DAY_MS });
      await ctx.db.insert("orgs", { ...base, orgId: "org_b2", name: "B2", slug: "b2", ownerEmail: "b2@x", billingStatus: "trialing", trialStartedAt: now - 370 * DAY_MS, trialEndsAt: now - 5 * DAY_MS });
      await ctx.db.insert("orgs", { ...base, orgId: "org_b3", name: "B3", slug: "b3", ownerEmail: "b3@x", billingStatus: "trialing", betaCohort: true, betaStartedAt: now - 10 * DAY_MS, betaLicenseUntil: now + 355 * DAY_MS, billingSubscriptionId: "sub_b3" });
      await ctx.db.insert("orgs", { orgId: "org_paid", name: "P", slug: "p", status: "active", agencyId: "org_ag", agencyPlanId: paidPlanId, billingStatus: "active" });
    });
    const r = await t.query(internal.agencyBilling.betaPlanStudiosReport, {});
    expect(r.count).toBe(3);
    expect(r.running).toBe(2);
    expect(r.ended).toBe(1);
    expect(r.subscribed).toBe(1);
    const b1 = r.rows.find((x) => x.orgId === "org_b1")!;
    expect(b1).toMatchObject({ betaStart: now - 65 * DAY_MS, betaEnd: now + 300 * DAY_MS, daysLeft: 300, agencyId: "org_ag" });
    expect(r.rows.find((x) => x.orgId === "org_b2")!.daysLeft).toBe(0);
    expect(r.rows.find((x) => x.orgId === "org_b3")!).toMatchObject({ betaCohort: true, betaEnd: now + 355 * DAY_MS, subscribed: true });
    expect(JSON.stringify(r)).not.toMatch(/@|"B1"/);
  });
});
