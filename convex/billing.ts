import { action, query, internalQuery, internalAction } from "./_generated/server";
import { internalMutation } from "./functions";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { stripeClient, priceIdForTier, hasPriceId, tierForPriceId } from "./lib/stripe";
import { TIERS, PLATFORM_TRIAL_DAYS } from "./lib/pricing";
import { buildSubscriptionCheckoutParams, isBetaPlan, trialSpec } from "./lib/trialCheckout";
import { assertNoLiveSubscription } from "./agencyBilling";
import { DEMO_ORG } from "./lib/tier";
import { tierV, intervalV } from "./lib/tierV";
import type { TierKey } from "./lib/plans";
import {
  EARLY_ADOPTER_MONTHS, EARLY_ADOPTER_DISCOUNT_PCT, earlyAdopterApplies,
} from "./lib/plans";
import { sendEmail } from "./lib/email";
import { activationEmailSubject, activationEmailHtml } from "./lib/emailTemplates/activation";
import { allowClerkIdentifier } from "./lib/clerkAllowlist";
import { normalizeEmail } from "./lib/emailKey";
import { platformAgencyId, platformPlanIdForTier } from "./lib/platformAgency";
import type { Id } from "./_generated/dataModel";

// Every tier is self-serve: Core, Growth and Max all check out without a call.
const SELF_SERVE_TIERS = new Set<string>(["core", "growth", "max"]);

/* Early adopter: half price for the first few months, expressed as a
   repeating Stripe coupon rather than a second set of price objects. A
   coupon is the only shape that steps back up on its own; a cheaper price
   id would have to be migrated by hand in month four, and the one that
   never gets migrated is the one that costs real money.

   Monthly only. Stripe counts a repeating discount in months, so three
   months against a yearly subscription lands entirely on that year's single
   invoice - half off twelve months instead of three.

   Both checkout paths go through here. The public one used to skip it
   entirely, which meant the landing page advertised a launch offer and then
   charged full price at the till. */
async function earlyAdopterDiscounts(
  stripe: ReturnType<typeof stripeClient>,
  tier: TierKey,
  interval: "month" | "year",
): Promise<{ coupon: string }[] | undefined> {
  if (!earlyAdopterApplies(tier, interval)) return undefined;
  const coupon = await stripe.coupons.create({
    percent_off: EARLY_ADOPTER_DISCOUNT_PCT,
    duration: "repeating",
    duration_in_months: EARLY_ADOPTER_MONTHS,
    name: `Early adopter - ${EARLY_ADOPTER_DISCOUNT_PCT}% off for ${EARLY_ADOPTER_MONTHS} months`,
  });
  return [{ coupon: coupon.id }];
}

/** PUBLIC. Which tier + interval prices are configured, so the pricing page
 *  can show a checkout button only where checkout will actually work and fall
 *  back to "Book a demo" elsewhere. Booleans only: no price id leaves the
 *  server. */
export const checkoutAvailability = query({
  args: {},
  handler: async () => {
    const out = {} as Record<TierKey, { month: boolean; year: boolean }>;
    for (const t of TIERS) out[t] = { month: hasPriceId(t, "month"), year: hasPriceId(t, "year") };
    return out;
  },
});

/* ============================================================
   Beta to paid.

   The beta is the one card-free term (365 days). Payment is required
   after it. The studio adds a card and picks Core, Growth or Max here.

   - Subscribing BEFORE the term ends does not charge early: the first
     charge is deferred to the end date (subscription_data.trial_end),
     so no beta day is paid for twice. Within 48 hours of the end, or
     after it, Stripe charges on subscribe.
   - A second checkout is refused while a live subscription exists, and
     the webhook cancels any duplicate that slips through.
   - Nothing is copied or moved: same workspace, same data.
   ============================================================ */
