import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* Stripe Connect (P3) - the parts that don't need a live Stripe key:
   status, the webhook flag-flip, and the not-configured guards. */
describe("stripe connect", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("status: not connected, not configured (no key) by default", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
    const s = await t.query(api.stripeConnect.status, {});
    expect(s).toMatchObject({ connected: false, chargesEnabled: false, configured: false });
  });

  it("status reflects a connected, charges-enabled studio", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
        stripeAccountId: "acct_123", stripeChargesEnabled: true, stripeDetailsSubmitted: true,
      });
    });
    const s = await t.query(api.stripeConnect.status, {});
    expect(s).toMatchObject({ connected: true, chargesEnabled: true, detailsSubmitted: true });
  });

  it("createAccountLink throws when Stripe isn't configured", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
    await expect(t.action(api.stripeConnect.createAccountLink, {})).rejects.toThrow(/configured/i);
  });

  it("createDashboardLink throws when Stripe isn't configured", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
    await expect(t.action(api.stripeConnect.createDashboardLink, {})).rejects.toThrow(/configured/i);
  });

  it("createDashboardLink tells an unconnected studio to connect first", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy"; // configured, but org has no account → guard fires before any Stripe call
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
    });
    await expect(t.action(api.stripeConnect.createDashboardLink, {})).rejects.toThrow(/connect/i);
  });

  it("webhook account.updated flips the owning org's charge flags", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("orgs", {
        orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active",
        stripeAccountId: "acct_xyz", stripeChargesEnabled: false,
      });
    });
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_1", type: "account.updated",
        data: { object: { id: "acct_xyz", charges_enabled: true, details_submitted: true } },
      },
    });
    const org = await t.run(async (ctx) =>
      (await ctx.db.query("orgs").collect()).find((o) => o.stripeAccountId === "acct_xyz"));
    expect(org?.stripeChargesEnabled).toBe(true);
    expect(org?.stripeDetailsSubmitted).toBe(true);
  });

  describe("go-live reset of stale test Connect state", () => {
    async function seed() {
      return t.run(async (ctx) => {
        const orgId = "pulse-demo";
        await ctx.db.insert("orgs", {
          orgId, name: "Demo", slug: "demo", plan: "studio", status: "active",
          stripeAccountId: "acct_test", stripeChargesEnabled: true, stripeDetailsSubmitted: true,
        });
        const planId = await ctx.db.insert("membershipPlans", {
          orgId, name: "Gold", priceCents: 9900, billingInterval: "month",
          active: true, stripePriceId: "price_test", createdAt: 0,
        });
        const artistId = await ctx.db.insert("artists", {
          orgId, name: "Nova", type: "artist", genres: [], tags: [],
          status: "active", lifetimeValueCents: 0, sessionCount: 0, reliability: "solid",
        });
        await ctx.db.insert("memberships", {
          orgId, artistId, planId, status: "active", hoursUsedThisPeriod: 0,
          stripeSubscriptionId: "sub_test", stripeCustomerId: "cus_test", createdAt: 0,
        });
      });
    }

    it("dry run (default) reports counts but writes nothing", async () => {
      await seed();
      const res = await t.mutation(internal.stripeConnect._resetTestConnectStateForGoLive, {});
      expect(res).toMatchObject({ applied: false, orgsCleared: 1, plansCleared: 1, membershipsCancelled: 1 });
      await t.run(async (ctx) => {
        const org = (await ctx.db.query("orgs").collect())[0];
        expect(org.stripeAccountId).toBe("acct_test"); // untouched
        const m = (await ctx.db.query("memberships").collect())[0];
        expect(m.status).toBe("active");
        expect(m.stripeSubscriptionId).toBe("sub_test");
      });
    });

    it("apply clears connect fields and cancels memberships", async () => {
      await seed();
      const res = await t.mutation(internal.stripeConnect._resetTestConnectStateForGoLive, { dryRun: false });
      expect(res).toMatchObject({ applied: true, orgsCleared: 1, plansCleared: 1, membershipsCancelled: 1 });
      await t.run(async (ctx) => {
        const org = (await ctx.db.query("orgs").collect())[0];
        expect(org.stripeAccountId).toBeUndefined();
        expect(org.stripeChargesEnabled).toBeUndefined();
        expect(org.stripeDetailsSubmitted).toBeUndefined();
        const plan = (await ctx.db.query("membershipPlans").collect())[0];
        expect(plan.stripePriceId).toBeUndefined();
        const m = (await ctx.db.query("memberships").collect())[0];
        expect(m.status).toBe("cancelled");
        expect(m.stripeSubscriptionId).toBeUndefined();
        expect(m.stripeCustomerId).toBeUndefined();
      });
    });
  });
});
