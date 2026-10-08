import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

/* claimCheckout turns a paid Checkout session into an agency workspace. It
   used to accept ANY completed session whose email matched (a setup-mode card
   save, a beta conversion, a one-off payment), read the tier from session
   metadata with "core" as the fallback, and hand an existing agency to
   whoever claimed its subscription. These tests hold the fix: a pay-first
   signup subscription only, live in Stripe, tier from the subscription's own
   price, and never a second owner. */

const fake: {
  sessions: Record<string, Record<string, unknown>>;
  subs: Record<string, { id: string; status: string; items: { data: { price: { id: string } }[] } }>;
} = { sessions: {}, subs: {} };

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

describe("claimCheckout", () => {
  let t: TestT;
  const saved: Record<string, string | undefined> = {};
  const envKeys = ["STRIPE_PRICE_CORE_MONTHLY", "STRIPE_PRICE_GROWTH_MONTHLY", "STRIPE_PRICE_MAX_MONTHLY"];
  beforeEach(() => {
    t = initT();
    fake.sessions = {};
    fake.subs = {};
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

  it("provisions from a live signup subscription, tier from the subscription's price", async () => {
    // Metadata claims Max; the subscription is actually on the Growth price.
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "active", items: { data: [{ price: { id: "price_growth_m" } }] } };
    await buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" });
    const rows = await agencies(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].plan).toBe("growth");
    expect(rows[0].ownerClerkUserId).toBe("u_buyer");
  });

  it("refuses a session that is not a subscription signup", async () => {
    fake.sessions.cs_setup = signupSession({ mode: "setup", subscription: null });
    fake.sessions.cs_beta = signupSession({ metadata: { kind: "beta_conversion", tier: "max" } });
    fake.sessions.cs_none = signupSession({ metadata: {} });
    fake.subs.sub_b = { id: "sub_b", status: "active", items: { data: [{ price: { id: "price_max_m" } }] } };
    for (const id of ["cs_setup", "cs_beta", "cs_none"]) {
      await expect(buyer(t).action(api.billing.claimCheckout, { sessionId: id })).rejects.toThrow(/not a Pulse signup/);
    }
    expect(await agencies(t)).toHaveLength(0);
  });

  it("refuses a subscription that is no longer live", async () => {
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "canceled", items: { data: [{ price: { id: "price_max_m" } }] } };
    await expect(buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" })).rejects.toThrow(/not active/);
    expect(await agencies(t)).toHaveLength(0);
  });

  it("refuses a subscription whose price is not a Pulse tier instead of defaulting to Core", async () => {
    fake.sessions.cs_1 = signupSession();
    fake.subs.sub_b = { id: "sub_b", status: "trialing", items: { data: [{ price: { id: "price_other" } }] } };
    await expect(buyer(t).action(api.billing.claimCheckout, { sessionId: "cs_1" })).rejects.toThrow(/not on a Pulse plan/);
    expect(await agencies(t)).toHaveLength(0);
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
    const members = await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect());
    expect(members).toHaveLength(0);
  });

  it("claims an existing agency for its subscription when it has no owner yet", async () => {
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
    const rows = await agencies(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerClerkUserId).toBe("u_buyer");
  });
});
