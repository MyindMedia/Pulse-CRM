import type Stripe from "stripe";
import { BETA_PLAN_NAME } from "./plans";

/** Checkout params, read off the SDK method so the type tracks the SDK. */
export type SessionCreateParams = NonNullable<Parameters<Stripe["checkout"]["sessions"]["create"]>[0]>;
export type CheckoutLineItem = NonNullable<SessionCreateParams["line_items"]>[number];
type CheckoutCustomField = NonNullable<SessionCreateParams["custom_fields"]>[number];
type SubscriptionData = NonNullable<SessionCreateParams["subscription_data"]>;
type TrialData = Pick<SubscriptionData, "trial_period_days" | "trial_end" | "trial_settings">;

/* ============================================================
   Card-required trials (owner rule, 2026-10-07).

   "For the pricing for trials, users must enter a card. It will auto
   charge on renewal after the trial period. Beta is the only one that
   doesn't require a payment, but will require payment after the term."

   Pure helpers, no DB and no network, so the rules are unit-tested:

   - Every trial starts in Stripe Checkout, subscription mode, with
     payment_method_collection "always". The card is saved at the start
     and Stripe charges it when the trial ends.
   - If a trial somehow reaches its end with no payment method, Stripe
     cancels it (trial_settings.end_behavior.missing_payment_method).
   - Stripe owns the trial end. Our orgs.trialEndsAt is a mirror of the
     subscription's trial_end, written by the webhook, never a local guess.
   - The beta plan is the one card-free term, and it is never sold here.
   ============================================================ */

/** Stripe Checkout refuses a subscription_data.trial_end closer than 48 hours. */
export const MIN_TRIAL_END_LEAD_MS = 48 * 60 * 60 * 1000;

/** Stripe's ceiling on trial_period_days. */
export const MAX_TRIAL_DAYS = 730;

export type TrialSpec =
  | { kind: "none" }
  | { kind: "days"; days: number }
  | { kind: "until"; at: number };

/**
 * Pick the trial for a checkout.
 *
 * - `trialEndsAt` (a date already promised, e.g. a grandfathered trial or
 *   the end of a beta year): keep that exact date when Stripe allows it,
 *   otherwise no trial, because a date that close is effectively today.
 * - `trialDays`: a fresh trial of that many days.
 */
export function trialSpec(args: { trialDays?: number; trialEndsAt?: number; now: number }): TrialSpec {
  if (args.trialEndsAt !== undefined) {
    return args.trialEndsAt - args.now >= MIN_TRIAL_END_LEAD_MS
      ? { kind: "until", at: args.trialEndsAt }
      : { kind: "none" };
  }
  const days = Math.round(args.trialDays ?? 0);
  if (days <= 0) return { kind: "none" };
  return { kind: "days", days: Math.min(days, MAX_TRIAL_DAYS) };
}

/** The subscription_data trial fields for a spec. Empty for no trial. */
export function subscriptionTrialData(spec: TrialSpec): Partial<TrialData> {
  if (spec.kind === "none") return {};
  return {
    ...(spec.kind === "days"
      ? { trial_period_days: spec.days }
      : { trial_end: Math.floor(spec.at / 1000) }),
    trial_settings: { end_behavior: { missing_payment_method: "cancel" as const } },
  };
}

/** One Stripe Checkout session in subscription mode, card always collected.
 *  Every Pulse subscription checkout is built here so no path can start a
 *  trial without a card. */
export function buildSubscriptionCheckoutParams(args: {
  lineItems: CheckoutLineItem[];
  customer?: string;
  trial: TrialSpec;
  metadata: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  discounts?: { coupon: string }[];
  customFields?: CheckoutCustomField[];
}): SessionCreateParams {
  return {
    mode: "subscription",
    ...(args.customer ? { customer: args.customer } : {}),
    line_items: args.lineItems,
    // Card at the start, every time, trial or not.
    payment_method_collection: "always",
    ...(args.discounts ? { discounts: args.discounts } : {}),
    ...(args.customFields ? { custom_fields: args.customFields } : {}),
    metadata: args.metadata,
    subscription_data: {
      metadata: args.metadata,
      ...subscriptionTrialData(args.trial),
    },
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  };
}

/* ── Plans ─────────────────────────────────────────────────── */

