import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

/* Stripe Connect (P3) — the parts that don't need a live Stripe key:
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
});
