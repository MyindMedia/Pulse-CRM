import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { evaluateBillingGate, effectivePriceCents, trialDaysLeft, DAY_MS } from "./lib/billingGate";
import {
  PLAN_LIMITS, SELLABLE_TIERS, EARLY_ADOPTER_MONTHS, earlyAdopterPriceCents,
  starterPlanNames,
} from "./lib/plans";

/* ── Pure gate logic ─────────────────────────────────────────── */
describe("billingGate - pure logic", () => {
  const now = 1_000_000_000_000;
  const planCard = { requireCardAfterTrial: true, priceCents: 9900 };
  const planNoCard = { requireCardAfterTrial: false, priceCents: 9900 };

  it("no plan → never locked, reason no_plan", () => {
    const g = evaluateBillingGate({}, null, now);
    expect(g.locked).toBe(false);
    expect(g.reason).toBe("no_plan");
  });

  it("comped → not locked", () => {
    const g = evaluateBillingGate({ billingStatus: "comped", agencyPlanId: "p" }, planCard, now);
    expect(g.locked).toBe(false);
    expect(g.reason).toBe("comped");
  });

  it("trialing with days left → not locked, inTrial, counts days", () => {
    const g = evaluateBillingGate(
      { billingStatus: "trialing", agencyPlanId: "p", trialEndsAt: now + 10 * DAY_MS },
      planCard, now,
    );
    expect(g.locked).toBe(false);
    expect(g.inTrial).toBe(true);
    expect(g.trialDaysLeft).toBe(10);
    expect(g.reason).toBe("trialing");
  });

  it("trialing within 3 days → reason trial_ending", () => {
    const g = evaluateBillingGate(
      { billingStatus: "trialing", agencyPlanId: "p", trialEndsAt: now + 2 * DAY_MS },
      planCard, now,
    );
    expect(g.reason).toBe("trial_ending");
    expect(g.locked).toBe(false);
  });

  it("trial expired + card required + no card → LOCKED", () => {
    const g = evaluateBillingGate(
      { billingStatus: "trialing", agencyPlanId: "p", trialEndsAt: now - 1, paymentMethodOnFile: false },
      planCard, now,
    );
    expect(g.locked).toBe(true);
    expect(g.reason).toBe("trial_expired_needs_card");
  });

  it("trial expired + card on file → not locked", () => {
    const g = evaluateBillingGate(
      { billingStatus: "trialing", agencyPlanId: "p", trialEndsAt: now - 1, paymentMethodOnFile: true },
      planCard, now,
    );
    expect(g.locked).toBe(false);
  });

  it("trial expired but plan does NOT require a card → not locked", () => {
    const g = evaluateBillingGate(
      { billingStatus: "trialing", agencyPlanId: "p", trialEndsAt: now - 1, paymentMethodOnFile: false },
      planNoCard, now,
    );
    expect(g.locked).toBe(false);
  });

  it("past_due + card required + no card → locked", () => {
    const g = evaluateBillingGate(
      { billingStatus: "past_due", agencyPlanId: "p", paymentMethodOnFile: false },
      planCard, now,
    );
    expect(g.locked).toBe(true);
    expect(g.reason).toBe("past_due");
  });

  it("trialDaysLeft + effectivePriceCents helpers", () => {
    expect(trialDaysLeft(now + 5 * DAY_MS, now)).toBe(5);
    expect(trialDaysLeft(now - DAY_MS, now)).toBe(0);
    expect(trialDaysLeft(undefined, now)).toBeNull();
    expect(effectivePriceCents(2500, 9900)).toBe(2500);
    expect(effectivePriceCents(undefined, 9900)).toBe(9900);
  });
});

