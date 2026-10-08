import { action, internalAction, internalQuery, query } from "./_generated/server";
import { internalMutation, mutation } from "./functions";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireCapability, resolveViewer } from "./lib/access";
import { currentOrg } from "./lib/tenant";
import { AccessError } from "./lib/access";
import { stripeClient } from "./lib/stripe";
import {
  evaluateBillingGate, effectivePriceCents, currentPriceCents, inIntroWindow, DAY_MS,
} from "./lib/billingGate";
import { sendEmail } from "./lib/email";
import { escapeHtml } from "./lib/text";
import {
  buildSubscriptionCheckoutParams, initialBillingFor, isBetaPlan, isLiveSubscriptionStatus,
  isPaidTrialPlan, trialSpec, type CheckoutLineItem, type TrialSpec,
} from "./lib/trialCheckout";

/* ============================================================
   Agency rebilling - the per-sub-account billing/trial state. The
   agency assigns one of its agencyPlans to a studio; this module
   runs the state machine (pending_card → trialing → active / past_due
   / canceled, or comped), the "add a card" Stripe flows, and the
   daily trial sweep.

   Card-required trials (owner rule 2026-10-07): a paid plan with a
   trial never starts its trial here. Assigning it parks the studio in
   pending_card; the trial begins when Stripe Checkout (subscription
   mode, card always collected) completes, and Stripe owns its end
   date. The Beta plan is the only card-free window.

   Reads/writes over a sub-account are gated by capability + the
   engine's agency-over-org scope check. The studio-self-serve pair
   (myBilling / startMyPaymentSetup) lets a studio owner add a card.
   ============================================================ */

async function orgByIdOrThrow(ctx: QueryCtx | MutationCtx, orgId: string): Promise<Doc<"orgs">> {
  const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
  if (!org) throw new Error("Subaccount not found.");
  return org;
}

function billingView(org: Doc<"orgs">, plan: Doc<"agencyPlans"> | null, now: number) {
  const gate = evaluateBillingGate(org, plan, now);
  return {
    plan: plan
      ? {
          _id: plan._id,
          name: plan.name,
          priceCents: plan.priceCents,
          billingInterval: plan.billingInterval,
          trialDays: plan.trialDays,
          requireCardAfterTrial: plan.requireCardAfterTrial,
          isBeta: isBetaPlan(plan),
          paidTrial: isPaidTrialPlan(plan),
          isPromo: plan.isPromo,
          introPriceCents: plan.introPriceCents ?? null,
          introMonths: plan.introMonths ?? null,
        }
      : null,
    billingStatus: org.billingStatus ?? null,
    trialStartedAt: org.trialStartedAt ?? null,
    trialEndsAt: org.trialEndsAt ?? null,
    paymentMethodOnFile: Boolean(org.paymentMethodOnFile),
    // A Stripe subscription is behind this studio (trialing or paying).
    subscribed: Boolean(org.billingSubscriptionId),
    trialCardRequiredBy: org.trialCardRequiredBy ?? null,
    priceCentsOverride: org.priceCentsOverride ?? null,
    /* What they are charged today, which is not always the plan price: an
       early-adopter plan bills its intro rate for the first few months. The
       window is measured from when paid billing started. */
    effectivePriceCents: currentPriceCents(org.priceCentsOverride, plan, org.paidSince, now),
    listPriceCents: effectivePriceCents(org.priceCentsOverride, plan?.priceCents),
    inIntroWindow: inIntroWindow(plan, org.paidSince, now),
    billingNote: org.billingNote ?? null,
    // Beta program, so the lock screen can say what ended and when.
    betaCohort: org.betaCohort === true,
    betaLicenseUntil: org.betaLicenseUntil ?? null,
    // Set once they have been moved onto normal terms - after that the
    // countdown is an ordinary trial again and should read like one.
    graduatedAt: org.graduatedAt ?? null,
    ...gate,
  };
}

/** Agency-side view of one sub-account's billing. */
export const subaccountBilling = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "agency.viewAll", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
    return billingView(org, plan, Date.now());
  },
});

/** Apply a plan's state machine to an org and return the patch. A paid trial
 *  plan lands in pending_card: the trial itself starts in Stripe Checkout. */
function planTransition(plan: Doc<"agencyPlans">, hasCard: boolean, now: number) {
  const t = initialBillingFor(plan, hasCard, now, DAY_MS);
  if (!t) {
    throw new Error(
      "This plan is a free trial with no card. Every trial needs a card now: give the plan a price, or use the Beta plan.",
    );
  }
  return t;
}

