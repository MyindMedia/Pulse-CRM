import { action, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { stripeClient, priceIdForTier } from "./lib/stripe";
import type { TierKey } from "./lib/plans";

const tierV = v.union(
  v.literal("studio"),
  v.literal("pro"),
  v.literal("growth"),
  v.literal("enterprise"),
  v.literal("agency"),
);

/** Public action - start a Stripe Checkout session for the chosen tier. */
export const beginCheckout = action({
  args: { tier: tierV, agencyName: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const stripe = stripeClient();
    const priceId = priceIdForTier(args.tier as TierKey);

    const customer = await stripe.customers.create({
      email: identity.email ?? undefined,
      name: identity.name ?? identity.email ?? undefined,
      metadata: {
        clerkUserId: identity.subject,
        intendedAgencyName: args.agencyName ?? "",
        intendedTier: args.tier,
      },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${baseUrl}/onboard/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/onboard`,
    });

    return { checkoutUrl: session.url };
  },
});

/** Public action - open the Stripe Customer Portal for the caller. */
export const openCustomerPortal = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const stripeCustomerId: string | null = await ctx.runQuery(
      internal.billing._customerIdForUser,
      { clerkUserId: identity.subject },
    );
    if (!stripeCustomerId) throw new Error("no billing customer");
    const stripe = stripeClient();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${baseUrl}/agency`,
    });
    return { portalUrl: session.url };
  },
});

/** Internal - look up a Stripe customer id by Clerk user id. */
export const _customerIdForUser = internalQuery({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_owner", (q) => q.eq("ownerClerkUserId", clerkUserId))
      .first();
    return ag?.stripeCustomerId ?? null;
  },
});

/** Public query - read the caller's current plan + status. */
export const myPlan = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const ag = await ctx.db
      .query("agencies")
      .withIndex("by_owner", (q) => q.eq("ownerClerkUserId", identity.subject))
      .first();
    if (!ag) return null;
    return { plan: ag.plan, status: ag.status, agencyId: ag.agencyId, name: ag.name };
  },
});