/* ── Plans CRUD + billing state machine (with DB) ────────────── */
describe("agencyPlans + agencyBilling - integration", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "max", status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x", name: "Owner",
        role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1", name: "Sub1", slug: "s1", tier: "growth", status: "active", agencyId: "org_ag",
        ownerEmail: "sub1@x",
      });
    });
    return t.withIdentity({ subject: "u_owner", name: "Owner", orgId: "org_ag", orgType: "agency" } as never);
  }

  it("seeds Beta plus an early-adopter and a standard plan per sellable tier", async () => {
    const owner = await seed();
    await owner.mutation(api.agencyPlans.seedStarter, {});
    const plans = await owner.query(api.agencyPlans.list, {});
    // Beta, plus Early Adopter + standard for Core / Growth / Max.
    expect(plans.length).toBe(1 + SELLABLE_TIERS.length * 2);

    /* The agency console names this book in its reset dialog before the
       seeder runs, so the two lists have to be the same list. They were not:
       the dialog promised "Free Forever, 30 Day Free and 1 Year Free" long
       after the seeder stopped creating any of them. */
    expect([...plans.map((p) => p.name)].sort()).toEqual([...starterPlanNames()].sort());

    /* The beta is the one card-free term, and the only seeded plan with a
       window. The beta paywall asks them to add a card and pick a plan at the
       end, a different conversation from a card prompt against a free plan. */
    const beta = plans.find((p) => p.name.startsWith("Beta"))!;
    expect(beta).toBeDefined();
    expect(beta.priceCents).toBe(0);
    expect(beta.trialDays).toBe(365);
    expect(beta.requireCardAfterTrial).toBe(false);
    expect(beta.isBeta).toBe(true);
    expect(beta.isDefault).toBe(true);

    // Every paid plan carries the platform trial, card required at the start.
    for (const p of plans.filter((x) => x._id !== beta._id)) {
      expect(p.trialDays).toBe(14);
      expect(p.requireCardAfterTrial).toBe(true);
    }

    /* Every price comes from PLAN_LIMITS. This is the assertion that would
       have caught the console still offering $49/$129/$199 months after the
       product stopped selling it. */
    for (const t of SELLABLE_TIERS) {
      const label = PLAN_LIMITS[t].label;
      const standard = plans.find((p) => p.name === label)!;
      expect(standard).toBeDefined();
      expect(standard.priceCents).toBe(PLAN_LIMITS[t].priceCents);
      expect(standard.introPriceCents ?? null).toBeNull();

      const early = plans.find((p) => p.name === `${label} - Early Adopter`)!;
      expect(early).toBeDefined();
      expect(early.priceCents).toBe(PLAN_LIMITS[t].priceCents);
      expect(early.introPriceCents).toBe(earlyAdopterPriceCents(t));
      expect(early.introMonths).toBe(EARLY_ADOPTER_MONTHS);
    }

    const defaults = plans.filter((p) => p.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].name).toBe(beta.name);
  });

  it("refuses an intro price that is not actually cheaper", async () => {
    const owner = await seed();
    await expect(
      owner.mutation(api.agencyPlans.create, {
        name: "Fake offer", priceCents: 10000, billingInterval: "month", trialDays: 0,
        requireCardAfterTrial: true, isPromo: true,
        introPriceCents: 10000, introMonths: 3,
      }),
    ).rejects.toThrow();
  });

  it("refuses half an intro offer", async () => {
    const owner = await seed();
    await expect(
      owner.mutation(api.agencyPlans.create, {
        name: "Half offer", priceCents: 10000, billingInterval: "month", trialDays: 0,
        requireCardAfterTrial: true, isPromo: true,
        introPriceCents: 5000,
      }),
    ).rejects.toThrow();
  });

  it("only one default at a time", async () => {
    const owner = await seed();
    const a = await owner.mutation(api.agencyPlans.create, {
      name: "A", priceCents: 1000, billingInterval: "month", trialDays: 7,
      requireCardAfterTrial: true, isPromo: false, isDefault: true,
    });
    await owner.mutation(api.agencyPlans.create, {
      name: "B", priceCents: 2000, billingInterval: "month", trialDays: 7,
      requireCardAfterTrial: true, isPromo: false, isDefault: true,
    });
    const plans = await owner.query(api.agencyPlans.list, {});
    expect(plans.filter((p) => p.isDefault).length).toBe(1);
    expect(plans.find((p) => p.isDefault)!.name).toBe("B");
    // a is no longer default
    expect(plans.find((p) => p._id === a)!.isDefault).toBe(false);
  });

  it("refuses a free plan with a trial: every trial needs a card", async () => {
    const owner = await seed();
    await expect(
      owner.mutation(api.agencyPlans.create, {
        name: "First Adopter", priceCents: 0, billingInterval: "month", trialDays: 30,
        requireCardAfterTrial: true, isPromo: true,
      }),
    ).rejects.toThrow(/every trial needs a card/);
  });

  it("assignPlan on a paid trial plan does NOT start a trial: pending_card until checkout", async () => {
    const owner = await seed();
    const plan = await owner.mutation(api.agencyPlans.create, {
      name: "Studio", priceCents: 9900, billingInterval: "month", trialDays: 14,
      requireCardAfterTrial: false, isPromo: false,
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: plan });
    const b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.billingStatus).toBe("pending_card");
    expect(b.trialEndsAt).toBeNull();
    expect(b.trialStartedAt).toBeNull();
    expect(b.inTrial).toBe(false);
    expect(b.locked).toBe(true);
    expect(b.reason).toBe("trial_needs_card");
    // The card is always required on a paid trial, whatever the switch said.
    expect(b.plan?.requireCardAfterTrial).toBe(true);
    expect(b.plan?.paidTrial).toBe(true);
  });

  it("assignPlan free non-promo → comped", async () => {
    const owner = await seed();
    const free = await owner.mutation(api.agencyPlans.create, {
      name: "Partner", priceCents: 0, billingInterval: "month", trialDays: 0,
      requireCardAfterTrial: false, isPromo: false,
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: free });
    const b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.billingStatus).toBe("comped");
    expect(b.locked).toBe(false);
  });

  /* A free promo plan with a trial can no longer be created, but rows made
     before the card rule still exist. They are grandfathered: left running,
     and they still owe a card at the end. Inserted directly here. */
  async function legacyCardFreePlan() {
    return await t.run(async (ctx) =>
      await ctx.db.insert("agencyPlans", {
        agencyId: "org_ag", name: "First Adopter", priceCents: 0, billingInterval: "month",
        trialDays: 30, requireCardAfterTrial: true, isPromo: true, isDefault: false,
        active: true, createdAt: 0,
      }),
    );
  }

  async function putOnTrial(orgId: string, planId: unknown, patch: Record<string, unknown> = {}) {
    await t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").filter((q) => q.eq(q.field("orgId"), orgId)).first();
      await ctx.db.patch(org!._id, {
        agencyPlanId: planId as never, billingStatus: "trialing",
        trialStartedAt: Date.now() - 20 * DAY_MS, trialEndsAt: Date.now() + 10 * DAY_MS, ...patch,
      });
    });
  }

  it("refuses to assign a legacy card-free trial plan", async () => {
    const owner = await seed();
    const legacy = await legacyCardFreePlan();
    await expect(
      owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: legacy }),
    ).rejects.toThrow(/Every trial needs a card/);
  });

  it("grandfathered card-free trial: runs on, locks at the end with no card; markActiveManually clears it", async () => {
    const owner = await seed();
    const legacy = await legacyCardFreePlan();
    await putOnTrial("org_sub1", legacy);
    let b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.locked).toBe(false);
    expect(b.inTrial).toBe(true);

    await putOnTrial("org_sub1", legacy, { trialEndsAt: Date.now() - 1000 });
    b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.locked).toBe(true);
    expect(b.reason).toBe("trial_expired_needs_card");

    await owner.mutation(api.agencyBilling.markActiveManually, { orgId: "org_sub1", onFile: true });
    b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.locked).toBe(false);
    expect(b.billingStatus).toBe("active");
    expect(b.paymentMethodOnFile).toBe(true);
  });

  it("extendTrial refuses a card-free trial (that would be a new card-free window)", async () => {
    const owner = await seed();
    const legacy = await legacyCardFreePlan();
    await putOnTrial("org_sub1", legacy, { trialEndsAt: Date.now() - 1000 });
    await expect(
      owner.mutation(api.agencyBilling.extendTrial, { orgId: "org_sub1", days: 14 }),
    ).rejects.toThrow(/card on file/);
  });

  it("extendTrial on a Stripe-backed trial goes to Stripe, not to a local date", async () => {
    const owner = await seed();
    const plan = await owner.mutation(api.agencyPlans.create, {
      name: "Studio", priceCents: 9900, billingInterval: "month", trialDays: 14,
      requireCardAfterTrial: true, isPromo: false,
    });
    const end = Date.now() + 2 * DAY_MS;
    await putOnTrial("org_sub1", plan, { trialEndsAt: end, billingSubscriptionId: "sub_live", paymentMethodOnFile: true });
    const r = await owner.mutation(api.agencyBilling.extendTrial, { orgId: "org_sub1", days: 14 });
    expect(r.scheduled).toBe(true);
    expect(r.trialEndsAt).toBe(end + 14 * DAY_MS);
    // The local mirror is untouched until Stripe's webhook says otherwise.
    const b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.trialEndsAt).toBe(end);
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("_extendStripeTrial"))).toBe(true);
  });

  it("_sweepTrials flips lapsed local trials (no card → past_due, card → active) and leaves Stripe trials to Stripe", async () => {
    const owner = await seed();
    const legacy = await legacyCardFreePlan();
    await t.run(async (ctx) => {
      for (const id of ["org_sub2", "org_sub3"]) {
        await ctx.db.insert("orgs", {
          orgId: id, name: id, slug: id, tier: "growth", status: "active",
          agencyId: "org_ag", ownerEmail: `${id}@x`,
        });
      }
    });
    await putOnTrial("org_sub1", legacy, { trialEndsAt: Date.now() - 1000 });
    await putOnTrial("org_sub2", legacy, { trialEndsAt: Date.now() - 1000, paymentMethodOnFile: true });
    await putOnTrial("org_sub3", legacy, {
      trialEndsAt: Date.now() - 1000, paymentMethodOnFile: true, billingSubscriptionId: "sub_stripe",
    });
    await t.run(async (ctx) => {
      const { internal } = await import("./_generated/api");
      await ctx.runMutation(internal.agencyBilling._sweepTrials, {});
    });
    const b1 = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    const b2 = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub2" });
    const b3 = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub3" });
    expect(b1.billingStatus).toBe("past_due");
    expect(b1.locked).toBe(true);
    expect(b2.billingStatus).toBe("active");
    expect(b2.locked).toBe(false);
    expect(b3.billingStatus).toBe("trialing");
  });

  it("setPriceOverride changes effective price", async () => {
    const owner = await seed();
    const plan = await owner.mutation(api.agencyPlans.create, {
      name: "Studio", priceCents: 9900, billingInterval: "month", trialDays: 0,
      requireCardAfterTrial: true, isPromo: false,
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: plan });
    await owner.mutation(api.agencyBilling.setPriceOverride, { orgId: "org_sub1", priceCents: 4900 });
    const b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.effectivePriceCents).toBe(4900);
  });

  it("remove blocks when studios are assigned", async () => {
    const owner = await seed();
    const plan = await owner.mutation(api.agencyPlans.create, {
      name: "Studio", priceCents: 9900, billingInterval: "month", trialDays: 0,
      requireCardAfterTrial: true, isPromo: false,
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: plan });
    await expect(owner.mutation(api.agencyPlans.remove, { planId: plan })).rejects.toThrow();
  });

  it("update edits the plan's editable fields", async () => {
    const owner = await seed();
    const plan = await owner.mutation(api.agencyPlans.create, {
      name: "Core", description: "old", priceCents: 9900, billingInterval: "month",
      trialDays: 14, requireCardAfterTrial: true, isPromo: false,
    });
    await owner.mutation(api.agencyPlans.update, {
      planId: plan,
      name: "Growth",
      description: "new",
      priceCents: 12900,
      billingInterval: "year",
      trialDays: 30,
      requireCardAfterTrial: false,
      isPromo: true,
    });
    const p = (await owner.query(api.agencyPlans.list, {})).find((x) => x._id === plan)!;
    expect(p.name).toBe("Growth");
    expect(p.description).toBe("new");
    expect(p.priceCents).toBe(12900);
    expect(p.billingInterval).toBe("year");
    expect(p.trialDays).toBe(30);
    // A paid trial always takes the card: the switch cannot turn that off.
    expect(p.requireCardAfterTrial).toBe(true);
    expect(p.isPromo).toBe(true);
  });

  it("update is denied for a non-agency viewer", async () => {
    const owner = await seed();
    const plan = await owner.mutation(api.agencyPlans.create, {
      name: "Studio", priceCents: 9900, billingInterval: "month", trialDays: 0,
      requireCardAfterTrial: true, isPromo: false,
    });
    // No identity -> demo studio owner, which lacks billing.edit.
    await expect(t.mutation(api.agencyPlans.update, { planId: plan, name: "Hacked" })).rejects.toThrow();
  });
});