/** Assign (or change) a sub-account's agency plan and start its trial/billing. */
export const assignPlan = mutation({
  args: { orgId: v.string(), planId: v.id("agencyPlans") },
  handler: async (ctx, { orgId, planId }) => {
    const viewer = await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    const plan = await ctx.db.get(planId);
    if (!plan || (viewer.kind === "agency_member" && plan.agencyId !== viewer.agencyId)) {
      throw new Error("Plan not found.");
    }
    /* Double-charge guard: a studio with a live Stripe subscription keeps it
       until it is canceled in Stripe. Moving it to another plan here would
       open a second checkout and a second bill. */
    if (org.billingSubscriptionId && isLiveSubscriptionStatus(liveStatusOf(org.billingStatus))) {
      throw new Error(
        "This studio has a live Stripe subscription. Cancel it in Stripe before moving it to another plan.",
      );
    }
    const t = planTransition(plan, Boolean(org.paymentMethodOnFile), Date.now());
    await ctx.db.patch(org._id, { agencyPlanId: planId, ...t, trialCardRequiredBy: undefined });
    // Apply any plan-level feature caps on top of existing disabled features.
    if (plan.featureCaps && plan.featureCaps.length) {
      const merged = new Set([...(org.disabledFeatures ?? []), ...plan.featureCaps]);
      await ctx.db.patch(org._id, { disabledFeatures: [...merged] });
    }
    return { billingStatus: t.billingStatus };
  },
});

/** Free forever - the agency comps a studio (e.g. a partner or in-house room). */
export const comp = mutation({
  args: { orgId: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { orgId, note }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    await ctx.db.patch(org._id, {
      billingStatus: "comped",
      billingNote: note?.trim() || undefined,
      trialEndsAt: undefined,
    });
  },
});

/** Our stored status, read as the Stripe status it mirrors. */
function liveStatusOf(status: Doc<"orgs">["billingStatus"]): string | undefined {
  return status === "trialing" || status === "active" || status === "past_due" ? status : undefined;
}

/**
 * Push a trial deadline out by N days.
 *
 * Only a Stripe-backed trial can be extended, and only in Stripe: the change
 * goes to the subscription's trial_end and the webhook mirrors it back, so
 * the card is still charged on the new date. A card-free trial cannot be
 * extended (that would be a new card-free window), and neither can the beta,
 * which runs on its license date.
 */
export const extendTrial = mutation({
  args: { orgId: v.string(), days: v.number() },
  handler: async (ctx, { orgId, days }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
    if (org.betaCohort || isBetaPlan(plan)) {
      throw new Error("The beta runs on its own date and is not extended here.");
    }
    if (!org.billingSubscriptionId || org.billingStatus !== "trialing") {
      throw new Error(
        "Only a trial with a card on file can be extended. Ask the owner to add a card first.",
      );
    }
    const add = Math.max(1, Math.round(days)) * DAY_MS;
    const base = Math.max(org.trialEndsAt ?? 0, Date.now());
    await ctx.scheduler.runAfter(0, internal.trialBilling._extendStripeTrial, {
      subscriptionId: org.billingSubscriptionId,
      trialEndMs: base + add,
    });
    return { scheduled: true, trialEndsAt: base + add };
  },
});

/** Per-account custom price (overrides the plan's price). null clears it. */
export const setPriceOverride = mutation({
  args: { orgId: v.string(), priceCents: v.union(v.number(), v.null()) },
  handler: async (ctx, { orgId, priceCents }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    await ctx.db.patch(org._id, {
      priceCentsOverride: priceCents === null ? undefined : Math.max(0, Math.round(priceCents)),
    });
  },
});

/** Manually mark a studio as having a card / being active (no-Stripe / offline
    payment path). Agency-gated. */
export const markActiveManually = mutation({
  args: { orgId: v.string(), onFile: v.boolean() },
  handler: async (ctx, { orgId, onFile }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    const org = await orgByIdOrThrow(ctx, orgId);
    await ctx.db.patch(org._id, {
      paymentMethodOnFile: onFile,
      billingStatus: onFile ? "active" : (org.billingStatus ?? "past_due"),
    });
  },
});

// ── Stripe "add a card" setup flow ───────────────────────────

