import { action, query, internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { stripeClient, priceIdForTier, priceIdForTierInterval } from "./lib/stripe";
import type { TierKey } from "./lib/plans";
import {
  EARLY_ADOPTER_MONTHS, EARLY_ADOPTER_DISCOUNT_PCT, earlyAdopterApplies,
} from "./lib/plans";
import { sendEmail } from "./lib/email";
import { activationEmailSubject, activationEmailHtml } from "./lib/emailTemplates/activation";

// The three tiers a studio can buy without talking to anyone.
// Flow is not in here: there is nothing to check out for: it is activated by
// connecting Stripe, not by paying a subscription.
const SELF_SERVE_TIERS = new Set(["studio", "pro", "label"]);

const tierV = v.union(
  v.literal("flow"),
  v.literal("studio"),
  v.literal("pro"),
  v.literal("label"),
  v.literal("growth"),                    // legacy, superseded by "label"
  v.literal("enterprise"),
  v.literal("agency"),                    // legacy
);

/** Public action - start a Stripe Checkout session for the chosen tier. */
export const beginCheckout = action({
  args: {
    tier: tierV,
    agencyName: v.optional(v.string()),
    /** Yearly is 15% cheaper. Defaults to monthly. */
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const stripe = stripeClient();
    const interval = args.interval ?? "month";
    const priceId = priceIdForTierInterval(args.tier as TierKey, interval);

    const customer = await stripe.customers.create({
      email: identity.email ?? undefined,
      name: identity.name ?? identity.email ?? undefined,
      metadata: {
        clerkUserId: identity.subject,
        intendedAgencyName: args.agencyName ?? "",
        intendedTier: args.tier,
        intendedInterval: interval,
      },
    });

    /* Early adopter: half price for the first few months, expressed as a
       repeating Stripe coupon rather than a second set of price objects. A
       coupon is the only shape that steps back up on its own; a cheaper
       price id would have to be migrated by hand in month four, and the one
       that never gets migrated is the one that costs real money.

       Monthly only. Stripe counts a repeating discount in months, so three
       months against a yearly subscription lands entirely on that year's
       single invoice - half off twelve months instead of three. */
    const intro = earlyAdopterApplies(args.tier as TierKey, interval);
    let discounts: { coupon: string }[] | undefined;
    if (intro) {
      const coupon = await stripe.coupons.create({
        percent_off: EARLY_ADOPTER_DISCOUNT_PCT,
        duration: "repeating",
        duration_in_months: EARLY_ADOPTER_MONTHS,
        name: `Early adopter - ${EARLY_ADOPTER_DISCOUNT_PCT}% off for ${EARLY_ADOPTER_MONTHS} months`,
      });
      discounts = [{ coupon: coupon.id }];
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: priceId, quantity: 1 }],
      ...(discounts ? { discounts } : {}),
      // No trial - charge immediately on subscribe.
      success_url: `${baseUrl}/onboard/done?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/onboard`,
    });

    return { checkoutUrl: session.url, earlyAdopter: intro };
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

/* ============================================================
   Pay-first signup. New buyers from the pricing page pay BEFORE
   they have an account: Stripe Checkout collects payment + email +
   studio name, then the activation page creates their Clerk login
   and claimCheckout links it to the paid subscription.
   ============================================================ */

/** Public (no auth) - start a pay-first signup checkout for a self-serve tier. */
export const beginPublicCheckout = action({
  args: { tier: tierV },
  handler: async (_ctx, { tier }) => {
    if (!SELF_SERVE_TIERS.has(tier)) throw new Error("That tier is not self-serve.");
    const stripe = stripeClient();
    const priceId = priceIdForTier(tier as TierKey);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const meta = { kind: "platform_signup", intendedTier: tier };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      custom_fields: [
        {
          key: "studio_name",
          label: { type: "custom", custom: "Your studio or group name" },
          type: "text",
        },
      ],
      metadata: meta,
      subscription_data: { metadata: meta },
      success_url: `${baseUrl}/welcome/activate?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/#pricing`,
    });
    return { checkoutUrl: session.url };
  },
});

