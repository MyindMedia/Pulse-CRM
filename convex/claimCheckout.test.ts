import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* claimCheckout turns a paid Checkout session into a STUDIO under the Pulse
   agency (never an agency of the buyer's own: the console is the Pulse
   team's). It
   used to accept ANY completed session whose email matched (a setup-mode card
   save, a beta conversion, a one-off payment), read the tier from session
   metadata with "core" as the fallback, and hand an existing agency to
   whoever claimed its subscription. These tests hold the fix: a pay-first
   signup subscription only, live in Stripe, tier from the subscription's own
   price, and never a second owner. */

const fake: {
  sessions: Record<string, Record<string, unknown>>;
  subs: Record<string, { id: string; status: string; metadata?: Record<string, string>; items: { data: { price: { id: string } }[] } }>;
  updates: { id: string; metadata: Record<string, string> }[];
} = { sessions: {}, subs: {}, updates: [] };

vi.mock("./lib/stripe", async (orig) => {
  const real = await orig<typeof import("./lib/stripe")>();
  return {
    ...real,
    stripeClient: () => ({
      checkout: {
        sessions: {
          retrieve: async (id: string) => {
            const s = fake.sessions[id];
            if (!s) throw new Error("No such checkout session");
            return { id, ...s };
          },
        },
      },
      subscriptions: {
        retrieve: async (id: string) => {
          const s = fake.subs[id];
          if (!s) throw new Error("No such subscription");
          return s;
        },
        update: async (id: string, params: { metadata: Record<string, string> }) => {
          fake.updates.push({ id, metadata: params.metadata });
          if (fake.subs[id]) fake.subs[id].metadata = params.metadata;
          return fake.subs[id];
        },
      },
    }),
  };
});

vi.mock("./lib/clerkAllowlist", () => ({ allowClerkIdentifier: async () => undefined }));

const initT = () => convexTest(schema);
type TestT = ReturnType<typeof initT>;

const buyer = (t: TestT, subject = "u_buyer", email = "buyer@x.com") =>
  t.withIdentity({ subject, name: "Buyer", email });

function signupSession(over: Record<string, unknown> = {}) {
  return {
    status: "complete",
    payment_status: "paid",
    mode: "subscription",
    customer: "cus_b",
    subscription: "sub_b",
    customer_details: { email: "buyer@x.com" },
    custom_fields: [{ key: "studio_name", text: { value: "Buyer Studio" } }],
    metadata: { kind: "platform_signup", intendedTier: "max", intendedInterval: "month" },
    ...over,
  };
}

async function agencies(t: TestT) {
  return await t.run(async (ctx) => await ctx.db.query("agencies").collect());
}
async function studios(t: TestT) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("orgs").collect()).filter((o) => o.billingSubscriptionId));
}
async function owners(t: TestT) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("members").collect()).filter((m) => m.role === "owner"));
}
/** The Pulse team's agency and its Growth plan, as in prod. */
async function seedPulseAgency(t: TestT) {
  return await t.run(async (ctx) => {
    await ctx.db.insert("agencies", {
      agencyId: "agency_pulse", name: "Myind Sound", slug: "myind-sound", plan: "max", status: "active",
      ownerClerkUserId: "u_lawrence", ownerEmail: "l@x.com",
    });
    const base = { agencyId: "agency_pulse", billingInterval: "month" as const, trialDays: 14, active: true, isDefault: false, isPromo: false, requireCardAfterTrial: true, createdAt: 1 };
    await ctx.db.insert("agencyPlans", { ...base, name: "Core", priceCents: 14900 });
    return await ctx.db.insert("agencyPlans", { ...base, name: "Growth", priceCents: 29700 });
  });
}