export const _orgForSetup = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<SetupOrg | null> => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
    return {
      orgId: org.orgId,
      name: org.name,
      ownerEmail: org.ownerEmail ?? null,
      billingCustomerId: org.billingCustomerId ?? null,
      billingSubscriptionId: org.billingSubscriptionId ?? null,
      billingStatus: org.billingStatus ?? null,
      trialEndsAt: org.trialEndsAt ?? null,
      priceCentsOverride: org.priceCentsOverride ?? null,
      betaCohort: org.betaCohort === true,
      graduatedAt: org.graduatedAt ?? null,
      betaLicenseUntil: org.betaLicenseUntil ?? null,
      plan: plan
        ? {
            _id: plan._id as string,
            name: plan.name,
            isBeta: plan.isBeta,
            priceCents: plan.priceCents,
            trialDays: plan.trialDays,
            billingInterval: plan.billingInterval,
            introPriceCents: plan.introPriceCents,
            introMonths: plan.introMonths,
            stripePriceId: plan.stripePriceId,
          }
        : null,
    };
  },
});

/** Action-side guard: assert the caller can edit billing for this org. */
export const _assertBillingEdit = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await requireCapability(ctx, "billing.edit", { orgId });
    return true;
  },
});

/** Action-side resolver: the signed-in studio's own org id. */
export const _myOrgId = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await currentOrg(ctx);
  },
});

export const _markPaymentMethodOnFile = internalMutation({
  args: { orgId: v.string(), customerId: v.optional(v.string()), subscriptionId: v.optional(v.string()) },
  handler: async (ctx, { orgId, customerId, subscriptionId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return;
    await ctx.db.patch(org._id, {
      paymentMethodOnFile: true,
      billingStatus: "active",
      // First time they go active is when any intro window starts running.
      ...(org.paidSince ? {} : { paidSince: Date.now() }),
      ...(customerId ? { billingCustomerId: customerId } : {}),
      ...(subscriptionId ? { billingSubscriptionId: subscriptionId } : {}),
    });
  },
});

/** What the card flows need to know about a studio (see _orgForSetup). */
export type SetupOrg = {
  orgId: string;
  name: string;
  ownerEmail: string | null;
  billingCustomerId: string | null;
  billingSubscriptionId: string | null;
  billingStatus: Doc<"orgs">["billingStatus"] | null;
  trialEndsAt: number | null;
  priceCentsOverride: number | null;
  betaCohort: boolean;
  graduatedAt: number | null;
  betaLicenseUntil: number | null;
  plan: {
    _id: string;
    name: string;
    isBeta?: boolean;
    priceCents: number;
    trialDays: number;
    billingInterval: "month" | "year";
    introPriceCents?: number;
    introMonths?: number;
    stripePriceId?: string;
  } | null;
};

/** True when adding a card for this studio must open a Stripe subscription
 *  (a card-required trial, a carried-over trial, or a resubscribe after a
 *  canceled one) rather than just save a card. */
export function needsTrialCheckout(org: Pick<SetupOrg, "plan" | "billingStatus" | "billingSubscriptionId">): boolean {
  if (!org.plan || isBetaPlan(org.plan) || org.plan.priceCents <= 0) return false;
  // A Stripe-backed plan that was canceled: subscribe again, no new trial.
  if (org.billingStatus === "canceled" && org.billingSubscriptionId) return true;
  if (!isPaidTrialPlan(org.plan)) return false;
  if (org.billingStatus === "pending_card") return true;
  // Grandfathered: a trial that began card-free, with no subscription behind it.
  return org.billingStatus === "trialing" && !org.billingSubscriptionId;
}

/** The trial to give a studio at checkout: a fresh trial of the plan's length
 *  for pending_card, or the date already promised for a grandfathered trial. */
export function trialForOrg(org: Pick<SetupOrg, "plan" | "billingStatus" | "trialEndsAt">, now: number): TrialSpec {
  // One trial per studio: coming back after a cancel bills on subscribe.
  if (org.billingStatus === "canceled") return { kind: "none" };
  if (org.billingStatus === "trialing" && org.trialEndsAt) {
    return trialSpec({ trialEndsAt: org.trialEndsAt, now });
  }
  return trialSpec({ trialDays: org.plan?.trialDays ?? 0, now });
}

/** Line items for an agency plan. A plan with its own Stripe price uses it;
 *  otherwise the plan (or this studio's override) is priced inline. */
function agencyPlanLineItems(org: SetupOrg): CheckoutLineItem[] {
  const plan = org.plan!;
  if (plan.stripePriceId && org.priceCentsOverride === null) {
    return [{ price: plan.stripePriceId, quantity: 1 }];
  }
  return [{
    quantity: 1,
    price_data: {
      currency: "usd",
      unit_amount: org.priceCentsOverride ?? plan.priceCents,
      recurring: { interval: plan.billingInterval },
      product_data: { name: `Pulse: ${plan.name}` },
    },
  }];
}

/** Customer for a studio on the platform account, created on first use. */
async function ensureOrgCustomer(
  stripe: ReturnType<typeof stripeClient>,
  org: Pick<SetupOrg, "orgId" | "name" | "ownerEmail" | "billingCustomerId">,
): Promise<string> {
  if (org.billingCustomerId) return org.billingCustomerId;
  const customer = await stripe.customers.create({
    email: org.ownerEmail ?? undefined,
    name: org.name,
    metadata: { orgId: org.orgId, kind: "subaccount_billing" },
  });
  return customer.id;
}

/** Refuse a second checkout while a live subscription exists. */
export async function assertNoLiveSubscription(
  stripe: ReturnType<typeof stripeClient>,
  subscriptionId: string | null,
): Promise<void> {
  if (!subscriptionId) return;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    if (isLiveSubscriptionStatus(sub.status)) {
      throw new Error("This studio already has a subscription. Manage it from the billing page instead of starting another.");
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("This studio already has")) throw err;
    // Unknown to Stripe (deleted, wrong mode): nothing live to double up on.
  }
}