/** Public - read a checkout session for the activation page (prefill + confirm). */
export const checkoutSummary = action({
  args: { sessionId: v.string() },
  handler: async (_ctx, { sessionId }) => {
    const stripe = stripeClient();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    const studioField = (s.custom_fields ?? []).find((f) => f.key === "studio_name");
    return {
      email: s.customer_details?.email ?? s.customer_email ?? null,
      tier: (s.metadata?.intendedTier as string) ?? "studio",
      studioName: studioField?.text?.value ?? "",
      paid: s.status === "complete" || s.payment_status === "paid",
    };
  },
});

/** Authed - after the buyer creates their Clerk login, link it to the paid
 *  subscription and provision the workspace. Verified by matching the paid
 *  session's email to the signed-in user's email. */
export const claimCheckout = action({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const stripe = stripeClient();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (!(s.status === "complete" || s.payment_status === "paid")) {
      throw new Error("Payment is not complete yet.");
    }
    const sessionEmail = (s.customer_details?.email ?? s.customer_email ?? "").toLowerCase();
    const myEmail = (identity.email ?? "").toLowerCase();
    if (!sessionEmail || sessionEmail !== myEmail) {
      throw new Error("This checkout was paid with a different email.");
    }
    const tier = (s.metadata?.intendedTier as TierKey) ?? "studio";
    const studioField = (s.custom_fields ?? []).find((f) => f.key === "studio_name");
    const studioName = studioField?.text?.value || identity.name || myEmail;
    await ctx.runMutation(internal.billing.provisionFromCheckout, {
      clerkUserId: identity.subject,
      email: myEmail,
      tier,
      agencyName: studioName,
      customerId: (s.customer as string) ?? "",
      subscriptionId: (s.subscription as string) ?? "",
    });
    return { ok: true };
  },
});

/** Internal - email the buyer their activation link after checkout, so they can
 *  finish creating their login even if they closed the success page. */
export const sendActivationEmail = internalAction({
  args: { email: v.string(), sessionId: v.string() },
  handler: async (_ctx, { email, sessionId }) => {
    if (!email) return;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const activationUrl = `${baseUrl}/welcome/activate?session_id=${sessionId}`;
    await sendEmail({
      to: email,
      subject: activationEmailSubject(),
      html: activationEmailHtml({ activationUrl }),
    });
  },
});

/** Internal - create (or link) the agency workspace for a paid signup.
 *  Idempotent: one agency per owner and per subscription. */
export const provisionFromCheckout = internalMutation({
  args: {
    clerkUserId: v.string(),
    email: v.string(),
    tier: tierV,
    agencyName: v.string(),
    customerId: v.string(),
    subscriptionId: v.string(),
  },
  handler: async (ctx, args) => {
    // Already provisioned for this owner? Nothing to do.
    const mine = await ctx.db
      .query("agencies")
      .withIndex("by_owner", (q) => q.eq("ownerClerkUserId", args.clerkUserId))
      .first();
    if (mine) return { agencyId: mine.agencyId };

    // A pending agency may already exist for this subscription (e.g. a retry).
    let agency = args.subscriptionId
      ? (await ctx.db.query("agencies").collect()).find(
          (a) => a.stripeSubscriptionId === args.subscriptionId,
        )
      : undefined;

    if (agency) {
      await ctx.db.patch(agency._id, { ownerClerkUserId: args.clerkUserId });
    } else {
      const slug =
        args.agencyName.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-") ||
        `ag-${Date.now().toString(36)}`;
      const agencyId = `agency_${slug}_${Date.now().toString(36)}`;
      const newId = await ctx.db.insert("agencies", {
        agencyId,
        name: args.agencyName,
        slug,
        plan: args.tier,
        status: "active",
        ownerClerkUserId: args.clerkUserId,
        ownerEmail: args.email,
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
      });
      agency = (await ctx.db.get(newId))!;
    }

    // Ensure the owner member row exists.
    const existingMember = await ctx.db
      .query("agencyMembers")
      .withIndex("by_agency", (q) => q.eq("agencyId", agency!.agencyId))
      .filter((q) => q.eq(q.field("clerkUserId"), args.clerkUserId))
      .first();
    if (!existingMember) {
      await ctx.db.insert("agencyMembers", {
        agencyId: agency.agencyId,
        clerkUserId: args.clerkUserId,
        email: args.email,
        name: args.agencyName,
        role: "owner",
        status: "active",
        invitedAt: Date.now(),
      });
    }
    return { agencyId: agency.agencyId };
  },
});