export type PlanShape = {
  name?: string;
  isBeta?: boolean;
  priceCents: number;
  trialDays: number;
  isPromo?: boolean;
};

/** The beta plan: the only card-free term. Older rows predate the isBeta
 *  flag, so the seeded name still identifies it. */
export function isBetaPlan(plan: PlanShape | null | undefined): boolean {
  return Boolean(plan && (plan.isBeta === true || plan.name === BETA_PLAN_NAME));
}

/** A paid plan with a trial: the trial must start in Stripe with a card. */
export function isPaidTrialPlan(plan: PlanShape | null | undefined): boolean {
  return Boolean(plan && !isBetaPlan(plan) && plan.priceCents > 0 && plan.trialDays > 0);
}

/** A plan Stripe must bill: priced, and not the beta. A per-studio price
 *  override, when given, is the price that counts (0 means free for them). */
export function isPaidPlan(plan: PlanShape | null | undefined, priceCentsOverride?: number | null): boolean {
  if (!plan || isBetaPlan(plan)) return false;
  const cents = typeof priceCentsOverride === "number" ? priceCentsOverride : plan.priceCents;
  return cents > 0;
}

/** A studio left behind by the old "add a card" flow on a paid plan: marked
 *  active (often with a saved card) but no Stripe subscription charges it.
 *  The beta cohort runs on its own license and is not counted. */
export function isActiveWithoutSubscription(
  org: {
    billingStatus?: string;
    billingSubscriptionId?: string;
    betaCohort?: boolean;
    graduatedAt?: number;
    priceCentsOverride?: number;
  },
  plan: PlanShape | null | undefined,
): boolean {
  return (
    org.billingStatus === "active" &&
    !org.billingSubscriptionId &&
    !(org.betaCohort && !org.graduatedAt) &&
    isPaidPlan(plan, org.priceCentsOverride)
  );
}

/** A free trial with nothing to convert into. Banned for new plans: the only
 *  card-free window Pulse gives is the beta. */
export function isCardFreeTrialPlan(plan: PlanShape | null | undefined): boolean {
  return Boolean(plan && !isBetaPlan(plan) && plan.priceCents === 0 && plan.trialDays > 0);
}

/** Throws when a plan's settings would create a card-free trial. Used by the
 *  price book on create and update. */
export function assertNoCardFreeTrial(plan: PlanShape): void {
  if (isCardFreeTrialPlan(plan)) {
    throw new Error(
      "A free plan cannot carry a trial: every trial needs a card and converts into a paid plan. " +
        "Give the plan a price, or use the Beta plan for card-free access.",
    );
  }
}

export type InitialBilling = {
  billingStatus: "comped" | "trialing" | "pending_card" | "active" | "past_due";
  trialStartedAt: number | undefined;
  trialEndsAt: number | undefined;
};

/**
 * Billing state for a studio the moment it is put on a plan.
 *
 * A paid plan (with or without a trial) does NOT start here. It waits in
 * pending_card (gated) until the owner completes Stripe Checkout; the webhook
 * then mirrors Stripe's subscription (its trial window, or the first charge)
 * onto the org. `hasCard` only matters for a $0 promo plan. Returns null for a plan that
 * would be a card-free trial, which callers refuse or skip.
 */
export function initialBillingFor(
  plan: PlanShape,
  hasCard: boolean,
  now: number,
  dayMs: number,
): InitialBilling | null {
  if (isBetaPlan(plan)) {
    // The beta exception: a card-free window, ended by the beta paywall.
    return plan.trialDays > 0
      ? { billingStatus: "trialing", trialStartedAt: now, trialEndsAt: now + plan.trialDays * dayMs }
      : { billingStatus: "comped", trialStartedAt: undefined, trialEndsAt: undefined };
  }
  // Free forever (a partner or in-house room). Not a trial, so no card.
  if (plan.priceCents === 0 && !plan.isPromo) {
    return { billingStatus: "comped", trialStartedAt: undefined, trialEndsAt: undefined };
  }
  if (isCardFreeTrialPlan(plan)) return null;
  /* Every paid plan, trial or not, waits for Stripe Checkout. A saved card is
     not a subscription: only the webhook-confirmed subscription makes a paid
     studio trialing or active, so a card on file never short-circuits this. */
  if (isPaidPlan(plan)) {
    return { billingStatus: "pending_card", trialStartedAt: undefined, trialEndsAt: undefined };
  }
  return {
    billingStatus: hasCard ? "active" : "past_due",
    trialStartedAt: undefined,
    trialEndsAt: undefined,
  };
}

