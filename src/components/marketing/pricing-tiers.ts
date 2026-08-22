import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  EARLY_ADOPTER_MONTHS,
  earlyAdopterApplies,
  earlyAdopterPriceCents,
  type TierKey,
} from "@convex/lib/plans";

/* ============================================================
   The public price tiles, DERIVED from convex/lib/plans.ts.

   These used to be hand-typed here - name, price and checkout tier all
   written out by hand - and every one of the three was wrong by the time
   anyone looked: $49/$129/$199 against "Solo / Studio / Label" while the
   product sold $149.99/$297/$499.99 as "Studio / Studio Pro / Label". The
   worst of it was the checkout tier: the top tile subscribed people to
   `growth`, a LEGACY tier that is not sold any more and grants less than
   the Label it was advertising.

   So the only thing written by hand now is the sales copy. Name, price,
   tagline, checkout tier and the launch offer all come from PLAN_LIMITS,
   and pricing-tiers.test.ts asserts it.
   ============================================================ */

/** Sales bullets per tier. Copy, not configuration - the numbers that back
 *  them (room caps, seats) live in PLAN_LIMITS. */
const HIGHLIGHTS: Record<string, string[]> = {
  studio: [
    "Online booking with deposits",
    "Card on file and no-show protection",
    "Client CRM and pipeline",
    "Invoices, payments and dunning",
    "Money to your own Stripe, no cut",
  ],
  pro: [
    "Everything in Studio",
    "Staff scheduling, time clock and payroll",
    "Inventory, rentals and maintenance",
    "Packages, memberships and expenses",
    "The AI studio manager",
  ],
  label: [
    "Everything in Studio Pro",
    "Multi-studio dashboard and reporting",
    "Releases, licensing and split sheets",
    "Patchbay, I/O and software licences",
    "Your brand on the app, your own domain",
  ],
};

/** The tile the eye should land on. Middle of a three-rung ladder. */
const FEATURED: TierKey = "pro";

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export type MarketingTier = {
  /** The TierKey checkout is started with. */
  tier: TierKey;
  name: string;
  tagline: string;
  /** Headline price - the intro price while the launch offer is open. */
  price: string;
  cadence: string;
  /** "then $149.99/mo from month 4" - present only on an intro price, because
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
      features: HIGHLIGHTS[tier] ?? [],
      featured: tier === FEATURED,
      cta: "Subscribe",
    };
  });
}

/** "From $74.99/mo" - the entry price for metadata and share cards, so the
 *  number a search result promises is the number the page shows. */
export function fromPriceLabel(): string {
  const entry = SELLABLE_TIERS[0];
  const cents = earlyAdopterApplies(entry, "month")
    ? earlyAdopterPriceCents(entry)
    : PLAN_LIMITS[entry].priceCents;
  return `From ${money(cents)}/mo`;
}
