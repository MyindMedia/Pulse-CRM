import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { evaluateBillingGate, effectivePriceCents, trialDaysLeft, DAY_MS } from "./lib/billingGate";

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
        agencyId: "org_ag", name: "AG", slug: "ag", plan: "agency", status: "active",
        ownerClerkUserId: "u_owner", ownerEmail: "o@x",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "org_ag", clerkUserId: "u_owner", email: "o@x", name: "Owner",
        role: "owner", status: "active", invitedAt: 0,
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1", name: "Sub1", slug: "s1", plan: "studio", status: "active", agencyId: "org_ag",
        ownerEmail: "sub1@x",
      });
    });
    return t.withIdentity({ subject: "u_owner", name: "Owner", orgId: "org_ag", orgType: "agency" } as never);
  }

  it("seedStarter creates a free promo default + a paid plan", async () => {
    const owner = await seed();
    await owner.mutation(api.agencyPlans.seedStarter, {});
    const plans = await owner.query(api.agencyPlans.list, {});
    expect(plans.length).toBe(2);
    const promo = plans.find((p) => p.isPromo);
    expect(promo).toBeTruthy();
    expect(promo!.priceCents).toBe(0);
    expect(promo!.isDefault).toBe(true);
    expect(promo!.requireCardAfterTrial).toBe(true);
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

  it("assignPlan promo → trialing with a future deadline", async () => {
    const owner = await seed();
    const promo = await owner.mutation(api.agencyPlans.create, {
      name: "First Adopter", priceCents: 0, billingInterval: "month", trialDays: 30,
      requireCardAfterTrial: true, isPromo: true,
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: promo });
    const b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.billingStatus).toBe("trialing");
    expect(b.trialEndsAt).toBeGreaterThan(Date.now());
    expect(b.inTrial).toBe(true);
    expect(b.locked).toBe(false);
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

  it("expired promo trial with no card → locked; markActiveManually clears it", async () => {
    const owner = await seed();
    const promo = await owner.mutation(api.agencyPlans.create, {
      name: "First Adopter", priceCents: 0, billingInterval: "month", trialDays: 30,
      requireCardAfterTrial: true, isPromo: true,
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: promo });
    // Force the trial into the past.
    await t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").filter((q) => q.eq(q.field("orgId"), "org_sub1")).first();
      await ctx.db.patch(org!._id, { trialEndsAt: Date.now() - 1000 });
    });
    let b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.locked).toBe(true);
    expect(b.reason).toBe("trial_expired_needs_card");

    await owner.mutation(api.agencyBilling.markActiveManually, { orgId: "org_sub1", onFile: true });
    b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.locked).toBe(false);
    expect(b.billingStatus).toBe("active");
    expect(b.paymentMethodOnFile).toBe(true);
  });

  it("extendTrial pushes the deadline and re-opens a lapsed trial", async () => {
    const owner = await seed();
    const promo = await owner.mutation(api.agencyPlans.create, {
      name: "Promo", priceCents: 0, billingInterval: "month", trialDays: 1,
      requireCardAfterTrial: true, isPromo: true,
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: promo });
    await t.run(async (ctx) => {
      const org = await ctx.db.query("orgs").filter((q) => q.eq(q.field("orgId"), "org_sub1")).first();
      await ctx.db.patch(org!._id, { trialEndsAt: Date.now() - 1000 });
    });
    await owner.mutation(api.agencyBilling.extendTrial, { orgId: "org_sub1", days: 14 });
    const b = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    expect(b.billingStatus).toBe("trialing");
    expect(b.locked).toBe(false);
    expect(b.trialDaysLeft).toBeGreaterThanOrEqual(13);
  });

  it("_sweepTrials flips lapsed trials: no card → past_due, card → active", async () => {
    const owner = await seed();
    const promo = await owner.mutation(api.agencyPlans.create, {
      name: "Promo", priceCents: 0, billingInterval: "month", trialDays: 30,
      requireCardAfterTrial: true, isPromo: true,
    });
    // Second studio with a card already on file.
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "org_sub2", name: "Sub2", slug: "s2", plan: "studio", status: "active",
        agencyId: "org_ag", ownerEmail: "sub2@x",
      });
    });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub1", planId: promo });
    await owner.mutation(api.agencyBilling.assignPlan, { orgId: "org_sub2", planId: promo });
    await owner.mutation(api.agencyBilling.markActiveManually, { orgId: "org_sub2", onFile: true });
    // Re-open sub2 as trialing (markActive set it active) and lapse both.
    await t.run(async (ctx) => {
      for (const id of ["org_sub1", "org_sub2"]) {
        const org = await ctx.db.query("orgs").filter((q) => q.eq(q.field("orgId"), id)).first();
        await ctx.db.patch(org!._id, { billingStatus: "trialing", trialEndsAt: Date.now() - 1000 });
      }
    });
    await t.run(async (ctx) => {
      // call the internal sweep directly
      const { internal } = await import("./_generated/api");
      await ctx.runMutation(internal.agencyBilling._sweepTrials, {});
    });
    const b1 = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub1" });
    const b2 = await owner.query(api.agencyBilling.subaccountBilling, { orgId: "org_sub2" });
    expect(b1.billingStatus).toBe("past_due");
    expect(b1.locked).toBe(true);
    expect(b2.billingStatus).toBe("active");
    expect(b2.locked).toBe(false);
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
});
