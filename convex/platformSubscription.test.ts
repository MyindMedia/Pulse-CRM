import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { agencyActionForStatus, shouldEmailPaymentFailed, invoiceSubscriptionId } from "./lib/platformSubscription";

/* Platform subscription lifecycle (docs.stripe.com/billing/subscriptions/overview):
   trialing/active on, past_due on with a warning, unpaid/paused/canceled off,
   recovery back on. Invoice events drive the owner's payment warnings. */

describe("agencyActionForStatus", () => {
  it("maps every Stripe status", () => {
    expect(agencyActionForStatus("active")).toEqual({ kind: "set", status: "active" });
    expect(agencyActionForStatus("trialing")).toEqual({ kind: "set", status: "trial" });
    expect(agencyActionForStatus("past_due")).toEqual({ kind: "set", status: "past_due" });
    for (const s of ["unpaid", "paused", "incomplete_expired", "canceled"]) expect(agencyActionForStatus(s)).toEqual({ kind: "lock" });
    expect(agencyActionForStatus("incomplete")).toEqual({ kind: "ignore" });
  });
  it("emails on the first and the last failed attempt only", () => {
    expect(shouldEmailPaymentFailed({ attempt_count: 1, next_payment_attempt: 1_800_000_000 })).toBe(true);
    expect(shouldEmailPaymentFailed({ attempt_count: 3, next_payment_attempt: 1_800_000_000 })).toBe(false);
    expect(shouldEmailPaymentFailed({ attempt_count: 8, next_payment_attempt: null })).toBe(true);
  });
  it("stays quiet when the bank asked for confirmation (attempt 0), the action-required email covers it", () => {
    // Shape observed from Stripe (2025-08-27.basil) for an off-session 3D Secure renewal.
    expect(shouldEmailPaymentFailed({ attempt_count: 0, next_payment_attempt: null })).toBe(false);
  });
  it("reads the subscription id across API versions", () => {
    expect(invoiceSubscriptionId({ subscription: "sub_a" })).toBe("sub_a");
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_b" } } })).toBe("sub_b");
    expect(invoiceSubscriptionId({})).toBeUndefined();
  });
});

describe("platform subscription webhooks", () => {
  let t: ReturnType<typeof convexTest>;
  const ENV = { STRIPE_PRICE_CORE_MONTHLY: "price_core_m", STRIPE_PRICE_GROWTH_MONTHLY: "price_growth_m" };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    t = convexTest(schema);
    for (const [k, val] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = val; }
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  let n = 0;
  const send = (type: string, object: Record<string, unknown>) =>
    t.mutation(internal.billingWebhooks.handle, { event: { id: `evt_${type}_${++n}`, type, data: { object } } });
  const sub = (status: string, price = "price_core_m") => ({ id: "sub_p", customer: "cus_p", status, items: { data: [{ price: { id: price } }] } });
  const agency = () => t.run(async (ctx) => (await ctx.db.query("agencies").first())!);
  const studios = () => t.run(async (ctx) => await ctx.db.query("orgs").collect());

  async function seed() {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_p", name: "Apex", slug: "apex", plan: "core", status: "active",
        ownerClerkUserId: "u_p", ownerEmail: "owner@apex.test", stripeCustomerId: "cus_p", stripeSubscriptionId: "sub_p",
      });
      await ctx.db.insert("orgs", { orgId: "org_s1", name: "S1", slug: "s1", tier: "core", status: "active", agencyId: "org_p" });
      // Paused by hand before any billing problem: recovery must leave it paused.
      await ctx.db.insert("orgs", { orgId: "org_s2", name: "S2", slug: "s2", tier: "core", status: "paused", agencyId: "org_p" });
    });
  }

  it("subscription.created while trialing marks the agency on trial", async () => {
    await seed();
    await send("customer.subscription.created", sub("trialing"));
    expect((await agency()).status).toBe("trial");
  });

  it("past_due keeps studios on; unpaid pauses them; a recovered payment unpauses only those", async () => {
    await seed();
    await send("customer.subscription.updated", sub("past_due"));
    expect((await agency()).status).toBe("past_due");
    expect((await studios()).map((s) => s.status)).toEqual(["active", "paused"]);

    await send("customer.subscription.updated", sub("unpaid"));
    expect((await agency()).status).toBe("paused");
    expect((await studios()).map((s) => s.status)).toEqual(["paused", "paused"]);

    await send("customer.subscription.updated", sub("active", "price_growth_m"));
    const ag = await agency();
    expect(ag.status).toBe("active");
    expect(ag.plan).toBe("growth");
    expect(ag.billingPausedOrgIds).toBeUndefined();
    expect((await studios()).map((s) => s.status)).toEqual(["active", "paused"]);
  });

  it("a non-active status is no longer recorded as trial", async () => {
    await seed();
    await send("customer.subscription.updated", sub("past_due"));
    expect((await agency()).status).not.toBe("trial");
  });

  it("invoice.payment_failed marks past_due and schedules the owner email; invoice.paid clears it", async () => {
    await seed();
    await send("invoice.payment_failed", { customer: "cus_p", subscription: "sub_p", amount_due: 14900, attempt_count: 1, next_payment_attempt: 1_800_000_000 });
    let ag = await agency();
    expect(ag.status).toBe("past_due");
    expect(ag.paymentFailedAt).toBeTypeOf("number");
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("notifyPaymentFailed"))).toBe(true);

    await send("invoice.paid", { customer: "cus_p", subscription: "sub_p", amount_paid: 14900 });
    ag = await agency();
    expect(ag.status).toBe("active");
    expect(ag.paymentFailedAt).toBeUndefined();
  });

  it("a middle retry does not email again", async () => {
    await seed();
    await send("invoice.payment_failed", { customer: "cus_p", subscription: "sub_p", attempt_count: 3, next_payment_attempt: 1_800_000_000 });
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("notifyPaymentFailed"))).toBe(false);
  });

  it("invoice.payment_action_required stores the confirm link and schedules the email", async () => {
    await seed();
    await send("invoice.payment_action_required", { customer: "cus_p", subscription: "sub_p", hosted_invoice_url: "https://invoice.stripe.com/i/x" });
    expect((await agency()).paymentActionUrl).toBe("https://invoice.stripe.com/i/x");
    const jobs = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some((j) => j.name.includes("notifyActionRequired"))).toBe(true);
  });

  it("a studio-level invoice (another customer) touches no agency", async () => {
    await seed();
    await send("invoice.payment_failed", { customer: "cus_studio", subscription: "sub_studio", attempt_count: 1, next_payment_attempt: null });
    expect((await agency()).status).toBe("active");
  });

  it("subscription.deleted pauses and remembers which studios it paused", async () => {
    await seed();
    await send("customer.subscription.deleted", { customer: "cus_p", status: "canceled" });
    const ag = await agency();
    expect(ag.status).toBe("paused");
    expect(ag.billingPausedOrgIds?.length).toBe(1);
  });

  it("a canceled plan drops a stale confirm-payment link", async () => {
    await seed();
    await send("invoice.payment_action_required", { customer: "cus_p", subscription: "sub_p", hosted_invoice_url: "https://invoice.stripe.com/i/y" });
    await send("customer.subscription.deleted", { customer: "cus_p", status: "canceled" });
    const ag = await agency();
    expect(ag.status).toBe("paused");
    expect(ag.paymentActionUrl).toBeUndefined();
    expect(ag.paymentFailedAt).toBeUndefined();
  });
});
