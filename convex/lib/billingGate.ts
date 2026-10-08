/* ============================================================
   Pure billing-gate logic. No DB, no Stripe - just the rules that
   decide whether a sub-account is locked and how its trial reads.
   Unit-tested in agencyBilling.test.ts; imported by agencyBilling.ts,
   orgs.current, and the studio shell gate.
   ============================================================ */

import { BETA_PLAN_NAME } from "./plans";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** pending_card: a paid trial plan is assigned but the trial has not begun,
 *  because a trial only starts once Stripe Checkout has saved a card. */
export type BillingStatus = "trialing" | "pending_card" | "active" | "past_due" | "comped" | "canceled";

/** The minimal billing shape the gate needs (subset of an org row). */
export type BillingOrg = {
  /** Beta program fields. A beta license hard-stops on its own date. */
  betaCohort?: boolean;
  betaLicenseUntil?: number;
  /** Set on their first sign-in after signing. Absent = granted, not started. */
  betaStartedAt?: number;
  /** Moved onto normal terms. Ends the beta hard-stop, keeps the provenance. */
  graduatedAt?: number;
  billingStatus?: BillingStatus;
  trialStartedAt?: number;
  trialEndsAt?: number;
  paymentMethodOnFile?: boolean;
  agencyPlanId?: unknown;
  /** Stripe subscription behind this studio's billing, when there is one. */
  billingSubscriptionId?: string;
  /** Set on a grandfathered card-free trial: a card is due by this date. */
  trialCardRequiredBy?: number;
};

export type GatePlan = {
  requireCardAfterTrial: boolean;
  priceCents: number;
  /** The beta plan, the one card-free term. Ends in the beta paywall. */
  isBeta?: boolean;
  name?: string;
  /** Early-adopter intro: introPriceCents for the first introMonths. */
  introPriceCents?: number;
  introMonths?: number;
};

export type BillingGate = {
  /** App is hard-locked: trial lapsed, a card is required, none on file. */
  locked: boolean;
  /** Show a "trial ending" banner with this many whole days left (>=0). */
  trialDaysLeft: number | null;
  /** True while inside a running trial window. */
  inTrial: boolean;
  /** Machine reason for the current state - drives banner/gate copy. */
  reason:
    | "none"
    | "no_plan"
    | "comped"
    | "beta_pending"
    | "beta_expired"
    | "trial_needs_card"
    | "trialing"
    | "trial_ending"
    | "trial_expired_needs_card"
    | "past_due"
    | "active"
    | "canceled";
};

/** Whole days remaining until `endsAt` from `now` (never negative). */
export function trialDaysLeft(endsAt: number | undefined, now: number): number | null {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - now) / DAY_MS));
}

/**
 * Resolve a sub-account's billing gate. `plan` may be null when the account has
 * no agency plan assigned (base/standalone studios, or not yet set up) - those
 * are never locked by this layer.
 */
export function evaluateBillingGate(
  org: BillingOrg | null | undefined,
  plan: GatePlan | null | undefined,
  now: number,
): BillingGate {
  const base = { locked: false, trialDaysLeft: null as number | null, inTrial: false };

  /*
   * A beta licence hard-stops on its own date.
   *
   * Checked FIRST, before the plan, and independently of
   * requireCardAfterTrial. Two reasons: beta studios sit on a shared agency
   * plan, so whether a beta year ends must not depend on a setting that also
   * governs everyone else on it; and a studio that claimed its workspace from
   * an invite has no agency plan at all, which would otherwise fall straight
   * through to "no_plan" and never lock.
   *
   * An active paid subscription clears it. That is the whole point of the gate.
   *
   * So does graduating. `betaCohort` is kept forever as provenance and
   * `betaLicenseUntil` is never rewound, so without this a studio moved onto a
   * paid tier by hand would still be locked out the morning its old beta date
   * passed - punished for the upgrade.
   */
  /* Subscribed in Stripe: a live subscription (trialing toward its first
     charge, or active) clears the beta stop. A beta studio that picks a plan
     before its year ends is billed from the end of the year, so it sits in
     Stripe's trialing state until then and must not be locked meanwhile. */
  const subscribed =
    Boolean(org?.billingSubscriptionId) &&
    (org?.billingStatus === "active" || org?.billingStatus === "trialing");

  if (org?.betaCohort && !org.graduatedAt) {
    /* Granted but not started. The clock begins on their first sign-in after
       signing the agreement, so between the grant and that moment there is
       no countdown to show and nothing that can expire. Reading the absence
       of a date as "expired" would lock a studio out of a beta it had not
       begun. */
    if (!org.betaLicenseUntil) {
      return { locked: false, trialDaysLeft: null, inTrial: false, reason: "beta_pending" };
    }
    if (now >= org.betaLicenseUntil && org.billingStatus !== "active" && !subscribed) {
      return { locked: true, trialDaysLeft: 0, inTrial: false, reason: "beta_expired" };
    }
  }

  if (!org || !org.billingStatus || !org.agencyPlanId || !plan) {
    return { ...base, reason: "no_plan" };
  }

  const status = org.billingStatus;
  const card = Boolean(org.paymentMethodOnFile);

  if (status === "comped") return { ...base, reason: "comped" };
  if (status === "active") return { ...base, reason: "active" };
  /* Studios on the Beta plan without the cohort flag (auto-enrolled by the
     agency) get the same end of term: payment is required after it.
     Cohort studios are handled by the license check above, and a graduated
     studio is on whatever terms the agency moved it to. */
  const betaPlanTerm =
    (plan.isBeta === true || plan.name === BETA_PLAN_NAME) && !org.betaCohort && !org.graduatedAt;
  const betaWindowOver = org.trialEndsAt !== undefined && now >= org.trialEndsAt;

  if (status === "canceled") {
    /* A Beta-plan studio that subscribed through the beta checkout and then
       canceled. The Beta plan costs nothing, so the paywall below would never
       fire; once the beta window has passed, payment is required. */
    if (betaPlanTerm && betaWindowOver) {
      return { locked: true, trialDaysLeft: 0, inTrial: false, reason: "beta_expired" };
    }
    /* A Stripe-backed paid plan that was canceled (including a trial Stripe
       canceled for having no card at the end) is a paywall, not free access.
       Data stays; the studio subscribes again to get back in. */
    const paywalled = Boolean(org.billingSubscriptionId) && plan.priceCents > 0;
    return { ...base, locked: paywalled, reason: "canceled" };
  }

  /* A paid trial plan is assigned, but the trial has not started: it only
     starts once the owner saves a card in Stripe Checkout. Until then the
     studio sees the "start your trial" screen. */
  if (status === "pending_card") {
    return { locked: true, trialDaysLeft: null, inTrial: false, reason: "trial_needs_card" };
  }

  if (status === "trialing") {
    const left = trialDaysLeft(org.trialEndsAt, now);
    const expired = betaWindowOver;
    if (expired && betaPlanTerm && !subscribed) {
      return { locked: true, trialDaysLeft: 0, inTrial: false, reason: "beta_expired" };
    }
    // Grandfathered card-free trials owe a card at the end whatever the plan says.
    const cardDue = plan.requireCardAfterTrial || org.trialCardRequiredBy !== undefined;
    if (expired && cardDue && !card) {
      return { locked: true, trialDaysLeft: 0, inTrial: false, reason: "trial_expired_needs_card" };
    }
    // Within 3 days → "ending soon" so the banner nudges harder.
    const reason = left !== null && left <= 3 ? "trial_ending" : "trialing";
    return { locked: false, trialDaysLeft: left, inTrial: true, reason };
  }

  // past_due
  const locked = plan.requireCardAfterTrial && !card;
  return { locked, trialDaysLeft: 0, inTrial: false, reason: "past_due" };
}

