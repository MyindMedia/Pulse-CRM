/* ============================================================
   Plan limits, derived from convex/lib/pricing.ts.

   pricing.ts is the single source of truth for the Core / Growth / Max
   ladder: names, prices, allowances and which tier each capability
   belongs to. This module shapes that config into the PLAN_LIMITS
   record the gating, metering and billing code has always read, so
   none of those call sites carries a number of its own.

     core    $149/mo   Book it, hold the card, get paid.
     growth  $297/mo   Staff, payroll, the assistant, the gear and cables.
     max     $699/mo   Everything, unlimited studios, full white label.

   WHITE LABEL LEVELS
     false          Pulse-branded app chrome. The studio's logo still
                    appears on its own booking page and client portal.
     "studio_level" Studio logo + accent color inside the app.
     "full"         Full UI customization: logo, palette, typography,
                    login screen, email templates, custom domain.
                    A "Powered by Pulse" lockup sits under their logo
                    and is NOT removable at any price. See
                    POWERED_BY_PULSE_REQUIRED.
   ============================================================ */

import {
  ALLOWANCES,
  PRICING,
  TIERS,
  WHITELABEL,
  capabilitiesAtTier,
  formatUsd,
  tierAtLeast as tierAtLeastBase,
  type BillingInterval,
  type CapabilityKey,
  type TierKey,
  type WhitelabelLevel,
} from "./pricing";

export type { BillingInterval, CapabilityKey, TierKey, WhitelabelLevel };
export { TIERS, UNLIMITED } from "./pricing";

export type TierLimits = {
  /** Customer-facing name. */
  label: string;
  tagline: string;
  /** One line for the pricing page, in the studio owner's language. */
  pitch: string;
  /** Display order on the pricing page. */
  order: number;
  /** Studios under one account. */
  subAccountCap: number;
  magicLinkGrantsPerMonth: number;
  whitelabel: WhitelabelLevel;
  customDomain: boolean;
  /** Monthly included assistant credits (usage metering). */
  aiCreditsPerMonth: number;
  /** Storage quota in GB. */
  storageGb: number;
  /** Bookable rooms. */
  roomCap: number;
  /** Team members with a login. */
  staffCap: number;
  /** Connected social accounts (Marketing). */
  socialAccountCap: number;
  /** Scheduled social posts per month (Marketing). */
  socialPostsPerMonth: number;
  /** True when allowances are shared across every studio in the group. */
  pooled: boolean;
  /** Monthly USD price in cents. */
  priceCents: number;
  /** Annual USD price in cents. */
  annualPriceCents: number;
  /** Everything this tier can reach. Enforced by lib/entitlements.ts. */
  capabilities: CapabilityKey[];
};

function limitsFromConfig(tier: TierKey, order: number): TierLimits {
  const p = PRICING[tier];
  const a = ALLOWANCES[tier];
  const capabilities = capabilitiesAtTier(tier);
  return {
    label: p.name,
    tagline: p.who,
    pitch: p.tagline,
    order,
    subAccountCap: a.studios,
    magicLinkGrantsPerMonth: a.inviteLinksPerMonth,
    whitelabel: WHITELABEL[tier],
    customDomain: capabilities.includes("customDomain"),
    aiCreditsPerMonth: a.assistantPerMonth,
    storageGb: a.storageGb,
    roomCap: a.rooms,
    staffCap: a.staff,
    socialAccountCap: a.socialAccounts,
    socialPostsPerMonth: a.socialPostsPerMonth,
    pooled: a.pooled,
    priceCents: p.monthlyCents,
    annualPriceCents: p.annualCents,
    capabilities,
  };
}

export const PLAN_LIMITS: Record<TierKey, TierLimits> = {
  core: limitsFromConfig("core", 1),
  growth: limitsFromConfig("growth", 2),
  max: limitsFromConfig("max", 3),
};

/** The "Powered by Pulse" lockup is a condition of the white-label tier, not
 *  a feature flag. Nothing in the product may remove it. */
export const POWERED_BY_PULSE_REQUIRED = true;

export function limitsFor(tier: TierKey): TierLimits {
  return PLAN_LIMITS[tier];
}

/** Public self-serve tiers in display order. */
export const PUBLIC_TIERS: TierKey[] = [...TIERS];

/** The tiers we sell, cheapest first. */
export const SELLABLE_TIERS: TierKey[] = [...TIERS];

/** Formatted monthly price, e.g. "$149". */
export function priceLabel(tier: TierKey): string {
  return formatUsd(PLAN_LIMITS[tier].priceCents);
}

/** True when `tier` sits at or above `min` on the ladder. */
export function tierAtLeast(tier: TierKey, min: TierKey): boolean {
  return tierAtLeastBase(tier, min);
}

