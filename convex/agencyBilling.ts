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
  buildSubscriptionCheckoutParams, initialBillingFor, isActiveWithoutSubscription, isBetaPlan,
  isLiveSubscriptionStatus, isPaidPlan, isPaidTrialPlan, trialSpec, type CheckoutLineItem, type TrialSpec,
} from "./lib/trialCheckout";
import { formatUsd } from "./lib/pricing";
import { planConfirmHtml, planConfirmSubject } from "./lib/emailTemplates/trialEmails";

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

   Every paid plan is charged (agency-paid-plan-charges): a paid plan
   with NO trial goes the same way. "Add a card" opens a subscription
   Checkout that bills the plan's price on completion and renews; the
   studio is active only once the webhook mirrors that subscription.
   Saving a card alone never activates a paid plan.

   Runbook (studios the old card-only flow left active with no
   subscription; see openspec/changes/agency-paid-plan-charges/design.md):
     npx convex run agencyBilling:cardOnlyStudiosReport --prod
     npx convex run agencyBilling:sendCardOnlyConversionReminders --prod            # dry run
     npx convex run agencyBilling:sendCardOnlyConversionReminders '{"apply":true}' --prod
     npx convex run agencyBilling:betaPlanStudiosReport --prod

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
    /* Paid plan marked active by the old card-only flow, with no subscription
       charging it. /billing asks them to confirm the plan (charged then). */
    needsPlanConfirmation: isActiveWithoutSubscription(org, plan),
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
      billingCheckoutSessionId: org.billingCheckoutSessionId ?? null,
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
/** The caller's studio, for the self-serve billing actions (add a card, open
 *  the portal, convert from the beta). Spending the studio's money is the
 *  owner's call, or an agency operator's with billing.edit; any other member
 *  is refused. Reachable while the studio is billing-locked, since this is
 *  how a locked studio gets unlocked. */
export const _myBillingOrgId = internalQuery({
  args: {},
  handler: async (ctx): Promise<string> => {
    const viewer = await resolveViewer(ctx, { allowLocked: true });
    const allowed =
      viewer.kind === "studio_member"
        ? viewer.role === "owner" || viewer.capabilities.has("billing.edit")
        : viewer.capabilities.has("billing.edit");
    if (!allowed) {
      throw new AccessError("CAPABILITY_DENIED", "Only the studio owner can manage billing.");
    }
    return await currentOrg(ctx, { allowLocked: true });
  },
});

/** A card was saved in setup mode (no subscription). For a paid plan that is
 *  NOT payment: the card is recorded but the status is left alone, because
 *  only a webhook-confirmed Stripe subscription may make a paid studio active.
 *  A setup link opened before this change and completed after it lands here. */