describe("claimCheckout", () => {
  let t: TestT;
  const saved: Record<string, string | undefined> = {};
  const envKeys = ["STRIPE_PRICE_CORE_MONTHLY", "STRIPE_PRICE_GROWTH_MONTHLY", "STRIPE_PRICE_MAX_MONTHLY"];
  beforeEach(() => {
    t = initT();
    fake.sessions = {};
    fake.subs = {};
    fake.updates = [];
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

  it("provisions a studio under the Pulse agency, tier from the subscription's price", async () => {
    const growthPlan = await seedPulseAgency(t);
    // Metadata claims Max; the subscription is actually on the Growth price.
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "active", items: { data: [{ price: { id: "price_growth_m" } }] } };
    await buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" });
    const [studio] = await studios(t);
    expect(studio.name).toBe("Buyer Studio");
    expect(studio.tier).toBe("growth");
    expect(studio.agencyId).toBe("agency_pulse");
    expect(studio.agencyPlanId).toBe(growthPlan);
    expect(studio.billingCustomerId).toBe("cus_b");
    const [owner] = await owners(t);
    expect(owner.orgId).toBe(studio.orgId);
    expect(owner.clerkUserId).toBe("u_buyer");
    // The buyer is NOT an agency member, and no buyer agency was made.
    expect(await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect())).toHaveLength(0);
    expect((await agencies(t)).map((a) => a.agencyId)).toEqual(["agency_pulse"]);
    // The subscription now routes to the studio's billing.
    expect(fake.updates[0].metadata).toMatchObject({ kind: "subaccount_plan", orgId: studio.orgId });
  });

  it("a buyer sees their own studio, not the agency console", async () => {
    await seedPulseAgency(t);
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "trialing", items: { data: [{ price: { id: "price_core_m" } }] } };
    await buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" });
    expect(await buyer(t).query(api.agency.access, {})).toMatchObject({ allowed: false });
  });

  it("links a login whose email differs from the paid one (Apple Hide My Email), billing stays on the paid email", async () => {
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "trialing", items: { data: [{ price: { id: "price_core_m" } }] } };
    await buyer(t, "u_apple", "abc123@privaterelay.appleid.com").action(api.billing.claimCheckout, { sessionId: "cs_1" });
    const [studio] = await studios(t);
    expect(studio.ownerEmail).toBe("buyer@x.com");
    const [owner] = await owners(t);
    expect(owner.clerkUserId).toBe("u_apple");
    expect(owner.email).toBe("abc123@privaterelay.appleid.com");
  });

  it("the checkout link is single-use: a second login cannot claim the same subscription", async () => {
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "active", items: { data: [{ price: { id: "price_core_m" } }] } };
    await buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" });
    // Reloading the link as the same buyer is a no-op.
    await buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" });
    await expect(buyer(t, "u_other", "someone@else.com").action(api.billing.claimCheckout, { sessionId: "cs_1" })).rejects.toThrow(/already linked/);
    expect(await studios(t)).toHaveLength(1);
    expect((await owners(t)).map((m) => m.clerkUserId)).toEqual(["u_buyer"]);
  });

  it("refuses a session that is not a subscription signup", async () => {
    fake.sessions.cs_setup = signupSession({ mode: "setup", subscription: null });
    fake.sessions.cs_beta = signupSession({ metadata: { kind: "beta_conversion", tier: "max" } });
    fake.sessions.cs_none = signupSession({ metadata: {} });
    fake.subs.sub_b = { id: "sub_b", status: "active", items: { data: [{ price: { id: "price_max_m" } }] } };
    for (const id of ["cs_setup", "cs_beta", "cs_none"]) {
      await expect(buyer(t).action(api.billing.claimCheckout, { sessionId: id })).rejects.toThrow(/not a Pulse signup/);
    }
    expect(await studios(t)).toHaveLength(0);
  });

  it("refuses a subscription that is no longer live", async () => {
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "canceled", items: { data: [{ price: { id: "price_max_m" } }] } };
    await expect(buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" })).rejects.toThrow(/not active/);
    expect(await studios(t)).toHaveLength(0);
  });

  it("refuses a subscription whose price is not a Pulse tier instead of defaulting to Core", async () => {
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "trialing", items: { data: [{ price: { id: "price_other" } }] } };
    await expect(buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" })).rejects.toThrow(/not on a Pulse plan/);
    expect(await studios(t)).toHaveLength(0);
  });

  it("never hands an agency that already has an owner to someone else", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "agency_taken", name: "Taken", slug: "taken", plan: "max", status: "active",
        ownerClerkUserId: "u_real_owner", ownerEmail: "real@x.com",
        stripeCustomerId: "cus_b", stripeSubscriptionId: "sub_b",
      });
    });
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "active", items: { data: [{ price: { id: "price_max_m" } }] } };
    await expect(buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" })).rejects.toThrow(/already linked/);
    const rows = await agencies(t);
    expect(rows[0].ownerClerkUserId).toBe("u_real_owner");
    expect(await studios(t)).toHaveLength(0);
  });

  it("retires an unowned buyer agency for the subscription and makes a studio instead", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "agency_open", name: "Open", slug: "open", plan: "core", status: "trial",
        ownerClerkUserId: "", ownerEmail: "buyer@x.com",
        stripeCustomerId: "cus_b", stripeSubscriptionId: "sub_b",
      });
    });
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "active", items: { data: [{ price: { id: "price_max_m" } }] } };
    await buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" });
    expect(await agencies(t)).toHaveLength(0);
    expect((await owners(t))[0].clerkUserId).toBe("u_buyer");
  });

  it("converts the buyer's own agency from the old flow into a studio", async () => {
    await seedPulseAgency(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "agency_mine", name: "Mine", slug: "mine", plan: "growth", status: "active",
        ownerClerkUserId: "u_buyer", ownerEmail: "buyer@x.com",
        stripeCustomerId: "cus_b", stripeSubscriptionId: "sub_b",
      });
      await ctx.db.insert("agencyMembers", {
        agencyId: "agency_mine", clerkUserId: "u_buyer", email: "buyer@x.com", name: "Mine",
        role: "owner", status: "active", invitedAt: 1,
      });
    });
    expect(await buyer(t).query(api.agency.access, {})).toMatchObject({ allowed: false });
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "trialing", items: { data: [{ price: { id: "price_growth_m" } }] } };
    await buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" });
    expect((await agencies(t)).map((a) => a.agencyId)).toEqual(["agency_pulse"]);
    expect(await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect())).toHaveLength(0);
    expect((await studios(t))[0].agencyId).toBe("agency_pulse");
  });
});