export const beginBetaConversionCheckout = action({
  args: { tier: tierV, interval: v.optional(intervalV) },
  handler: async (ctx, { tier, interval: wanted }): Promise<{ checkoutUrl: string | null; deferredUntil: number | null }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const orgId: string = await ctx.runQuery(internal.agencyBilling._myBillingOrgId, {});
    if (orgId === DEMO_ORG) throw new Error("Open your own studio first.");
    const org = await ctx.runQuery(internal.agencyBilling._orgForSetup, { orgId });
    if (!org) throw new Error("Studio not found.");
    const onBeta = (org.betaCohort && !org.graduatedAt) || isBetaPlan(org.plan);
    if (!onBeta) throw new Error("This studio is not on the beta. Use the billing page to manage its plan.");

    const interval = wanted ?? "month";
    const stripe = stripeClient();
    await assertNoLiveSubscription(stripe, org.billingSubscriptionId);
    const priceId = priceIdForTier(tier as TierKey, interval);
    const discounts = await earlyAdopterDiscounts(stripe, tier as TierKey, interval);

    let customer = org.billingCustomerId;
    if (!customer) {
      const c = await stripe.customers.create({
        email: org.ownerEmail ?? identity.email ?? undefined,
        name: org.name,
        metadata: { orgId: org.orgId, kind: "subaccount_billing" },
      });
      customer = c.id;
    }

    // The term ends on the license date (cohort) or the beta plan's window.
    const termEnd = org.betaCohort ? org.betaLicenseUntil : org.trialEndsAt;
    const trial = termEnd ? trialSpec({ trialEndsAt: termEnd, now: Date.now() }) : { kind: "none" as const };

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.checkout.sessions.create(
      buildSubscriptionCheckoutParams({
        customer,
        lineItems: [{ price: priceId, quantity: 1 }],
        discounts,
        trial,
        metadata: { kind: "beta_conversion", orgId: org.orgId, tier, interval },
        successUrl: `${baseUrl}/billing/added?session_id={CHECKOUT_SESSION_ID}&plan=1`,
        cancelUrl: `${baseUrl}/billing`,
      }),
    );
    return { checkoutUrl: session.url, deferredUntil: trial.kind === "until" ? trial.at : null };
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
      return_url: `${baseUrl}/agency/settings#billing`,
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
    return {
      plan: ag.plan, status: ag.status, agencyId: ag.agencyId, name: ag.name,
      hasBillingAccount: Boolean(ag.stripeCustomerId),
      paymentFailedAt: ag.paymentFailedAt ?? null,
      paymentActionUrl: ag.paymentActionUrl ?? null,
    };
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
  args: { tier: tierV, interval: v.optional(intervalV) },
  handler: async (_ctx, { tier, interval: wanted }) => {
    if (!SELF_SERVE_TIERS.has(tier)) throw new Error("That tier is not self-serve.");
    const interval = wanted ?? "month";
    const stripe = stripeClient();
    const priceId = priceIdForTier(tier as TierKey, interval);
    // The landing page sells the launch offer, so the till has to honour it.
    const discounts = await earlyAdopterDiscounts(stripe, tier as TierKey, interval);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const meta = { kind: "platform_signup", intendedTier: tier, intendedInterval: interval };
    const session = await stripe.checkout.sessions.create(
      buildSubscriptionCheckoutParams({
        lineItems: [{ price: priceId, quantity: 1 }],
        discounts,
        customFields: [
          {
            key: "studio_name",
            label: { type: "custom", custom: "Your studio or group name" },
            type: "text",
          },
        ],
        trial: trialSpec({ trialDays: PLATFORM_TRIAL_DAYS, now: Date.now() }),
        metadata: meta,
        successUrl: `${baseUrl}/welcome/activate?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${baseUrl}/pricing`,
      }),
    );
    return { checkoutUrl: session.url, earlyAdopter: Boolean(discounts) };
  },
});

