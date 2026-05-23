/* ============================================================
   Plan limits - single source of truth for what each tier gets.
   Used by createSubaccount, grants.issue, branding writes, usage
   metering, and the billing webhook.

   Public self-serve tiers: studio (Starter), pro, growth.
   enterprise is "contact us" (custom). `agency` is a LEGACY internal
   key kept for existing agency workspaces - it is not sold as a
   public tier (publicTier=false).
   ============================================================ */

export type TierKey = "studio" | "pro" | "growth" | "enterprise" | "agency";

export type TierLimits = {
  /** Customer-facing name. */
  label: string;
  tagline: string;
  /** Shown on the pricing page / onboard picker. */
  publicTier: boolean;
  /** "Contact us" instead of self-serve checkout. */
  custom: boolean;
  subAccountCap: number;
  magicLinkGrantsPerMonth: number;
  whitelabel: false | "studio_level" | "agency_level";
  customDomain: boolean;
  /** Monthly included AI credits (usage metering). */
  aiCreditsPerMonth: number;
  /** Storage quota in GB. */
  storageGb: number;
  /** Monthly USD price in cents. 0 = custom/contact. */
  priceCents: number;
};

export const PLAN_LIMITS: Record<TierKey, TierLimits> = {
  studio: {
    label: "Studio Starter",
    tagline: "Solo producer, engineer, or one-room studio.",
    publicTier: true,
    custom: false,
    subAccountCap: 1,
    magicLinkGrantsPerMonth: 5,
    whitelabel: false,
    customDomain: false,
    aiCreditsPerMonth: 100,
    storageGb: 5,
    priceCents: 4900,
  },
  pro: {
    label: "Studio Pro",
    tagline: "Professional studio with repeat clients and engineers.",
    publicTier: true,
    custom: false,
    subAccountCap: 1,
    magicLinkGrantsPerMonth: 25,
    whitelabel: "studio_level",
    customDomain: false,
    aiCreditsPerMonth: 500,
    storageGb: 50,
    priceCents: 12900,
  },
  growth: {
    label: "Studio Growth",
    tagline: "High-volume studio, production company, or producer collective.",
    publicTier: true,
    custom: false,
    subAccountCap: 3,
    magicLinkGrantsPerMonth: 100,
    whitelabel: "studio_level",
    customDomain: true,
    aiCreditsPerMonth: 2000,
    storageGb: 250,
    priceCents: 19900,
  },
  enterprise: {
    label: "Enterprise",
    tagline: "Schools, studio networks, and larger music organizations.",
    publicTier: true,
    custom: true,
    subAccountCap: 25,
    magicLinkGrantsPerMonth: 999,
    whitelabel: "agency_level",
    customDomain: true,
    aiCreditsPerMonth: 999_999,
    storageGb: 2000,
    priceCents: 0,
  },
  // ── Legacy internal tier - existing agency workspaces. Not sold publicly. ──
  agency: {
    label: "Agency",
    tagline: "Multi-studio operators (legacy plan).",
    publicTier: false,
    custom: false,
    subAccountCap: 999,
    magicLinkGrantsPerMonth: 999,
    whitelabel: "agency_level",
    customDomain: true,
    aiCreditsPerMonth: 999_999,
    storageGb: 2000,
    priceCents: 24900,
  },
};

export function limitsFor(tier: TierKey): TierLimits {
  return PLAN_LIMITS[tier];
}

/** Public self-serve tiers in display order. */
export const PUBLIC_TIERS: TierKey[] = ["studio", "pro", "growth", "enterprise"];
