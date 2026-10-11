import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { toSubscriptionShape } from "./trialBilling";

/* Owner rule, 2026-10-10: a studio gets the features of its plan, sees the
   rest grayed out, and gets them by upgrading in Settings. Settings used to
   call the old agency checkout, which opened a SECOND subscription for a
   studio that already had one and never moved its tier. These tests hold
   the fix: change the live subscription in place, and let the price on it
   decide the tier. */

type FakeSub = { id: string; status: string; customer: string; items: { data: { id: string; price: { id: string; recurring: { interval: string } } }[] } };
const fake: {
  subs: Record<string, FakeSub>;
  retrieveError: { message: string; code?: string } | null;
  portal: Record<string, unknown>[];
  checkout: Record<string, unknown>[];
} = { subs: {}, retrieveError: null, portal: [], checkout: [] };

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      customers: { create: async () => ({ id: "cus_new" }) },
      subscriptions: {
        retrieve: async (id: string) => {
          if (fake.retrieveError) throw Object.assign(new Error(fake.retrieveError.message), { code: fake.retrieveError.code });
          const s = fake.subs[id];
          if (!s) throw Object.assign(new Error("No such subscription"), { code: "resource_missing" });
          return s;
        },
      },
      billingPortal: {
        sessions: {
          create: async (params: Record<string, unknown>) => {
            fake.portal.push(params);
            return { url: "https://billing.stripe.test/portal" };
          },
        },
      },
      checkout: {
        sessions: {
          create: async (params: Record<string, unknown>) => {
            fake.checkout.push(params);
            return { id: "cs_new", url: "https://checkout.stripe.test/cs_new" };
          },
        },
      },
    }),
  };
});

const initT = () => convexTest(schema);
type TestT = ReturnType<typeof initT>;
const ORG = "studio_test";
const owner = (t: TestT) => t.withIdentity({ subject: "u_owner", email: "owner@x.com" });
const engineer = (t: TestT) => t.withIdentity({ subject: "u_eng", email: "eng@x.com" });

const subOn = (id: string, price: string, status = "trialing"): FakeSub => ({
  id, status, customer: "cus_b",
  items: { data: [{ id: "si_1", price: { id: price, recurring: { interval: "month" } } }] },
});