export const _markPaymentMethodOnFile = internalMutation({
  args: { orgId: v.string(), customerId: v.optional(v.string()), subscriptionId: v.optional(v.string()) },
  handler: async (ctx, { orgId, customerId, subscriptionId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return;
    const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
    const ids = {
      ...(customerId ? { billingCustomerId: customerId } : {}),
      ...(subscriptionId ? { billingSubscriptionId: subscriptionId } : {}),
    };
    if (isPaidPlan(plan, org.priceCentsOverride) && !subscriptionId) {
      await ctx.db.patch(org._id, { paymentMethodOnFile: true, ...ids });
      return;
    }
    await ctx.db.patch(org._id, {
      paymentMethodOnFile: true,
      billingStatus: "active",
      // First time they go active is when any intro window starts running.
      ...(org.paidSince ? {} : { paidSince: Date.now() }),
      ...ids,
    });
  },
});

/** Remember the subscription Checkout just opened, so the next one can expire
 *  it (or refuse, if it already went through). */
export const _recordCheckoutSession = internalMutation({
  args: { orgId: v.string(), sessionId: v.string() },
  handler: async (ctx, { orgId, sessionId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return;
    await ctx.db.patch(org._id, { billingCheckoutSessionId: sessionId });
  },
});

/** What the card flows need to know about a studio (see _orgForSetup). */
export type SetupOrg = {
  orgId: string;
  name: string;
  ownerEmail: string | null;
  billingCustomerId: string | null;
  billingSubscriptionId: string | null;
  billingCheckoutSessionId?: string | null;
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

type CheckoutRouteOrg = Pick<SetupOrg, "plan" | "billingStatus" | "billingSubscriptionId"> & {
  priceCentsOverride?: number | null;
};

/** The studio is on a plan Stripe must bill (priced, not the beta). */
function paidPlanFor(org: CheckoutRouteOrg): boolean {
  return isPaidPlan(org.plan, org.priceCentsOverride);
}

/** A subscription we know of that is still trialing, paying or owed. */
function hasLiveSubscription(org: Pick<SetupOrg, "billingStatus" | "billingSubscriptionId">): boolean {
  return Boolean(org.billingSubscriptionId) && isLiveSubscriptionStatus(liveStatusOf(org.billingStatus ?? undefined));
}

/**
 * True when "add a card" for this studio must open a Stripe subscription
 * Checkout rather than just save a card. Every paid plan (not the beta, not a
 * $0 override, not comped) with no live subscription: a card-required trial,
 * a carried-over grandfathered trial, a paid plan with no trial (charged on
 * completion), a card-only studio confirming its plan, or a resubscribe after
 * a cancel. A live subscription is never opened twice.
 */
export function needsSubscriptionCheckout(org: CheckoutRouteOrg): boolean {
  if (!paidPlanFor(org)) return false;
  if (org.billingStatus === "comped") return false;
  return !hasLiveSubscription(org);
}

/** Older name, kept for callers and tests. */
export const needsTrialCheckout = needsSubscriptionCheckout;

/**
 * The trial to give a studio at checkout. One trial per studio:
 * - pending_card (never started): a fresh trial of the plan's length, or none
 *   for a plan without a trial (charged when Checkout completes);
 * - a grandfathered card-free trial still running: the date already promised;
 * - anything else (canceled, past_due, a card-only "active" studio): no trial,
 *   Stripe charges on subscribe.
 */
export function trialForOrg(org: Pick<SetupOrg, "plan" | "billingStatus" | "trialEndsAt">, now: number): TrialSpec {
  if (org.billingStatus === "pending_card") {
    return trialSpec({ trialDays: org.plan?.trialDays ?? 0, now });
  }
  if (org.billingStatus === "trialing" && org.trialEndsAt) {
    return trialSpec({ trialEndsAt: org.trialEndsAt, now });
  }
  return { kind: "none" };
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

/**
 * Before opening a new subscription Checkout, deal with the last one:
 * - still open: expire it, so two tabs cannot both complete and bill twice;
 * - already completed (the webhook may not have landed yet) with a live
 *   subscription: refuse, that studio is already paying;
 * - anything else (expired, its subscription canceled, unknown): carry on.
 */
export async function settlePriorCheckout(
  stripe: ReturnType<typeof stripeClient>,
  sessionId: string | null | undefined,
): Promise<void> {
  if (!sessionId) return;
  let session: { status?: string | null; subscription?: unknown };
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return; // Unknown to Stripe (wrong mode, deleted): nothing to settle.
  }
  if (session.status === "open") {
    try {
      await stripe.checkout.sessions.expire(sessionId);
    } catch {
      // Completed or expired in the meantime; the webhook guard still applies.
    }
    return;
  }
  if (session.status === "complete") {
    const sub = session.subscription;
    const subId = typeof sub === "string" ? sub : sub && typeof sub === "object" ? (sub as { id?: string }).id : undefined;
    await assertNoLiveSubscription(stripe, subId ?? null);
  }
}

/** Stripe Checkout in subscription mode, card always collected. Starts a
 *  card-required trial, or (no trial) charges the plan's price on completion.
 *  Nothing on our side changes until the webhook mirrors the subscription. */
async function buildSubscriptionCheckout(
  ctx: ActionCtx,
  org: SetupOrg,
): Promise<{ url: string | null; simulated: boolean }> {
  const now = Date.now();
  const trial = trialForOrg(org, now);
  // Checkout and subscription metadata. The webhook accepts either kind.
  const kind = trial.kind === "none" ? "subaccount_plan" : "subaccount_trial";
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
        metadata: { kind, orgId: org.orgId },
      },
    });
    return { url: null, simulated: true };
  }
  const stripe = stripeClient();
  await assertNoLiveSubscription(stripe, org.billingSubscriptionId);
  await settlePriorCheckout(stripe, org.billingCheckoutSessionId);
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
      metadata: { kind, orgId: org.orgId, planId: plan._id },
      successUrl: `${baseUrl}/billing/added?session_id={CHECKOUT_SESSION_ID}&${trial.kind === "none" ? "plan" : "trial"}=1`,
      cancelUrl: `${baseUrl}/billing`,
    }),
  );
  await ctx.runMutation(internal.agencyBilling._recordCheckoutSession, { orgId: org.orgId, sessionId: session.id });
  return { url: session.url ?? null, simulated: false };
}

/** "Add a card" for a studio. Every paid plan goes through the subscription
 *  checkout above; a free, comped or Beta studio keeps the setup-mode flow
 *  below (it saves a card and charges nothing). */
