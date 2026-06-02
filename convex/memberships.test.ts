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

describe("auto-Stripe packages + public subscribe", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { vi.useFakeTimers(); t = convexTest(schema); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("createPlanWithStripe saves an unlinked plan when Stripe is not connected", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const res = await t.action(api.memberships.createPlanWithStripe, {
      name: "Producer Pass",
      priceCents: 24900,
      billingInterval: "month",
      memberDiscountPct: 10,
    });
    expect(res.linked).toBe(false);
    const plans = await t.query(api.memberships.listPlans, {});
    expect(plans).toHaveLength(1);
    expect(plans[0].stripePriceId).toBeUndefined();
    expect(plans[0].name).toBe("Producer Pass");
  });

  it("createPlanWithStripe rejects zero price", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    await expect(
      t.action(api.memberships.createPlanWithStripe, {
        name: "Bad", priceCents: 0, billingInterval: "month",
      }),
    ).rejects.toThrow();
  });

  it("publicPlans returns only active, Stripe-linked plans for the slug's org", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org-a", name: "Studio A", slug: "studio-a", plan: "studio" });
      await ctx.db.insert("orgs", { orgId: "org-b", name: "Studio B", slug: "studio-b", plan: "studio" });
      // org-a: one subscribable, one unlinked, one archived-but-linked
      await ctx.db.insert("membershipPlans", {
        orgId: "org-a", name: "Live", priceCents: 5000, billingInterval: "month",
        active: true, stripePriceId: "price_live", createdAt: Date.now(),
      });
      await ctx.db.insert("membershipPlans", {
        orgId: "org-a", name: "Draft", priceCents: 6000, billingInterval: "month",
        active: true, createdAt: Date.now(),
      });
      await ctx.db.insert("membershipPlans", {
        orgId: "org-a", name: "Archived", priceCents: 7000, billingInterval: "month",
        active: false, stripePriceId: "price_arch", createdAt: Date.now(),
      });
      // org-b plan must never leak into org-a's page
      await ctx.db.insert("membershipPlans", {
        orgId: "org-b", name: "Other", priceCents: 8000, billingInterval: "month",
        active: true, stripePriceId: "price_other", createdAt: Date.now(),
      });
    });

    const plans = await t.query(api.memberships.publicPlans, { slug: "studio-a" });
    expect(plans.map((p) => p.name)).toEqual(["Live"]);
    expect(await t.query(api.memberships.publicPlans, { slug: "nope" })).toEqual([]);
  });

  it("_publicSubscribeContext resolves by slug and rejects a cross-org plan", async () => {
    const { aPlan, bPlan } = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org-a", name: "A", slug: "studio-a", plan: "studio" });
      await ctx.db.insert("orgs", { orgId: "org-b", name: "B", slug: "studio-b", plan: "studio" });
      const aPlan = await ctx.db.insert("membershipPlans", {
        orgId: "org-a", name: "A plan", priceCents: 5000, billingInterval: "month",
        active: true, stripePriceId: "price_a", createdAt: Date.now(),
      });
      const bPlan = await ctx.db.insert("membershipPlans", {
        orgId: "org-b", name: "B plan", priceCents: 5000, billingInterval: "month",
        active: true, stripePriceId: "price_b", createdAt: Date.now(),
      });
      return { aPlan, bPlan };
    });

    const ok = await t.query(internal.memberships._publicSubscribeContext, { slug: "studio-a", planId: aPlan });
    expect(ok?.orgId).toBe("org-a");
    // A plan from a different org must not resolve under studio-a's slug.
    const bad = await t.query(internal.memberships._publicSubscribeContext, { slug: "studio-a", planId: bPlan });
    expect(bad).toBeNull();
  });

  it("_findOrCreateArtistForSub dedupes by email within an org", async () => {
    const first = await t.mutation(internal.memberships._findOrCreateArtistForSub, {
      orgId: "org-a", name: "Nova", email: "Nova@Example.com",
    });
    const again = await t.mutation(internal.memberships._findOrCreateArtistForSub, {
      orgId: "org-a", name: "Nova R", email: "nova@example.com",
    });
    expect(again).toBe(first); // case-insensitive match, no duplicate
    const other = await t.mutation(internal.memberships._findOrCreateArtistForSub, {
      orgId: "org-a", name: "Kilo", email: "kilo@example.com",
    });
    expect(other).not.toBe(first);
    const created = await t.run(async (ctx) => ctx.db.get(first));
    expect(created?.source).toBe("membership_signup");
    expect(created?.status).toBe("lead");
  });

  it("subscribePublic rejects cleanly when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const planId = await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "org-a", name: "A", slug: "studio-a", plan: "studio" });
      return ctx.db.insert("membershipPlans", {
        orgId: "org-a", name: "A plan", priceCents: 5000, billingInterval: "month",
        active: true, stripePriceId: "price_a", createdAt: Date.now(),
      });
    });
    await expect(
      t.action(api.memberships.subscribePublic, {
        slug: "studio-a", planId, clientName: "Nova", clientEmail: "nova@example.com",
      }),
    ).rejects.toThrow();
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