async function seedStudio(t: TestT, extra: Record<string, unknown> = {}) {
  await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "agency_pulse", name: "Myind Sound", slug: "myind-sound", plan: "max", status: "active",
      ownerClerkUserId: "u_lawrence", ownerEmail: "l@x.com",
    });
    const base = { agencyId: "agency_pulse", billingInterval: "month" as const, trialDays: 14, active: true, isDefault: false, isPromo: false, requireCardAfterTrial: true, createdAt: 1 };
    const growth = await ctx.db.insert("agencyPlans", { ...base, name: "Growth", priceCents: 29700 });
    await ctx.db.insert("agencyPlans", { ...base, name: "Max", priceCents: 49999 });
    await ctx.db.insert("orgs", {
      orgId: ORG, name: "Test Studio", slug: "test-studio", tier: "growth", status: "active",
      agencyId: "agency_pulse", agencyPlanId: growth, billingStatus: "trialing",
      billingCustomerId: "cus_b", ownerEmail: "owner@x.com",
      ...extra,
    });
    await ctx.db.insert("members", { orgId: ORG, name: "Owner", role: "owner", skills: [], clerkUserId: "u_owner", email: "owner@x.com" });
    await ctx.db.insert("members", { orgId: ORG, name: "Eng", role: "engineer", skills: [], clerkUserId: "u_eng", email: "eng@x.com" });
  });
}
const studio = (t: TestT) =>
  t.run(async (ctx) => await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", ORG)).first());

describe("changeMyPlan", () => {
  const envKeys = ["STRIPE_PRICE_CORE_MONTHLY", "STRIPE_PRICE_GROWTH_MONTHLY", "STRIPE_PRICE_MAX_MONTHLY"];
  const saved: Record<string, string | undefined> = {};
  let t: TestT;
  beforeEach(() => {
    t = initT();
    fake.subs = {};
    fake.retrieveError = null;
    fake.portal = [];
    fake.checkout = [];
    for (const k of envKeys) saved[k] = process.env[k];
    process.env.STRIPE_PRICE_CORE_MONTHLY = "price_core_m";
    process.env.STRIPE_PRICE_GROWTH_MONTHLY = "price_growth_m";
    process.env.STRIPE_PRICE_MAX_MONTHLY = "price_max_m";
  });
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("changes a live subscription in place through the portal, never a second checkout", async () => {
    await seedStudio(t, { billingSubscriptionId: "sub_b" });
    fake.subs.sub_b = subOn("sub_b", "price_growth_m");
    const r = await owner(t).action(api.agencyBilling.changeMyPlan, { tier: "max" });
    expect(r.via).toBe("portal");
    expect(fake.checkout).toHaveLength(0);
    expect(fake.portal[0]).toMatchObject({
      customer: "cus_b",
      flow_data: {
        type: "subscription_update_confirm",
        subscription_update_confirm: { subscription: "sub_b", items: [{ id: "si_1", price: "price_max_m", quantity: 1 }] },
      },
    });
  });

  it("refuses to 'change' to the plan the studio is already on", async () => {
    await seedStudio(t, { billingSubscriptionId: "sub_b" });
    fake.subs.sub_b = subOn("sub_b", "price_growth_m");
    await expect(owner(t).action(api.agencyBilling.changeMyPlan, { tier: "growth" })).rejects.toThrow(/already on that plan/);
  });

  it("a studio with no subscription gets a studio-scoped checkout with the trial", async () => {
    await seedStudio(t);
    const r = await owner(t).action(api.agencyBilling.changeMyPlan, { tier: "max" });
    expect(r.via).toBe("checkout");
    const params = fake.checkout[0] as { metadata: Record<string, string>; subscription_data: { metadata: Record<string, string>; trial_period_days?: number }; line_items: { price: string }[] };
    expect(params.metadata).toMatchObject({ kind: "subaccount_plan", orgId: ORG, tier: "max" });
    expect(params.subscription_data.metadata).toMatchObject({ kind: "subaccount_plan", orgId: ORG });
    expect(params.subscription_data.trial_period_days).toBe(14);
    expect(params.line_items[0].price).toBe("price_max_m");
  });

  it("a lapsed subscription restarts without a second trial", async () => {
    await seedStudio(t, { billingSubscriptionId: "sub_old" });
    fake.subs.sub_old = subOn("sub_old", "price_growth_m", "canceled");
    await owner(t).action(api.agencyBilling.changeMyPlan, { tier: "growth" });
    const params = fake.checkout[0] as { subscription_data: { trial_period_days?: number } };
    expect(params.subscription_data.trial_period_days).toBeUndefined();
  });

  it("a Stripe outage stops the change instead of risking a second subscription", async () => {
    await seedStudio(t, { billingSubscriptionId: "sub_b" });
    fake.retrieveError = { message: "Stripe is down", code: "api_connection_error" };
    await expect(owner(t).action(api.agencyBilling.changeMyPlan, { tier: "max" })).rejects.toThrow(/Stripe is down/);
    expect(fake.checkout).toHaveLength(0);
  });

  it("only the owner can change the plan", async () => {
    await seedStudio(t, { billingSubscriptionId: "sub_b" });
    fake.subs.sub_b = subOn("sub_b", "price_growth_m");
    await expect(engineer(t).action(api.agencyBilling.changeMyPlan, { tier: "max" })).rejects.toThrow();
    expect(fake.portal).toHaveLength(0);
  });
});

describe("the price on the subscription decides the tier", () => {
  const envKeys = ["STRIPE_PRICE_GROWTH_MONTHLY", "STRIPE_PRICE_MAX_MONTHLY"];
  const saved: Record<string, string | undefined> = {};
  let t: TestT;
  beforeEach(() => {
    t = initT();
    for (const k of envKeys) saved[k] = process.env[k];
    process.env.STRIPE_PRICE_GROWTH_MONTHLY = "price_growth_m";
    process.env.STRIPE_PRICE_MAX_MONTHLY = "price_max_m";
  });
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("reads the price off a Stripe subscription object", () => {
    expect(toSubscriptionShape(subOn("sub_b", "price_max_m") as unknown as Record<string, unknown>).price_id).toBe("price_max_m");
  });

  it("an upgrade in the portal moves the studio to Max and its plan row", async () => {
    await seedStudio(t, { billingSubscriptionId: "sub_b" });
    await t.mutation(internal.trialBilling._applyOrgSubscription, {
      orgId: ORG,
      sub: { id: "sub_b", status: "active", customer: "cus_b", price_id: "price_max_m", metadata: { kind: "subaccount_plan", orgId: ORG } },
    });
    const org = await studio(t);
    expect(org?.tier).toBe("max");
    const plan = await t.run(async (ctx) => (org?.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null));
    expect(plan?.name).toBe("Max");
  });

  it("an unknown price leaves the tier alone", async () => {
    await seedStudio(t, { billingSubscriptionId: "sub_b" });
    await t.mutation(internal.trialBilling._applyOrgSubscription, {
      orgId: ORG,
      sub: { id: "sub_b", status: "active", customer: "cus_b", price_id: "price_other", metadata: { orgId: ORG } },
    });
    expect((await studio(t))?.tier).toBe("growth");
  });
});

describe("hide features from higher plans", () => {
  it("leadership can hide them; the sidebar reads it from orgs.current", async () => {
    const t = initT();
    await seedStudio(t);
    expect((await owner(t).query(api.orgs.current, {}))?.hideLockedFeatures).toBe(false);
    await owner(t).mutation(api.orgs.setHideLockedFeatures, { hide: true });
    expect((await owner(t).query(api.orgs.current, {}))?.hideLockedFeatures).toBe(true);
  });

  it("an engineer cannot change it", async () => {
    const t = initT();
    await seedStudio(t);
    await expect(engineer(t).mutation(api.orgs.setHideLockedFeatures, { hide: true })).rejects.toThrow();
  });
});

describe("the Pulse agency's main owner", () => {
  it("_setPlatformOwner makes a new login an owner and the main owner; the old owner keeps access", async () => {
    const t = initT();
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "agency_pulse", name: "Myind Sound", slug: "myind-sound", plan: "max", status: "active",
        ownerClerkUserId: "u_old", ownerEmail: "old@x.com",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "agency_pulse", clerkUserId: "u_old", email: "old@x.com", name: "Old",
        role: "owner", status: "active", invitedAt: 1,
      });
    });
    await t.mutation(internal.agencyStaff._setPlatformOwner, { clerkUserId: "u_new", email: "New@X.com", name: "New" });
    const agency = await t.run(async (ctx) => await ctx.db.query("agencies").first());
    expect(agency).toMatchObject({ ownerClerkUserId: "u_new", ownerEmail: "new@x.com" });
    for (const subject of ["u_new", "u_old"]) {
      expect(await t.withIdentity({ subject }).query(api.agency.access, {})).toMatchObject({ allowed: true });
    }
    // Running it twice does not add a second row.
    await t.mutation(internal.agencyStaff._setPlatformOwner, { clerkUserId: "u_new", email: "new@x.com", name: "New" });
    const rows = await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect());
    expect(rows.filter((r) => r.clerkUserId === "u_new")).toHaveLength(1);
  });
});