/** Public - read a checkout session for the activation page (prefill + confirm). */
export const checkoutSummary = action({
  args: { sessionId: v.string() },
  handler: async (_ctx, { sessionId }) => {
    const stripe = stripeClient();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    const studioField = (s.custom_fields ?? []).find((f) => f.key === "studio_name");
    const email = s.customer_details?.email ?? s.customer_email ?? null;

    /* The activation page calls this the moment it loads, which is the moment
       before the buyer types a password. The webhook allowlists them too, but
       a webhook is a race against a redirect - and losing that race tells
       somebody who has just paid that they are "not allowed to access this
       application". Allowlisting here is the deterministic half. */
    if (email && (s.status === "complete" || s.payment_status === "paid")) {
      await allowClerkIdentifier(email);
    }

    return {
      email,
      tier: (s.metadata?.intendedTier as string) ?? "core",
      studioName: studioField?.text?.value ?? "",
      paid: s.status === "complete" || s.payment_status === "paid",
    };
  },
});

/** Authed - after the buyer creates their Clerk login, link it to the paid
 *  subscription and provision the workspace.
 *
 *  The login may use a different email from the one paid with (Apple's Hide
 *  My Email relay, a second Google account), so emails are not matched. The
 *  checkout link is the proof: it only reaches the payer (success redirect and
 *  the activation email), and it is single-use, because the first login to
 *  claim binds the workspace to this subscription and provisionFromCheckout
 *  refuses any other owner. The paid email stays the owner's billing contact. */
export const claimCheckout = action({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<{ ok: true; orgId: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("not signed in");
    const stripe = stripeClient();
    const s = await stripe.checkout.sessions.retrieve(sessionId);
    if (!(s.status === "complete" || s.payment_status === "paid")) {
      throw new Error("Payment is not complete yet.");
    }
    /* Only a pay-first signup provisions a workspace. Any other completed
       session paid with the same email (a card save, a beta conversion, a
       studio plan) must not become a studio. */
    if (s.mode !== "subscription" || s.metadata?.kind !== "platform_signup") {
      throw new Error("This checkout is not a Pulse signup.");
    }
    const sessionEmail = (s.customer_details?.email ?? s.customer_email ?? "").toLowerCase();
    const myEmail = (identity.email ?? "").toLowerCase();
    const subscriptionId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
    if (!subscriptionId) throw new Error("This checkout has no subscription.");
    // The subscription, not the session, says what was bought and whether it
    // is still paid for. Metadata is ours to read, never proof of a price.
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (sub.status !== "active" && sub.status !== "trialing") {
      throw new Error("This subscription is not active.");
    }
    const priceId = sub.items?.data?.[0]?.price?.id;
    const match = priceId ? tierForPriceId(priceId) : null;
    if (!match) throw new Error("This subscription is not on a Pulse plan.");
    const studioField = (s.custom_fields ?? []).find((f) => f.key === "studio_name");
    const studioName = studioField?.text?.value || identity.name || sessionEmail || myEmail;
    const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id ?? "";
    const { orgId, planId }: { orgId: string; planId: Id<"agencyPlans"> | null } = await ctx.runMutation(internal.billing.provisionFromCheckout, {
      clerkUserId: identity.subject,
      email: sessionEmail || myEmail,
      loginEmail: myEmail || undefined,
      ownerName: identity.name || undefined,
      tier: match.tier,
      interval: match.interval,
      studioName,
      customerId,
      subscriptionId,
    });
    /* Tag the subscription with its studio so every later event (renewal,
       failed payment, plan change, cancel) routes to the studio's billing,
       then mirror its status and trial window onto the studio now. */
    await stripe.subscriptions.update(subscriptionId, {
      metadata: { ...(sub.metadata ?? {}), kind: "subaccount_plan", orgId, ...(planId ? { planId } : {}) },
    });
    await ctx.runAction(internal.trialBilling.syncOrgSubscription, { orgId, subscriptionId });
    return { ok: true as const, orgId };
  },
});

/** Internal - email the buyer their activation link after checkout, so they can
 *  finish creating their login even if they closed the success page. */