/* ============================================================
   Server-side enforcement.

   The overlay in the browser is a courtesy; this is the lock. lib/access.ts
   asks it on every studio viewer resolve and refuses the call when it says
   locked. It follows the gate above with one softening: a studio that went
   past due keeps working through a grace period, because a lapsed card is
   often fixed within a day and locking a paying studio out mid-session over
   it costs more than the few days of access.
   ============================================================ */

/** Days a past-due studio keeps working before the server locks it. */
export const PAST_DUE_GRACE_DAYS_DEFAULT = 3;

/** The grace, from PULSE_PAST_DUE_GRACE_DAYS when it is a sane number. */
export function pastDueGraceMs(raw: string | undefined = process.env.PULSE_PAST_DUE_GRACE_DAYS): number {
  const days = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  return (Number.isFinite(days) && days >= 0 ? days : PAST_DUE_GRACE_DAYS_DEFAULT) * DAY_MS;
}

/** Whether the server refuses this studio's calls. */
export function serverBillingLock(
  org: BillingOrg | null | undefined,
  plan: GatePlan | null | undefined,
  now: number,
  graceMs: number = pastDueGraceMs(),
): { locked: boolean; reason: BillingGate["reason"] } {
  const gate = evaluateBillingGate(org, plan, now);
  if (!gate.locked) return { locked: false, reason: gate.reason };
  if (gate.reason === "past_due") {
    /* The trial sweep flips a studio to past_due at its trial end, so that is
       when the debt started. With no date to measure from, do not lock: a
       wrong lock on a paying studio is the worse mistake. */
    const since = org?.trialEndsAt;
    if (since === undefined || now < since + graceMs) return { locked: false, reason: gate.reason };
  }
  return { locked: true, reason: gate.reason };
}

/** Effective monthly/interval price for a sub-account: override beats plan. */
export function effectivePriceCents(
  priceCentsOverride: number | undefined,
  planPriceCents: number | undefined,
): number {
  if (typeof priceCentsOverride === "number") return priceCentsOverride;
  return planPriceCents ?? 0;
}

/* ============================================================
   Early-adopter intro pricing.

   A plan can charge less for its first few months. The window runs from
   when the studio started paying, so it is measured against the same
   billing clock everything else uses rather than a second stored date
   that could drift out of step with it.
   ============================================================ */

/** Whether a studio is still inside its plan's intro window. */
export function inIntroWindow(
  plan: { introPriceCents?: number; introMonths?: number } | null | undefined,
  paidSince: number | undefined,
  now: number,
): boolean {
  if (!plan?.introMonths || typeof plan.introPriceCents !== "number") return false;
  if (!paidSince) return false;
  return now < paidSince + plan.introMonths * 30 * DAY_MS;
}

/**
 * What this studio is charged right now.
 *
 * Order matters and is deliberate: an agency's hand-set override beats
 * everything (it is a decision about one studio), then the intro price
 * while the window is open, then the plan's regular price.
 */
export function currentPriceCents(
  priceCentsOverride: number | undefined,
  plan: GatePlan | null | undefined,
  paidSince: number | undefined,
  now: number,
): number {
  if (typeof priceCentsOverride === "number") return priceCentsOverride;
  if (inIntroWindow(plan, paidSince, now)) return plan!.introPriceCents!;
  return plan?.priceCents ?? 0;
}