async function buildCardCheckout(
  ctx: ActionCtx,
  orgId: string,
): Promise<{ url: string | null; simulated: boolean }> {
  const org = await ctx.runQuery(internal.agencyBilling._orgForSetup, { orgId });
  if (!org) throw new Error("Subaccount not found.");
  if (needsSubscriptionCheckout(org)) return await buildSubscriptionCheckout(ctx, org);
  if (paidPlanFor(org) && hasLiveSubscription(org)) {
    // Card changes on a live subscription belong in the Stripe portal.
    throw new Error("This studio already has a subscription. Manage it from the billing page instead of starting another.");
  }
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
    // Allowed while billing-locked: this is what draws the lock screen.
    let orgId: string;
    try {
      orgId = await currentOrg(ctx, { allowLocked: true });
    } catch (e) {
      if (e instanceof AccessError) return null;
      throw e;
    }
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return null;
    // Agency operators acting-as a studio are never gated - they're here to fix it.
    const viewer = await resolveViewer(ctx, { allowLocked: true }).catch(() => null);
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
    const orgId = await ctx.runQuery(internal.agencyBilling._myBillingOrgId, {});
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
    const orgId = await ctx.runQuery(internal.agencyBilling._myBillingOrgId, {});
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

// ── Paid plans with no subscription (card-only studios) ──────
//
// The old "add a card" flow saved a card (setup mode) and marked a paid
// studio active with no Stripe subscription, so nothing ever charged it.
// These are read-only (report) or ask-only (reminder): no card is ever
// charged from here. Confirming opens a normal subscription Checkout.

function appBase(): string {
  return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://studiopulse.tech";
}

type CardOnlyRow = {
  orgId: string;
  agencyId: string | null;
  planId: string | null;
  priceCents: number;
  billingInterval: "month" | "year" | null;
  /** stripe_card: a card saved through Stripe (a customer exists), so the
   *  owner can confirm in one step. manual: marked active by hand (offline
   *  payment, or no Stripe), left for the agency to decide; never emailed. */
  source: "stripe_card" | "manual";
  cardOnFile: boolean;
  paidSince: number | null;
  reminderSentAt: number | null;
};

/** Report: studios on a paid plan marked active with no Stripe subscription.
 *  Ids, amounts and dates only, no names or emails, so it is safe to paste. */
export const cardOnlyStudiosReport = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    count: number;
    stripeCard: number;
    manual: number;
    monthlyCentsAtRisk: number;
    orgIds: string[];
    rows: CardOnlyRow[];
  }> => {
    const orgs = (await ctx.db.query("orgs").collect()).filter(
      (o) => o.billingStatus === "active" && !o.billingSubscriptionId,
    );
    const rows: CardOnlyRow[] = [];
    for (const org of orgs) {
      const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
      if (!isActiveWithoutSubscription(org, plan)) continue;
      const cardOnFile = Boolean(org.paymentMethodOnFile);
      rows.push({
        orgId: org.orgId,
        agencyId: org.agencyId ?? null,
        planId: plan?._id ?? null,
        priceCents: effectivePriceCents(org.priceCentsOverride, plan?.priceCents),
        billingInterval: plan?.billingInterval ?? null,
        source: cardOnFile && org.billingCustomerId ? "stripe_card" : "manual",
        cardOnFile,
        paidSince: org.paidSince ?? null,
        reminderSentAt: org.planConfirmReminderSentAt ?? null,
      });
    }
    const monthlyCentsAtRisk = rows.reduce(
      (sum, r) => sum + (r.billingInterval === "year" ? Math.round(r.priceCents / 12) : r.priceCents),
      0,
    );
    return {
      count: rows.length,
      stripeCard: rows.filter((r) => r.source === "stripe_card").length,
      manual: rows.filter((r) => r.source === "manual").length,
      monthlyCentsAtRisk,
      orgIds: rows.map((r) => r.orgId),
      rows,
    };
  },
});

/** Internal - the reminder list with addresses. Never logged. */
export const _cardOnlyDue = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const orgs = (await ctx.db.query("orgs").collect()).filter(
      (o) => o.billingStatus === "active" && !o.billingSubscriptionId,
    );
    const due: {
      orgId: string;
      email: string;
      ownerName: string | null;
      name: string;
      planName: string;
      priceLabel: string | null;
      interval: "month" | "year";
    }[] = [];
    for (const org of orgs) {
      const plan = org.agencyPlanId ? await ctx.db.get(org.agencyPlanId) : null;
      if (!plan || !isActiveWithoutSubscription(org, plan)) continue;
      // Stripe-saved cards only: a studio marked active by hand is the agency's call.
      if (!org.paymentMethodOnFile || !org.billingCustomerId) continue;
      if (!org.ownerEmail || org.planConfirmReminderSentAt) continue; // once per studio
      const cents = currentPriceCents(org.priceCentsOverride, plan, org.paidSince, now);
      due.push({
        orgId: org.orgId,
        email: org.ownerEmail,
        ownerName: org.ownerName ?? null,
        name: org.name,
        planName: plan.name,
        priceLabel: cents > 0 ? `${formatUsd(cents)}/${plan.billingInterval}` : null,
        interval: plan.billingInterval,
      });
    }
    return due;
  },
});

