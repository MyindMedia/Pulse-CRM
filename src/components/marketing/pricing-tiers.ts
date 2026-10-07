import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  EARLY_ADOPTER_MONTHS,
  earlyAdopterApplies,
  earlyAdopterPriceCents,
  type TierKey,
} from "@convex/lib/plans";
import { formatUsd } from "@convex/lib/pricing";

/* ============================================================
   The public price tiles, DERIVED from convex/lib/pricing.ts (through
   PLAN_LIMITS in convex/lib/plans.ts).

   Name, price, tagline, checkout tier and the launch offer all come from
   the pricing config, and pricing-tiers.test.ts asserts it. The only thing
   written by hand here is the sales copy.
   ============================================================ */

/** Sales bullets per tier. Copy, not configuration: the numbers that back
 *  them (rooms, studios, storage) live in convex/lib/pricing.ts. */
const HIGHLIGHTS: Record<TierKey, string[]> = {
  core: [
    "Online booking with deposits",
    "Card on file and no-show protection",
    "Clients, bills, payments and reminders",
    "Google Calendar both ways and your own Gmail",
    "Money to your own Stripe, no cut",
  ],
  growth: [
    "Everything in Core",
    "Staff scheduling, time clock and payroll",
    "Gear list, cable map and software subscriptions",
    "Packages, memberships and expenses",
    "The assistant",
  ],
  max: [
    "Everything in Growth",
    "Unlimited studios, one flat price",
    "Releases, licensing and split sheets",
    "One screen above every studio",
    "Your brand on the app, your own web address",
  ],
};

/* ============================================================
   The self-serve switch.

   Everything behind the tiles is live and tested: Stripe Checkout for all
   three tiers, the launch-offer coupon, and the Clerk allowlist step a buyer
   needs before they can create their login. The only thing left is deciding
   when the public sees prices - flip this to true and the pricing section and
   its nav link appear on the landing page.
   ============================================================ */
export const PRICING_LIVE = false;

/** The tile the eye should land on. Middle of a three-rung ladder. */
const FEATURED: TierKey = "growth";

function money(cents: number): string {
  return formatUsd(cents);
}

export type MarketingTier = {
  /** The TierKey checkout is started with. */
  tier: TierKey;
  name: string;
  tagline: string;
  /** Headline price - the intro price while the launch offer is open. */
  price: string;
  cadence: string;
  /** "then $149/mo from month 4" - present only on an intro price, because
   *  quoting the offer without the step-up is how people feel tricked. */
  stepUp: string | null;
  /** Badge copy for the launch offer, or null when it is closed. */
  introBadge: string | null;
  features: string[];
  featured: boolean;
  cta: string;
};

/** The public price book as the landing page renders it, cheapest first. */
export function marketingTiers(): MarketingTier[] {
  return SELLABLE_TIERS.map((tier) => {
    const limits = PLAN_LIMITS[tier];
    const intro = earlyAdopterApplies(tier, "month");
    const introCents = earlyAdopterPriceCents(tier);
    return {
      tier,
      name: limits.label,
      tagline: limits.tagline,
      price: intro ? money(introCents) : money(limits.priceCents),
      cadence: "/mo",
      stepUp: intro
        ? `then ${money(limits.priceCents)}/mo from month ${EARLY_ADOPTER_MONTHS + 1}`
        : null,
      introBadge: intro ? `First ${EARLY_ADOPTER_MONTHS} months half price` : null,
      features: HIGHLIGHTS[tier],
      featured: tier === FEATURED,
      cta: "Subscribe",
    };
  });
}

/** "From $74.50/mo" - the entry price for metadata and share cards, so the
 *  number a search result promises is the number the page shows. */
export function fromPriceLabel(): string {
  const entry = SELLABLE_TIERS[0];
  const cents = earlyAdopterApplies(entry, "month")
    ? earlyAdopterPriceCents(entry)
    : PLAN_LIMITS[entry].priceCents;
  return `From ${money(cents)}/mo`;
}
