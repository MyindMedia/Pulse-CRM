import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

describe("billing webhooks", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  function checkoutCompleted(opts: {
    customerId: string;
    subscriptionId: string;
    tier: "core" | "growth" | "max";
    clerkUserId: string;
    agencyName?: string;
    ownerEmail?: string;
  }) {
    return {
      id: `evt_${opts.customerId}_${opts.tier}`,
      type: "checkout.session.completed",
      data: {
        object: {
          customer: opts.customerId,
          subscription: opts.subscriptionId,
          customer_email: opts.ownerEmail ?? "owner@example.com",
          metadata: {
            clerkUserId: opts.clerkUserId,
            intendedAgencyName: opts.agencyName ?? "Test Agency",
            intendedTier: opts.tier,
          },
        },
      },
    };
  }

  it("checkout.session.completed creates agency + owner on Growth tier", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: checkoutCompleted({
        customerId: "cus_1",
        subscriptionId: "sub_1",
        tier: "growth",
        clerkUserId: "u_owner",
      }),
    });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(1);
    expect(agencies[0].plan).toBe("growth");
    expect(agencies[0].stripeCustomerId).toBe("cus_1");

    const members = await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect());
    expect(members.length).toBe(1);
    expect(members[0].role).toBe("owner");
  });

  it("duplicate event is a no-op (idempotency)", async () => {
    const event = checkoutCompleted({
      customerId: "cus_2",
      subscriptionId: "sub_2",
      tier: "max",
      clerkUserId: "u_o",
    });
    const r1 = await t.mutation(internal.billingWebhooks.handle, { event });
    const r2 = await t.mutation(internal.billingWebhooks.handle, { event });
    expect(r1).toEqual({ duplicate: false });
    expect(r2).toEqual({ duplicate: true });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(1);
  });

  it("records each processed event in the indexed stripeEvents ledger", async () => {
    const event = checkoutCompleted({ customerId: "cus_l", subscriptionId: "sub_l", tier: "core", clerkUserId: "u_l" });
    await t.mutation(internal.billingWebhooks.handle, { event });
    const rows = (await t.run(async (ctx) => await ctx.db.query("stripeEvents").collect()))
      .filter((r) => r.eventId === event.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("checkout.session.completed");
    // No new marker in the audit log: the ledger is the only record now.
    const audit = await t.run(async (ctx) => await ctx.db.query("auditEvents").collect());
    expect(audit.filter((a) => a.action === "stripe.event")).toHaveLength(0);
  });

  it("still treats an event marked by the old audit-log ledger as a duplicate", async () => {
    // Events processed before the stripeEvents table existed were marked in
    // auditEvents. Stripe retries for days, so those must stay duplicates.
    await t.run(async (ctx) => {
      await ctx.db.insert("auditEvents", {
        viewerType: "guest", viewerId: "evt_legacy", action: "stripe.event", result: "allow",
        reason: "checkout.session.completed",
      });
    });
    const r = await t.mutation(internal.billingWebhooks.handle, {
      event: { ...checkoutCompleted({ customerId: "cus_x", subscriptionId: "sub_x", tier: "max", clerkUserId: "u_x" }), id: "evt_legacy" },
    });
    expect(r).toEqual({ duplicate: true });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies).toHaveLength(0);
  });

  it("subscription.deleted pauses agency + sub-accounts", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag",
        name: "AG",
        slug: "ag",
        plan: "max",
        status: "active",
        ownerClerkUserId: "u_o",
        ownerEmail: "o@x",
        stripeCustomerId: "cus_3",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1",
        name: "S1",
        slug: "s1",
        tier: "growth",
        status: "active",
        agencyId: "org_ag",
      });
    });
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_del_1",
        type: "customer.subscription.deleted",
        data: { object: { customer: "cus_3" } },
      },
    });
    const ag = await t.run(async (ctx) => await ctx.db.query("agencies").first());
    expect(ag!.status).toBe("paused");
    const sub = await t.run(async (ctx) => await ctx.db.query("orgs").first());
    expect(sub!.status).toBe("paused");
  });

  it("core-tier checkout provisions too: the old cheapest-tier skip is gone", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_core_1",
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_core",
            subscription: "sub_core",
            customer_email: "solo@x.com",
            metadata: {
              clerkUserId: "u_solo",
              intendedTier: "core",
            },
          },
        },
      },
    });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(1);
    expect(agencies[0].plan).toBe("core");
  });

  it("an unknown intended tier resolves to core, never a paid tier", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_weird_1",
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_weird",
            subscription: "sub_weird",
            customer_email: "w@x.com",
            metadata: { clerkUserId: "u_w", intendedTier: "platinum" },
          },
        },
      },
    });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies[0].plan).toBe("core");
  });

  describe("subscription.updated maps every price, downgrades included", () => {
    const ENV = {
      STRIPE_PRICE_CORE_MONTHLY: "price_core_m",
      STRIPE_PRICE_CORE_ANNUAL: "price_core_y",
      STRIPE_PRICE_GROWTH_MONTHLY: "price_growth_m",
      STRIPE_PRICE_GROWTH_ANNUAL: "price_growth_y",
      STRIPE_PRICE_MAX_MONTHLY: "price_max_m",
      STRIPE_PRICE_MAX_ANNUAL: "price_max_y",
    };
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const [k, val] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = val; }
    });
    afterEach(() => {
      for (const k of Object.keys(ENV)) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
      }
    });

    async function seedAgency(plan: "core" | "growth" | "max") {
      await t.run(async (ctx) => {
        await ctx.db.insert("agencies", {
          agencyId: "org_up", name: "Up", slug: "up", plan, status: "active",
          ownerClerkUserId: "u_up", ownerEmail: "up@x", stripeCustomerId: "cus_up",
        });
      });
    }
    async function update(priceId: string, id: string) {
      await t.mutation(internal.billingWebhooks.handle, {
        event: {
          id,
          type: "customer.subscription.updated",
          data: { object: { customer: "cus_up", status: "active", items: { data: [{ price: { id: priceId } }] } } },
        },
      });
      return (await t.run(async (ctx) => await ctx.db.query("agencies").first()))!.plan;
    }

    it("records a downgrade to core", async () => {
      await seedAgency("max");
      expect(await update("price_core_m", "evt_up_1")).toBe("core");
    });

    it("maps annual prices to their tier", async () => {
      await seedAgency("core");
      expect(await update("price_growth_y", "evt_up_2")).toBe("growth");
      expect(await update("price_max_y", "evt_up_3")).toBe("max");
    });

    it("leaves the plan alone for a price it does not know", async () => {
      await seedAgency("growth");
      expect(await update("price_someone_else", "evt_up_4")).toBe("growth");
    });
  });
});

describe("billing webhooks - connected-account events never provision a platform agency", () => {
  it("a Connect checkout.session.completed with platform_signup metadata creates no agency, member or activation email", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_connect_signup",
        type: "checkout.session.completed",
        account: "acct_studio_connected",
        data: {
          object: {
            id: "cs_connect_1",
            customer: "cus_connect",
            subscription: "sub_connect",
            customer_email: "attacker@example.com",
            metadata: {
              kind: "platform_signup",
              clerkUserId: "u_attacker",
              intendedAgencyName: "Free Max",
              intendedTier: "max",
            },
          },
        },
      },
    });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    const members = await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect());
    const scheduled = await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect());
    expect(agencies).toEqual([]);
    expect(members).toEqual([]);
    expect(scheduled).toEqual([]);
    // Recorded as processed, so a Stripe retry is a no-op too.
    const ledger = await t.run(async (ctx) => await ctx.db.query("stripeEvents").collect());
    expect(ledger.some((r) => r.eventId === "evt_connect_signup")).toBe(true);
  });
});