/** Stripe Checkout in subscription mode that starts a card-required trial. */
async function buildTrialCheckout(
  ctx: ActionCtx,
  org: SetupOrg,
): Promise<{ url: string | null; simulated: boolean }> {
  const now = Date.now();
  const trial = trialForOrg(org, now);
  if (!process.env.STRIPE_SECRET_KEY) {
    // Demo / local: apply what Stripe would send back after checkout.
    const end = trial.kind === "until" ? trial.at : trial.kind === "days" ? now + trial.days * DAY_MS : undefined;
    await ctx.runMutation(internal.trialBilling._applyOrgSubscription, {
      orgId: org.orgId,
      sub: {
        id: `sub_simulated_${org.orgId}`,
        status: end ? "trialing" : "active",
        trial_start: end ? Math.floor(now / 1000) : null,
        trial_end: end ? Math.floor(end / 1000) : null,
        default_payment_method: "pm_simulated",
        metadata: { kind: "subaccount_trial", orgId: org.orgId },
      },
    });
    return { url: null, simulated: true };
  }
  const stripe = stripeClient();
  await assertNoLiveSubscription(stripe, org.billingSubscriptionId);
  const customer = await ensureOrgCustomer(stripe, org);
  const plan = org.plan!;
  let discounts: { coupon: string }[] | undefined;
  if (
    org.priceCentsOverride === null &&
    plan.billingInterval === "month" &&
    typeof plan.introPriceCents === "number" &&
    plan.introMonths &&
    plan.introPriceCents < plan.priceCents
  ) {
    const coupon = await stripe.coupons.create({
      amount_off: plan.priceCents - plan.introPriceCents,
      currency: "usd",
      duration: "repeating",
      duration_in_months: plan.introMonths,
      name: `${plan.name} intro price`,
    });
    discounts = [{ coupon: coupon.id }];
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await stripe.checkout.sessions.create(
    buildSubscriptionCheckoutParams({
      customer,
      lineItems: agencyPlanLineItems(org),
      trial,
      discounts,
      metadata: { kind: "subaccount_trial", orgId: org.orgId, planId: plan._id },
      successUrl: `${baseUrl}/billing/added?session_id={CHECKOUT_SESSION_ID}&trial=1`,
      cancelUrl: `${baseUrl}/billing`,
    }),
  );
  return { url: session.url ?? null, simulated: false };
}

/** "Add a card" for a studio. A paid trial plan goes through the trial
 *  checkout above; anything else keeps the setup-mode flow below. */
async function buildCardCheckout(
  ctx: ActionCtx,
  orgId: string,
): Promise<{ url: string | null; simulated: boolean }> {
  const org = await ctx.runQuery(internal.agencyBilling._orgForSetup, { orgId });
  if (!org) throw new Error("Subaccount not found.");
  if (needsTrialCheckout(org)) return await buildTrialCheckout(ctx, org);
  return await buildSetupCheckout(ctx, org);
}

/** Build a Stripe Checkout (setup mode) so a studio adds a card. Shared by the
    agency-initiated and studio-self-serve paths. Returns a simulated result when
    Stripe isn't configured so the flow still completes in demo. */
async function buildSetupCheckout(
  ctx: ActionCtx,
  org: SetupOrg,
): Promise<{ url: string | null; simulated: boolean }> {
  const orgId = org.orgId;
  if (!process.env.STRIPE_SECRET_KEY) {
    // No Stripe in this environment - mark the card on file directly so the
    // gate clears (used in demo / local). Real deployments hit the webhook path.
    await ctx.runMutation(internal.agencyBilling._markPaymentMethodOnFile, { orgId });
    return { url: null, simulated: true };
  }
  const stripe = stripeClient();
  const customerId = await ensureOrgCustomer(stripe, org);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: `${baseUrl}/billing/added?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard`,
    metadata: { kind: "subaccount_billing", orgId },
    setup_intent_data: { metadata: { kind: "subaccount_billing", orgId } },
  });
  return { url: session.url ?? null, simulated: false };
}

