/* ============================================================
   Plan limits — single source of truth for what each tier gets.
   Used by createSubaccount, grants.issue, branding writes, and
   the billing webhook. Cycle 3 wires Stripe price IDs to these.
   ============================================================ */

export type TierKey = "studio" | "pro" | "agency";

export type TierLimits = {
  subAccountCap: number;
  magicLinkGrantsPerMonth: number;
  whitelabel: false | "studio_level" | "agency_level";
  customDomain: boolean;
  /** Monthly USD price in cents — wired to Stripe in cycle 3. */
  priceCents: number;
};

export const PLAN_LIMITS: Record<TierKey, TierLimits> = {
  studio: {
    subAccountCap: 1,
    magicLinkGrantsPerMonth: 5,
    whitelabel: false,
    customDomain: false,
    priceCents: 4900,
  },
  pro: {
    subAccountCap: 2,
    magicLinkGrantsPerMonth: 25,
    whitelabel: "studio_level",
    customDomain: false,
    priceCents: 9700,
  },
  agency: {
    subAccountCap: 999,
    magicLinkGrantsPerMonth: 999,
    whitelabel: "agency_level",
    customDomain: true,
    priceCents: 24900,
  },
};

export function limitsFor(tier: TierKey): TierLimits {
  return PLAN_LIMITS[tier];
}