export const sendActivationEmail = internalAction({
  args: { email: v.string(), sessionId: v.string() },
  handler: async (_ctx, { email, sessionId }) => {
    if (!email) return;
    /* They have paid. Clerk's allowlist would otherwise refuse them the
       login the activation link is asking them to create. */
    await allowClerkIdentifier(email);
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
    /** Billing contact: the email the checkout was paid with. */
    email: v.string(),
    /** The login's own email when it differs (e.g. an Apple relay address). */
    loginEmail: v.optional(v.string()),
    ownerName: v.optional(v.string()),
    tier: tierV,
    interval: v.optional(intervalV),
    studioName: v.string(),
    customerId: v.string(),
    subscriptionId: v.string(),
  },
  handler: async (ctx, args): Promise<{ orgId: string; planId: Id<"agencyPlans"> | null }> => {
    /* A buyer gets a STUDIO under the Pulse agency, never an agency of their
       own: the agency console is the Pulse team's. The subscription lives on
       the studio (billingSubscriptionId), like every other sub-account plan. */

    // Already provisioned for this subscription? Same owner: done. Another: refuse.
    const existing = await ctx.db
      .query("orgs")
      .filter((q) => q.eq(q.field("billingSubscriptionId"), args.subscriptionId))
      .first();
    if (existing) {
      const owners = (
        await ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", existing.orgId)).collect()
      ).filter((m) => m.role === "owner" && m.clerkUserId);
      if (owners.some((m) => m.clerkUserId === args.clerkUserId)) {
        return { orgId: existing.orgId, planId: existing.agencyPlanId ?? null };
      }
      throw new Error("This subscription is already linked to another account.");
    }

    /* Before 2026-10-10 a claim made a buyer agency. One owned by somebody
       else is never handed over; one that is unowned or this buyer's own is
       retired here, so the studio below replaces it (and the console link
       and demo-workspace fallback it caused go with it). */
    const legacy = (await ctx.db.query("agencies").collect()).find(
      (a) => a.stripeSubscriptionId === args.subscriptionId,
    );
    if (legacy) {
      if (legacy.ownerClerkUserId && legacy.ownerClerkUserId !== args.clerkUserId) {
        throw new Error("This subscription is already linked to another account.");
      }
      const legacyMembers = await ctx.db
        .query("agencyMembers")
        .withIndex("by_agency", (q) => q.eq("agencyId", legacy.agencyId))
        .collect();
      for (const m of legacyMembers) await ctx.db.delete(m._id);
      await ctx.db.delete(legacy._id);
    }

    const agencyId = await platformAgencyId(ctx);
    const planId = agencyId
      ? await platformPlanIdForTier(ctx, agencyId, args.tier, args.interval ?? "month")
      : null;

    const name = args.studioName.trim() || "My Studio";
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "studio";
    let slug = base;
    for (let n = 2; await ctx.db.query("orgs").withIndex("by_slug", (q) => q.eq("slug", slug)).first(); n++) {
      slug = `${base}-${n}`;
    }
    const orgId = `studio_${slug}_${Date.now().toString(36)}`;
    const ownerName = args.ownerName?.trim() || name;

    await ctx.db.insert("orgs", {
      orgId,
      name,
      slug,
      tier: args.tier,
      status: "active",
      ...(agencyId ? { agencyId } : {}),
      ...(planId ? { agencyPlanId: planId } : {}),
      // The post-claim sync mirrors the real status and trial window from Stripe.
      billingStatus: "trialing",
      billingCustomerId: args.customerId || undefined,
      billingSubscriptionId: args.subscriptionId,
      ownerName,
      ownerEmail: normalizeEmail(args.email),
      createdByAgency: false,
    });
    await ctx.db.insert("members", {
      orgId,
      name: ownerName,
      email: normalizeEmail(args.loginEmail || args.email),
      role: "owner",
      skills: [],
      clerkUserId: args.clerkUserId,
    });
    return { orgId, planId };
  },
});