/** Agency-initiated: get a link the studio owner can use to add their card. */
export const startPaymentSetup = action({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }): Promise<{ url: string | null; simulated: boolean }> => {
    await ctx.runQuery(internal.agencyBilling._assertBillingEdit, { orgId });
    return await buildCardCheckout(ctx, orgId);
  },
});

// ── Studio self-serve (the sub-account owner) ────────────────

/** The signed-in studio's own billing state, for the in-app banner/gate. */
export const myBilling = query({
  args: {},
  handler: async (ctx) => {
    // Shell-chrome read: degrade instead of throw while auth settles.
    let orgId: string;
    try {
      orgId = await currentOrg(ctx);
    } catch (e) {
      if (e instanceof AccessError) return null;
      throw e;
    }
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    // Agency operators acting-as a studio are never gated - they're here to fix it.
    const viewer = await resolveViewer(ctx).catch(() => null);
    const isAgencyActing = viewer?.kind === "agency_member";
    const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
    const view = billingView(org, plan, Date.now());
    return { ...view, locked: isAgencyActing ? false : view.locked, isAgencyActing, name: org.name };
  },
});

/** Studio owner opens the Stripe customer portal for their own subscription
 *  (update the card, see the next charge, cancel before a trial ends). */
export const openMyBillingPortal = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const orgId = await ctx.runQuery(internal.agencyBilling._myOrgId, {});
    const org = await ctx.runQuery(internal.agencyBilling._orgForSetup, { orgId });
    if (!org?.billingCustomerId) throw new Error("No billing account yet. Add a card first.");
    const stripe = stripeClient();
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const session = await stripe.billingPortal.sessions.create({
      customer: org.billingCustomerId,
      return_url: `${baseUrl}/billing`,
    });
    return { url: session.url };
  },
});

/** Studio owner adds their own card to clear the gate. */
export const startMyPaymentSetup = action({
  args: {},
  handler: async (ctx): Promise<{ url: string | null; simulated: boolean }> => {
    const orgId = await ctx.runQuery(internal.agencyBilling._myOrgId, {});
    return await buildCardCheckout(ctx, orgId);
  },
});

// ── Daily trial sweep (cron) ─────────────────────────────────

export const _sweepTrials = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    // Stripe-backed trials are left to Stripe: it charges the saved card at
    // trial_end and the webhook mirrors the result. Only local windows sweep.
    const trialing = (await ctx.db.query("orgs").collect()).filter(
      (o) =>
        o.billingStatus === "trialing" &&
        !o.billingSubscriptionId &&
        o.trialEndsAt !== undefined &&
        now >= o.trialEndsAt,
    );
    const flipped: { orgId: string; ownerEmail?: string; name: string; locked: boolean }[] = [];
    for (const org of trialing) {
      const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
      const hasCard = Boolean(org.paymentMethodOnFile);
      const next = hasCard ? "active" : "past_due";
      await ctx.db.patch(org._id, { billingStatus: next });
      const locked = !hasCard && (Boolean(plan?.requireCardAfterTrial) || org.trialCardRequiredBy !== undefined);
      flipped.push({ orgId: org.orgId, ownerEmail: org.ownerEmail ?? undefined, name: org.name, locked });
    }
    if (flipped.length) {
      await ctx.scheduler.runAfter(0, internal.agencyBilling._notifyExpired, { items: flipped });
    }
    return { swept: flipped.length };
  },
});

export const _notifyExpired = internalAction({
  args: {
    items: v.array(v.object({
      orgId: v.string(),
      ownerEmail: v.optional(v.string()),
      name: v.string(),
      locked: v.boolean(),
    })),
  },
  handler: async (_ctx, { items }) => {
    for (const it of items) {
      if (!it.ownerEmail) continue;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      await sendEmail({
        to: it.ownerEmail,
        subject: it.locked ? "Action needed: add a payment method to keep Pulse" : "Your Pulse trial has ended",
        html: `<p>Your free window for <strong>${escapeHtml(it.name)}</strong> has ended.</p>
          <p>${it.locked
            ? "Add a payment method to keep using your studio dashboard."
            : "You're all set - billing has started on your card on file."}</p>
          <p><a href="${baseUrl}/dashboard">Open Pulse</a></p>`,
      }).catch(() => undefined);
    }
  },
});
