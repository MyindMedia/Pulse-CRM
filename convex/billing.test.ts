import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";

describe("billing webhooks", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => { t = convexTest(schema); });

  function checkoutCompleted(opts: {
    customerId: string;
    subscriptionId: string;
    tier: "pro" | "agency";
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

  it("checkout.session.completed creates agency + owner on Pro tier", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: checkoutCompleted({
        customerId: "cus_1",
        subscriptionId: "sub_1",
        tier: "pro",
        clerkUserId: "u_owner",
      }),
    });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(1);
    expect(agencies[0].plan).toBe("pro");
    expect(agencies[0].stripeCustomerId).toBe("cus_1");

    const members = await t.run(async (ctx) => await ctx.db.query("agencyMembers").collect());
    expect(members.length).toBe(1);
    expect(members[0].role).toBe("owner");
  });

  it("duplicate event is a no-op (idempotency)", async () => {
    const event = checkoutCompleted({
      customerId: "cus_2",
      subscriptionId: "sub_2",
      tier: "agency",
      clerkUserId: "u_o",
    });
    const r1 = await t.mutation(internal.billingWebhooks.handle, { event });
    const r2 = await t.mutation(internal.billingWebhooks.handle, { event });
    expect(r1).toEqual({ duplicate: false });
    expect(r2).toEqual({ duplicate: true });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(1);
  });

  it("subscription.deleted pauses agency + sub-accounts", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("agencies", {
        agencyId: "org_ag",
        name: "AG",
        slug: "ag",
        plan: "agency",
        status: "active",
        ownerClerkUserId: "u_o",
        ownerEmail: "o@x",
        stripeCustomerId: "cus_3",
      });
      await ctx.db.insert("orgs", {
        orgId: "org_sub1",
        name: "S1",
        slug: "s1",
        plan: "studio",
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

  it("studio-tier checkout does NOT create an agency", async () => {
    await t.mutation(internal.billingWebhooks.handle, {
      event: {
        id: "evt_studio_1",
        type: "checkout.session.completed",
        data: {
          object: {
            customer: "cus_studio",
            subscription: "sub_studio",
            customer_email: "solo@x.com",
            metadata: {
              clerkUserId: "u_solo",
              intendedTier: "studio",
            },
          },
        },
      },
    });
    const agencies = await t.run(async (ctx) => await ctx.db.query("agencies").collect());
    expect(agencies.length).toBe(0);
  });
});