/* ── Subscriptions → org state ─────────────────────────────── */

/** The fields of a Stripe subscription the mirror reads. */
export type SubscriptionShape = {
  id: string;
  status: string;
  customer?: string | null;
  trial_start?: number | null;
  trial_end?: number | null;
  default_payment_method?: unknown;
  metadata?: Record<string, string> | null;
};

const LIVE_SUB_STATUSES = new Set(["trialing", "active", "past_due", "unpaid"]);

export function isLiveSubscriptionStatus(status: string | undefined): boolean {
  return Boolean(status && LIVE_SUB_STATUSES.has(status));
}

export type OrgSubscriptionPatch = {
  billingSubscriptionId: string;
  billingCustomerId?: string;
  billingStatus?: "trialing" | "active" | "past_due" | "canceled";
  trialStartedAt?: number;
  trialEndsAt?: number;
  paymentMethodOnFile?: boolean;
  paidSince?: number;
};

/**
 * Mirror a Stripe subscription onto an org. Stripe is the source of truth
 * for the trial window, so trial_end overwrites trialEndsAt whenever Stripe
 * sends one. Unknown or in-between statuses (incomplete, paused) leave the
 * status alone rather than guess.
 */
export function orgPatchFromSubscription(
  sub: SubscriptionShape,
  existing: { paidSince?: number; paymentMethodOnFile?: boolean },
  now: number,
): OrgSubscriptionPatch {
  const patch: OrgSubscriptionPatch = { billingSubscriptionId: sub.id };
  if (typeof sub.customer === "string" && sub.customer) patch.billingCustomerId = sub.customer;
  if (typeof sub.trial_start === "number") patch.trialStartedAt = sub.trial_start * 1000;
  if (typeof sub.trial_end === "number") patch.trialEndsAt = sub.trial_end * 1000;
  const hasCard = Boolean(sub.default_payment_method) || Boolean(existing.paymentMethodOnFile);

  switch (sub.status) {
    case "trialing":
      patch.billingStatus = "trialing";
      patch.paymentMethodOnFile = hasCard;
      break;
    case "active":
      patch.billingStatus = "active";
      patch.paymentMethodOnFile = true;
      if (!existing.paidSince) patch.paidSince = now;
      break;
    case "past_due":
    case "unpaid":
      patch.billingStatus = "past_due";
      break;
    case "canceled":
    case "incomplete_expired":
      patch.billingStatus = "canceled";
      break;
    default:
      break;
  }
  return patch;
}

/**
 * Double-charge guard. True when the org already has a different live
 * subscription and this one would be a second bill for the same studio.
 * The action refuses to open a second checkout; the webhook cancels any
 * duplicate that slips through (two tabs, two clicks).
 */
export function isDuplicateSubscription(
  org: { billingSubscriptionId?: string; billingStatus?: string },
  incoming: { id: string; status: string },
): boolean {
  if (!org.billingSubscriptionId || org.billingSubscriptionId === incoming.id) return false;
  const orgLive = org.billingStatus === "trialing" || org.billingStatus === "active" || org.billingStatus === "past_due";
  return orgLive && isLiveSubscriptionStatus(incoming.status);
}

/* ── Grandfathered card-free trials ────────────────────────── */

/** A trial that started before the card rule: running, not the beta, and
 *  with no Stripe subscription behind it. These are left running and flagged
 *  for a "add a card before your trial ends" reminder. */
export function isGrandfatheredCardFreeTrial(
  org: {
    billingStatus?: string;
    betaCohort?: boolean;
    billingSubscriptionId?: string;
    trialStartedAt?: number;
  },
  plan: PlanShape | null | undefined,
): boolean {
  return (
    org.billingStatus === "trialing" &&
    !org.betaCohort &&
    !org.billingSubscriptionId &&
    org.trialStartedAt !== undefined &&
    Boolean(plan) &&
    !isBetaPlan(plan)
  );
}
