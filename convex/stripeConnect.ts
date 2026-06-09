import { action, query, internalQuery, internalMutation } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { stripeClient } from "./lib/stripe";
import { currentOrg } from "./lib/tenant";

/* ============================================================
   Stripe Connect (P3). Each studio connects its OWN Stripe
   (Express connected account) during onboarding and collects
   client deposits directly; Pulse facilitates via the platform
   account. Requires STRIPE_SECRET_KEY (a Connect-enabled platform
   key) + APP_URL on the deployment.
   ============================================================ */

function appUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}

/** Connect state for the signed-in studio. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      connected: Boolean(org?.stripeAccountId),
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      detailsSubmitted: Boolean(org?.stripeDetailsSubmitted),
      configured: Boolean(process.env.STRIPE_SECRET_KEY),
    };
  },
});

/** Internal - the caller's org connect fields (auth propagates into runQuery). */
export const _orgForConnect = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgId = await currentOrg(ctx);
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    return {
      orgId,
      name: org.name,
      ownerEmail: org.ownerEmail ?? null,
      stripeAccountId: org.stripeAccountId ?? null,
    };
  },
});

export const _setAccount = internalMutation({
  args: { orgId: v.string(), stripeAccountId: v.string() },
  handler: async (ctx, { orgId, stripeAccountId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (org) await ctx.db.patch(org._id, { stripeAccountId });
  },
});

/** Internal - flip charge/detail flags from a retrieved account or webhook. */
export const _setStatusByAccount = internalMutation({
  args: {
    stripeAccountId: v.string(),
    chargesEnabled: v.boolean(),
    detailsSubmitted: v.boolean(),
  },
  handler: async (ctx, { stripeAccountId, chargesEnabled, detailsSubmitted }) => {
    const org = await ctx.db
      .query("orgs")
      .withIndex("by_stripe_account", (q) => q.eq("stripeAccountId", stripeAccountId))
      .first();
    if (org) {
      await ctx.db.patch(org._id, {
        stripeChargesEnabled: chargesEnabled,
        stripeDetailsSubmitted: detailsSubmitted,
      });
    }
  },
});

/**
 * Ensure the signed-in studio has an Express connected account, creating one if
 * needed. Shared by the hosted Account-Link flow and the embedded onboarding
 * flow so both paths attach to the same account. Returns the account id.
 */
async function ensureExpressAccount(
  ctx: ActionCtx,
  stripe: ReturnType<typeof stripeClient>,
): Promise<string> {
  const self = await ctx.runQuery(internal.stripeConnect._orgForConnect, {});
  if (!self) throw new ConvexError("No studio to connect.");
  if (self.stripeAccountId) return self.stripeAccountId;
  const account = await stripe.accounts.create({
    type: "express",
    email: self.ownerEmail ?? undefined,
    business_profile: { name: self.name },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    metadata: { orgId: self.orgId },
  });
  await ctx.runMutation(internal.stripeConnect._setAccount, {
    orgId: self.orgId,
    stripeAccountId: account.id,
  });
  return account.id;
}

/**
 * Begin (or resume) Stripe Connect onboarding. Creates an Express account for
 * the studio if needed, then returns a one-time Account Link URL to redirect to.
 * Used as the fallback when embedded onboarding is unavailable.
 */
export const createAccountLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new ConvexError("Payments aren’t configured yet. Ask your admin to set up Stripe.");
    }
    const stripe = stripeClient();
    const accountId = await ensureExpressAccount(ctx, stripe);
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl()}/settings?stripe=refresh`,
      return_url: `${appUrl()}/settings?stripe=return`,
      type: "account_onboarding",
    });
    return { url: link.url };
  },
});

/**
 * Create an Account Session client secret for Stripe's EMBEDDED Connect
 * onboarding component, so the studio completes onboarding inside Pulse (themed
 * gold/black) instead of being redirected to Stripe's hosted flow. Ensures the
 * Express account exists first. The client pairs this with the publishable key
 * (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) in loadConnectAndInitialize.
 */
export const createAccountSession = action({
  args: {},
  handler: async (ctx): Promise<{ clientSecret: string }> => {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new ConvexError("Payments aren’t configured yet. Ask your admin to set up Stripe.");
    }
    const stripe = stripeClient();
    const accountId = await ensureExpressAccount(ctx, stripe);
    const session = await stripe.accountSessions.create({
      account: accountId,
      components: { account_onboarding: { enabled: true } },
    });
    return { clientSecret: session.client_secret };
  },
});

/**
 * One-time login link to the studio's OWN Stripe Express dashboard, where they
 * manage bank details, payouts, refunds, and tax. Express accounts can't sign in
 * at stripe.com directly - the platform must mint this link.
 */
export const createDashboardLink = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new ConvexError("Payments aren’t configured yet. Ask your admin to set up Stripe.");
    }
    const self = await ctx.runQuery(internal.stripeConnect._orgForConnect, {});
    if (!self?.stripeAccountId) {
      throw new ConvexError("Connect your Stripe account first.");
    }
    const link = await stripeClient().accounts.createLoginLink(self.stripeAccountId);
    return { url: link.url };
  },
});

/** Pull the latest account state from Stripe and persist charge/detail flags. */
export const refreshStatus = action({
  args: {},
  handler: async (ctx): Promise<{ chargesEnabled: boolean; detailsSubmitted: boolean }> => {
    if (!process.env.STRIPE_SECRET_KEY) return { chargesEnabled: false, detailsSubmitted: false };
    const self = await ctx.runQuery(internal.stripeConnect._orgForConnect, {});
    if (!self?.stripeAccountId) return { chargesEnabled: false, detailsSubmitted: false };
    const account = await stripeClient().accounts.retrieve(self.stripeAccountId);
    const chargesEnabled = Boolean(account.charges_enabled);
    const detailsSubmitted = Boolean(account.details_submitted);
    await ctx.runMutation(internal.stripeConnect._setStatusByAccount, {
      stripeAccountId: self.stripeAccountId,
      chargesEnabled,
      detailsSubmitted,
    });
    return { chargesEnabled, detailsSubmitted };
  },
});

/** Internal - session + org payment context for a deposit checkout. */
export const _depositContext = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const orgId = await currentOrg(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.orgId !== orgId) return null;
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    return {
      title: session.title,
      depositCents: session.depositCents,
      stripeAccountId: org?.stripeAccountId ?? null,
      chargesEnabled: Boolean(org?.stripeChargesEnabled),
      slug: org?.slug ?? "",
    };
  },
});

/**
 * Create a Stripe Checkout Session for a booking's deposit, charged DIRECTLY on
 * the studio's connected account (so funds land in the studio's Stripe). Returns
 * the hosted checkout URL.
 */
export const createDepositCheckout = action({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }): Promise<{ url: string }> => {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new ConvexError("Payments aren’t configured yet.");
    }
    const ctxData = await ctx.runQuery(internal.stripeConnect._depositContext, { sessionId });
    if (!ctxData) throw new ConvexError("Session not found.");
    if (!ctxData.stripeAccountId || !ctxData.chargesEnabled) {
      throw new ConvexError("This studio hasn’t finished connecting Stripe yet.");
    }
    const stripe = stripeClient();
    const checkout = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: { name: `Deposit - ${ctxData.title}` },
              unit_amount: ctxData.depositCents,
            },
            quantity: 1,
          },
        ],
        success_url: `${appUrl()}/book/${ctxData.slug}?deposit=paid`,
        cancel_url: `${appUrl()}/book/${ctxData.slug}?deposit=cancelled`,
        metadata: { sessionId },
      },
      { stripeAccount: ctxData.stripeAccountId }, // direct charge on the studio's account
    );
    if (!checkout.url) throw new ConvexError("Could not start checkout.");
    return { url: checkout.url };
  },
});

/* ============================================================
   Go-live migration (test -> live). Test-mode acct_/cus_/sub_/price_
   ids do NOT exist under a live Stripe key, so any stored connected-
   account state goes stale the moment STRIPE_SECRET_KEY is swapped to
   sk_live_. This one-shot internal mutation clears that state so studios
   get a clean "Connect Stripe" prompt and re-onboard in live mode.

   Scope is the CONNECTED-account (studio) surface only:
     - orgs:           stripeAccountId, stripeChargesEnabled, stripeDetailsSubmitted
     - membershipPlans: stripePriceId (a Price on the studio's own account)
     - memberships:    stripeCustomerId, stripeSubscriptionId (+ cancel, since
                       the live subscription that granted access doesn't exist)
   It deliberately does NOT touch the `agencies` table - that holds Pulse's own
   platform billing of agencies, a separate go-live concern.

   Run from the Convex dashboard (or CLI) with { dryRun: true } first to see the
   counts, then { dryRun: false } to apply. Internal-only: never client-callable.
   ============================================================ */
export const _resetTestConnectStateForGoLive = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, { dryRun }) => {
    const apply = dryRun === false; // default (undefined/true) = report only
    let orgsCleared = 0;
    let plansCleared = 0;
    let membershipsCancelled = 0;

    for (const org of await ctx.db.query("orgs").collect()) {
      if (org.stripeAccountId || org.stripeChargesEnabled || org.stripeDetailsSubmitted) {
        orgsCleared++;
        if (apply) {
          await ctx.db.patch(org._id, {
            stripeAccountId: undefined,
            stripeChargesEnabled: undefined,
            stripeDetailsSubmitted: undefined,
          });
        }
      }
    }

    for (const plan of await ctx.db.query("membershipPlans").collect()) {
      if (plan.stripePriceId) {
        plansCleared++;
        if (apply) await ctx.db.patch(plan._id, { stripePriceId: undefined });
      }
    }

    for (const m of await ctx.db.query("memberships").collect()) {
      if (m.stripeSubscriptionId || m.stripeCustomerId) {
        membershipsCancelled++;
        if (apply) {
          await ctx.db.patch(m._id, {
            stripeSubscriptionId: undefined,
            stripeCustomerId: undefined,
            // A membership backed by a now-dead test subscription must not keep
            // granting access; force re-subscribe under live.
            status: "cancelled",
          });
        }
      }
    }

    return {
      applied: apply,
      orgsCleared,
      plansCleared,
      membershipsCancelled,
      note: apply
        ? "Stale test Connect state cleared; studios must re-connect Stripe in live mode."
        : "DRY RUN - nothing written. Re-run with { dryRun: false } to apply.",
    };
  },
});