/* ============================================================
   Annual billing.

   A year costs ten months: two months free. The annual figure is a
   number in pricing.ts, not arithmetic, because it is a published price.
   ============================================================ */

export const ANNUAL_MONTHS_FREE = 2;

/** What a year costs, in cents. */
export function annualPriceCents(tier: TierKey): number {
  return PLAN_LIMITS[tier].annualPriceCents;
}

/** What they keep by paying yearly, in cents. */
export function annualSavingCents(tier: TierKey): number {
  return PLAN_LIMITS[tier].priceCents * 12 - annualPriceCents(tier);
}

/** The annual price expressed per month, which is how people compare it. */
export function annualPerMonthCents(tier: TierKey): number {
  return Math.round(annualPriceCents(tier) / 12);
}

/** Formatted price for an interval, e.g. "$149" or "$1,490". */
export function priceLabelFor(tier: TierKey, interval: BillingInterval): string {
  return formatUsd(interval === "year" ? annualPriceCents(tier) : PLAN_LIMITS[tier].priceCents);
}

/* ============================================================
   Early adopter pricing.

   Half price for the first 3 months, then the regular rate. One
   percentage, applied to the tier price, so a repricing can never leave
   an intro number quietly stale.

   MONTHLY ONLY, and that is deliberate. Stripe expresses a repeating
   discount in months, so a 3-month coupon against a yearly subscription
   lands on the first (and only) invoice of that year: half off twelve
   months instead of three. Annual billing already carries its own two
   free months.
   ============================================================ */

/** Stripe measures repeating discounts in months, so the window is
 *  expressed the same way. Three months is the ~90 day intro. */
export const EARLY_ADOPTER_MONTHS = 3;
export const EARLY_ADOPTER_DISCOUNT_PCT = 50;

/** Whether the launch offer is open. Flip to false to retire it without
 *  touching a price, a plan or a checkout path. */
export const EARLY_ADOPTER_OPEN = true;

/** Intro price per month, in cents. */
export function earlyAdopterPriceCents(tier: TierKey): number {
  const monthly = PLAN_LIMITS[tier].priceCents;
  if (!monthly) return 0;
  return Math.floor((monthly * (100 - EARLY_ADOPTER_DISCOUNT_PCT)) / 100);
}

/** True when this tier + interval can actually take the intro offer. */
export function earlyAdopterApplies(tier: TierKey, interval: BillingInterval): boolean {
  return (
    EARLY_ADOPTER_OPEN &&
    interval === "month" &&
    SELLABLE_TIERS.includes(tier) &&
    earlyAdopterPriceCents(tier) > 0
  );
}

/** "$74.50/mo for 3 months, then $149": the whole offer in one line,
 *  because quoting the intro without the step-up is how people feel
 *  tricked in month four. */
export function earlyAdopterLabel(tier: TierKey): string {
  const intro = earlyAdopterPriceCents(tier);
  const full = PLAN_LIMITS[tier].priceCents;
  if (!intro || !full) return "";
  return `${formatUsd(intro)}/mo for ${EARLY_ADOPTER_MONTHS} months, then ${formatUsd(full)}`;
}

/* ============================================================
   The starter price book, by name.

   convex/agencyPlans.ts lays these plans down and the agency console
   describes them before it does ("this rebuilds N plans..."), so the names
   are derived here rather than typed out in both places.
   ============================================================ */

/** The beta plan is the trial, and the default every sub-account starts on. */
export const BETA_PLAN_NAME = "Beta - free for a year";

/** Every plan a reset lays down, in the order it lays them down. */
export function starterPlanNames(): string[] {
  const names = [BETA_PLAN_NAME];
  for (const tier of SELLABLE_TIERS) {
    if (earlyAdopterApplies(tier, "month")) names.push(`${PLAN_LIMITS[tier].label} - Early Adopter`);
    names.push(PLAN_LIMITS[tier].label);
  }
  return names;
}

/** How long a beta licence runs by default. The org can override it
 *  (`orgs.betaMonths`), but this is the number the invite sheet quotes and
 *  the grant uses. */
export const BETA_DEFAULT_MONTHS = 12;

/** The tier a beta studio runs on until it graduates.

    Max, deliberately: a beta tester is being asked to evaluate the product,
    and evaluating it through a locked door is not an evaluation. They see
    everything, white label included, and pick the tier they actually want at
    the end. The entitlement comes from the beta flag (orgs.betaCohort without
    graduatedAt), see lib/tier.ts; graduation writes the real tier (which
    governs a standalone studio; one under an agency follows the agency plan). */
export const BETA_TIER: TierKey = "max";
