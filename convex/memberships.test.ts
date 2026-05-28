import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { applyMembershipDiscount, remainingBundledHours, hasPriorityBooking } from "./memberships";

const ORG = "pulse-demo";

describe("membership perks (pure)", () => {
  it("returns the full rate when no plan or no discount", () => {
    expect(applyMembershipDiscount(10000, null)).toBe(10000);
    expect(applyMembershipDiscount(10000, { memberDiscountPct: 0 })).toBe(10000);
  });

  it("applies the discount, clamps out-of-range values, and rounds to cents", () => {
    expect(applyMembershipDiscount(10000, { memberDiscountPct: 20 })).toBe(8000);
    expect(applyMembershipDiscount(10001, { memberDiscountPct: 25 })).toBe(7501);
    expect(applyMembershipDiscount(10000, { memberDiscountPct: 150 })).toBe(0);
    expect(applyMembershipDiscount(10000, { memberDiscountPct: -5 })).toBe(10000);
  });

  it("tracks remaining bundled hours per period", () => {
    expect(remainingBundledHours(null, { bundledHoursPerPeriod: 8 })).toBeNull();
    expect(remainingBundledHours({ hoursUsedThisPeriod: 3 }, { bundledHoursPerPeriod: 8 })).toBe(5);
    expect(remainingBundledHours({ hoursUsedThisPeriod: 12 }, { bundledHoursPerPeriod: 8 })).toBe(0);
    expect(remainingBundledHours({ hoursUsedThisPeriod: 0 }, null)).toBeNull();
  });

  it("reports priority booking", () => {
    expect(hasPriorityBooking(null)).toBe(false);
    expect(hasPriorityBooking({ priorityBooking: true })).toBe(true);
    expect(hasPriorityBooking({ priorityBooking: false })).toBe(false);
  });
});

describe("plans + memberships", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("createPlan persists with sane defaults; listPlans honors activeOnly", async () => {
    const id = await t.mutation(api.memberships.createPlan, {
      name: "Producer Pass",
      description: "Bundled hours + 10% off",
      priceCents: 24900,
      billingInterval: "month",
      bundledHoursPerPeriod: 8,
      memberDiscountPct: 10,
      priorityBooking: true,
    });
    await t.mutation(api.memberships.setPlanActive, { id, active: false });

    const all = await t.query(api.memberships.listPlans, {});
    const active = await t.query(api.memberships.listPlans, { activeOnly: true });
    expect(all).toHaveLength(1);
    expect(active).toHaveLength(0);
  });

  it("createPlan rejects zero/negative price and out-of-range discount", async () => {
    await expect(
      t.mutation(api.memberships.createPlan, { name: "Bad", priceCents: 0, billingInterval: "month" }),
    ).rejects.toThrow();
    await expect(
      t.mutation(api.memberships.createPlan, {
        name: "Bad", priceCents: 1000, billingInterval: "month", memberDiscountPct: 150,
      }),
    ).rejects.toThrow();
  });

  it("_applySubscriptionEvent activates a pending membership by subscription id", async () => {
    const { membershipId } = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const planId = await ctx.db.insert("membershipPlans", {
        orgId: ORG, name: "Producer Pass", priceCents: 24900, billingInterval: "month",
        active: true, stripePriceId: "price_test", createdAt: Date.now(),
      });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: ORG, artistId, planId, status: "pending",
        hoursUsedThisPeriod: 0, createdAt: Date.now(),
      });
      return { membershipId };
    });

    // First event: create-side hint (no prior stripeSubscriptionId on the row).
    await t.mutation(internal.memberships._applySubscriptionEvent, {
      stripeSubscriptionId: "sub_AAA",
      stripeCustomerId: "cus_AAA",
      status: "active",
      membershipIdHint: membershipId,
    });
    let m = await t.run(async (ctx) => ctx.db.get(membershipId));
    expect(m?.status).toBe("active");
    expect(m?.stripeSubscriptionId).toBe("sub_AAA");

    // Second event: period rolls; bundled-hours counter resets.
    await t.run(async (ctx) => ctx.db.patch(membershipId, { hoursUsedThisPeriod: 4, currentPeriodStart: 1000 }));
    await t.mutation(internal.memberships._applySubscriptionEvent, {
      stripeSubscriptionId: "sub_AAA",
      status: "active",
      currentPeriodStart: 9999,
      currentPeriodEnd: 9999 + 86400 * 30 * 1000,
    });
    m = await t.run(async (ctx) => ctx.db.get(membershipId));
    expect(m?.hoursUsedThisPeriod).toBe(0);
    expect(m?.currentPeriodStart).toBe(9999);
  });

  it("subscribeViaStripe rejects cleanly when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { artistId, planId } = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [], email: "nova@x.com",
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const planId = await ctx.db.insert("membershipPlans", {
        orgId: ORG, name: "Producer Pass", priceCents: 24900, billingInterval: "month",
        active: true, stripePriceId: "price_test", createdAt: Date.now(),
      });
      return { artistId, planId };
    });
    await expect(t.action(api.memberships.subscribeViaStripe, { artistId, planId })).rejects.toThrow();
    vi.unstubAllEnvs();
  });
});

describe("webhook -> membership activation", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); });

  it("checkout.session.completed with metadata.membershipId activates the membership", async () => {
    const { membershipId } = await t.run(async (ctx) => {
      const artistId = await ctx.db.insert("artists", {
        orgId: ORG, name: "Nova", type: "artist", genres: [], tags: [],
        status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
      });
      const planId = await ctx.db.insert("membershipPlans", {
        orgId: ORG, name: "Producer Pass", priceCents: 24900, billingInterval: "month",
        active: true, stripePriceId: "price_test", createdAt: Date.now(),
      });
      const membershipId = await ctx.db.insert("memberships", {
        orgId: ORG, artistId, planId, status: "pending",
        hoursUsedThisPeriod: 0, createdAt: Date.now(),
      });
      return { membershipId };
    });

    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_ck_1",
        type: "checkout.session.completed",
        account: "acct_studio",
        data: {
          object: {
            id: "cs_1",
            subscription: "sub_ZZZ",
            customer: "cus_ZZZ",
            metadata: { membershipId },
          },
        },
      },
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const m = await t.run(async (ctx) => ctx.db.get(membershipId));
    expect(m?.status).toBe("active");
    expect(m?.stripeSubscriptionId).toBe("sub_ZZZ");
    expect(m?.stripeCustomerId).toBe("cus_ZZZ");
  });
});
