/* ============================================================
   Pure billing-gate logic. No DB, no Stripe - just the rules that
   decide whether a sub-account is locked and how its trial reads.
   Unit-tested in agencyBilling.test.ts; imported by agencyBilling.ts,
   orgs.current, and the studio shell gate.
   ============================================================ */

export const DAY_MS = 24 * 60 * 60 * 1000;

export type BillingStatus = "trialing" | "active" | "past_due" | "comped" | "canceled";

/** The minimal billing shape the gate needs (subset of an org row). */
export type BillingOrg = {
  /** Beta programme fields. A beta licence hard-stops on its own date. */
  betaCohort?: boolean;
  betaLicenseUntil?: number;
  /** Moved onto normal terms. Ends the beta hard-stop, keeps the provenance. */
  graduatedAt?: number;
  billingStatus?: BillingStatus;
  trialStartedAt?: number;
  trialEndsAt?: number;
  paymentMethodOnFile?: boolean;
  agencyPlanId?: unknown;
};

export type GatePlan = {
  requireCardAfterTrial: boolean;
  priceCents: number;
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
    | "beta_expired"
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
  if (org?.betaCohort && org.betaLicenseUntil && !org.graduatedAt && now >= org.betaLicenseUntil) {
    if (org.billingStatus !== "active") {
      return { locked: true, trialDaysLeft: 0, inTrial: false, reason: "beta_expired" };
    }
  }

  if (!org || !org.billingStatus || !org.agencyPlanId || !plan) {
    return { ...base, reason: "no_plan" };
  }

  const status = org.billingStatus;
  const card = Boolean(org.paymentMethodOnFile);

  if (status === "comped") return { ...base, reason: "comped" };
  if (status === "canceled") return { ...base, reason: "canceled" };
  if (status === "active") return { ...base, reason: "active" };

  if (status === "trialing") {
    const left = trialDaysLeft(org.trialEndsAt, now);
    const expired = org.trialEndsAt !== undefined && now >= org.trialEndsAt;
    if (expired && plan.requireCardAfterTrial && !card) {
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

/** Effective monthly/interval price for a sub-account: override beats plan. */
export function effectivePriceCents(
  priceCentsOverride: number | undefined,
  planPriceCents: number | undefined,
): number {
  if (typeof priceCentsOverride === "number") return priceCentsOverride;
  return planPriceCents ?? 0;
}