export const _markPlanConfirmReminder = internalMutation({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", orgId)).first();
    if (!org) return;
    await ctx.db.patch(org._id, { planConfirmReminderSentAt: Date.now() });
    await ctx.db.insert("activity", {
      orgId,
      kind: "billing.plan_confirm_requested",
      summary: "The owner was asked to confirm the plan: a card was saved but no subscription was charging it",
      accent: "info",
    });
  },
});

/**
 * "Please confirm your plan" for card-only studios. Dry run by default:
 * returns who would be emailed (ids only). With apply, sends each owner one
 * branded email linking to /billing and stamps planConfirmReminderSentAt.
 * Never charges a card and never changes billing status.
 */
export const sendCardOnlyConversionReminders = internalAction({
  args: { apply: v.optional(v.boolean()) },
  handler: async (ctx, { apply }): Promise<{ dryRun: boolean; eligible: number; sent: number; orgIds: string[] }> => {
    const due = await ctx.runQuery(internal.agencyBilling._cardOnlyDue, {});
    const orgIds = due.map((d) => d.orgId);
    if (!apply) return { dryRun: true, eligible: due.length, sent: 0, orgIds };
    let sent = 0;
    for (const d of due) {
      const status = await sendEmail({
        to: d.email,
        subject: planConfirmSubject(d.name),
        html: planConfirmHtml({
          ownerName: d.ownerName ?? undefined,
          studioName: d.name,
          planName: d.planName,
          priceLabel: d.priceLabel ?? undefined,
          interval: d.interval,
          confirmUrl: `${appBase()}/billing`,
        }),
        audience: "client",
      });
      // Stamp regardless of status, so a bounce cannot become a resend loop.
      await ctx.runMutation(internal.agencyBilling._markPlanConfirmReminder, { orgId: d.orgId });
      if (status === "sent") sent++;
    }
    console.log(`[agencyBilling] plan-confirm reminders: eligible=${due.length} sent=${sent}`);
    return { dryRun: false, eligible: due.length, sent, orgIds };
  },
});

// ── Beta-plan studios ────────────────────────────────────────

type BetaRow = {
  orgId: string;
  agencyId: string | null;
  betaCohort: boolean;
  betaStart: number | null;
  betaEnd: number | null;
  daysLeft: number | null;
  billingStatus: string | null;
  subscribed: boolean;
  graduated: boolean;
};

/** Report: agency-enrolled studios on the Beta plan (the one card-free term),
 *  with each one's start, end and days left. Cohort studios run on their
 *  license dates. Ids and dates only, no names or emails. */
export const betaPlanStudiosReport = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    count: number;
    running: number;
    ended: number;
    subscribed: number;
    endingIn30Days: number;
    orgIds: string[];
    rows: BetaRow[];
  }> => {
    const now = Date.now();
    const plans = await ctx.db.query("agencyPlans").collect();
    const betaPlanIds = new Set(plans.filter((p) => isBetaPlan(p)).map((p) => p._id as string));
    const orgs = (await ctx.db.query("orgs").collect()).filter(
      (o) => o.agencyPlanId && betaPlanIds.has(o.agencyPlanId as string),
    );
    const rows: BetaRow[] = orgs.map((o) => {
      const cohort = o.betaCohort === true;
      const start = (cohort ? o.betaStartedAt : o.trialStartedAt) ?? o.trialStartedAt ?? null;
      const end = (cohort ? o.betaLicenseUntil : o.trialEndsAt) ?? null;
      return {
        orgId: o.orgId,
        agencyId: o.agencyId ?? null,
        betaCohort: cohort,
        betaStart: start,
        betaEnd: end,
        daysLeft: end === null ? null : Math.max(0, Math.ceil((end - now) / DAY_MS)),
        billingStatus: o.billingStatus ?? null,
        subscribed: Boolean(o.billingSubscriptionId),
        graduated: Boolean(o.graduatedAt),
      };
    });
    return {
      count: rows.length,
      running: rows.filter((r) => r.betaEnd !== null && r.betaEnd > now).length,
      ended: rows.filter((r) => r.betaEnd !== null && r.betaEnd <= now).length,
      subscribed: rows.filter((r) => r.subscribed).length,
      endingIn30Days: rows.filter((r) => r.betaEnd !== null && r.betaEnd > now && r.betaEnd - now <= 30 * DAY_MS).length,
      orgIds: rows.map((r) => r.orgId),
      rows,
    };
  },
});
