/* ============================================================
   Plan limits - single source of truth for what each tier gets.
   Used by createSubaccount, grants.issue, branding writes, usage
   metering, entitlements, and the billing webhook.

   Three public self-serve tiers:
     studio  $149.99  The money loop. Book it, deposit it, collect it.
     pro     $297.00  The whole operation. Staff, AI, reporting, catalog.
     label   $499.99  Fully unlocked + full white-label UI.

   `enterprise` is "contact us" (custom). `growth` and `agency` are
   LEGACY internal keys kept so existing workspaces keep resolving -
   neither is sold publicly (publicTier=false).

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

export type TierKey =
  | "flow"
  | "studio"
  | "pro"
  | "label"
  | "enterprise"
  | "growth"
  | "agency";

/** Every gateable capability in the app. Nav-surface keys mirror
 *  src/lib/features.ts FeatureKey; the rest gate behaviour, not routes. */
export type CapabilityKey =
  // ── nav surfaces ──
  | "agent"
  | "songs"
  | "clients"
  | "pipeline"
  | "inbox"
  | "calendar"
  | "schedule"
  | "visitors"
  | "bookings"
  | "payments"
  | "reports"
  | "releases"
  | "licensing"
  | "studio"
  | "inventory"
  | "patch"
  | "software"
  // ── behaviours ──
  | "cardOnFile"
  | "noShowShield"
  | "dunning"
  | "clientPortal"
  | "smsFlows"
  | "reviewsReferrals"
  | "discountCodes"
  | "calendarSync"
  | "timeClock"
  | "payroll"
  | "packages"
  | "memberships"
  | "expenses"
  | "profitability"
  | "rentals"
  | "maintenance"
  | "splitSheets"
  | "aiReceptionist"
  | "aiAutonomy"
  | "apiExports"
  | "customDomain"
  | "whiteLabelUi"
  | "multiStudio"
  | "marketing";

export type WhitelabelLevel = false | "studio_level" | "full";

export type TierLimits = {
  /** Customer-facing name. */
  label: string;
  tagline: string;
  /** One line for the pricing page, in the studio owner's language. */
  pitch: string;
  /** Shown on the pricing page / onboard picker. */
  publicTier: boolean;
  /** "Contact us" instead of self-serve checkout. */
  custom: boolean;
  /** Display order on the pricing page. */
  order: number;
  subAccountCap: number;
  magicLinkGrantsPerMonth: number;
  whitelabel: WhitelabelLevel;
  customDomain: boolean;
  /** Monthly included AI credits (usage metering). */
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
  /** Monthly USD price in cents. 0 = custom/contact, or free. */
  priceCents: number;
  /**
   * Payments-monetized plans carry no monthly fee and earn on a take rate of
   * what the studio collects through Pulse instead. Basis points of the
   * transaction; null means the plan is a straight subscription.
   */
  takeRateBps?: number;
  /** True when the plan requires payments to run through Pulse to exist. */
  paymentsRequired?: true;
  /** Everything this tier can reach. Enforced by lib/entitlements.ts. */
  capabilities: CapabilityKey[];
};

const UNLIMITED = 999_999;

/* ── Capability bundles. Each tier is the previous one plus its own adds,
      so a capability can never be present at a lower tier and absent above. ── */

/** $149.99 - the money loop, end to end. Nothing here is crippled: a solo
 *  operator can take a booking, hold a card, keep a deposit and get paid. */
const STUDIO_CAPS: CapabilityKey[] = [
  "bookings",
  "calendar",
  "payments",
  "clients",
  "studio",
  "cardOnFile",
  "noShowShield",
  "dunning",
  "clientPortal",
  "smsFlows",
  "reviewsReferrals",
  "discountCodes",
  "marketing",
];

/** $297 - everything a staffed studio needs to run the floor and the books. */
const PRO_ADDS: CapabilityKey[] = [
  "agent",
  "inbox",
  "schedule",
  "reports",
  "pipeline",
  "songs",
  "visitors",
  "inventory",
  "calendarSync",
  "timeClock",
  "payroll",
  "packages",
  "memberships",
  "expenses",
  "profitability",
  "rentals",
  "maintenance",
  "aiReceptionist",
];

/** $499.99 - the rest of the catalog, plus the studio's own skin on the app. */
const LABEL_ADDS: CapabilityKey[] = [
  "releases",
  "licensing",
  "patch",
  "software",
  "splitSheets",
  "aiAutonomy",
  "apiExports",
  "customDomain",
  "whiteLabelUi",
  "multiStudio",
];

/** Flow is the money loop and nothing else: take a booking, hold the card,
 *  collect the money. No referral loop, no promo codes, no portal extras -
 *  those are what Studio is for. */
const FLOW_CAPS: CapabilityKey[] = [
  "bookings", "calendar", "payments", "clients", "studio",
  "cardOnFile", "noShowShield", "dunning",
];

const PRO_CAPS: CapabilityKey[] = [...STUDIO_CAPS, ...PRO_ADDS];
const LABEL_CAPS: CapabilityKey[] = [...PRO_CAPS, ...LABEL_ADDS];

/** The "Powered by Pulse" lockup is a condition of the white-label tier, not
 *  a feature flag. Nothing in the product may remove it. */
export const POWERED_BY_PULSE_REQUIRED = true;

export const PLAN_LIMITS: Record<TierKey, TierLimits> = {
  // ── Payments-monetized entry plan ──
  //    No monthly fee. Pulse earns a take rate on what the studio actually
  //    collects through it, so the tool costs nothing on a quiet month and
  //    grows with the studio rather than against it. It is the answer to
  //    "Google Calendar is free": so is this, until it makes you money.
  //    Deliberately capped at the money loop - the moment a studio needs
  //    staff, AI or reporting, Studio Pro is the upgrade.
  // ── PARKED, not sold ──
  //    Built but deliberately not public. It contradicts the founding
  //    payments principle (Grilled.md, 2026-05-24): "each studio connects its
  //    OWN Stripe and gets paid directly; Pulse facilitates, NOT
  //    platform-collected". The code path stays so it can be switched on
  //    after a deliberate decision and a test with one studio.
  //
  //    To sell it: set publicTier true, and first close the two gaps noted on
  //    takeRateBps below.
  flow: {
    label: "Flow",
    tagline: "No monthly fee. Pulse earns when you get paid.",
    pitch: "Free to run. We take 2% of what you collect through Pulse, and nothing else.",
    publicTier: false,
    custom: false,
    order: 0,
    subAccountCap: 1,
    magicLinkGrantsPerMonth: 10,
    whitelabel: false,
    customDomain: false,
    aiCreditsPerMonth: 25,
    storageGb: 5,
    roomCap: 1,
    staffCap: 2,
    socialAccountCap: 3,
    socialPostsPerMonth: 20,
    priceCents: 0,
    // 2.00%. TWO GAPS to close before this is ever sold:
    //  1. Only the deposit checkout charges it. Invoices, memberships,
    //     no-show fees and packages do not, so the "2% of what you collect"
    //     claim is not yet true.
    //  2. There is no cap, so a studio collecting $50k/mo would pay $1,000 -
    //     twice the top subscription plan.
    takeRateBps: 200,
    paymentsRequired: true,
    capabilities: FLOW_CAPS,
  },
  studio: {
    label: "Studio",
    tagline: "Solo operators and one or two room studios.",
    pitch: "Get the room booked, hold the card, collect the money.",
    publicTier: true,
    custom: false,
    order: 1,
    subAccountCap: 1,
    magicLinkGrantsPerMonth: 15,
    whitelabel: false,
    customDomain: false,
    aiCreditsPerMonth: 100,
    storageGb: 10,
    roomCap: 2,
    staffCap: 3,
    socialAccountCap: 3,
    socialPostsPerMonth: 20,
    priceCents: 14999,
    capabilities: STUDIO_CAPS,
  },
  pro: {
    label: "Studio Pro",
    tagline: "Staffed studios running a full weekly schedule.",
    pitch: "Run the whole floor: staff, payroll, AI ops, real numbers.",
    publicTier: true,
    custom: false,
    order: 2,
    subAccountCap: 1,
    magicLinkGrantsPerMonth: 50,
    whitelabel: "studio_level",
    customDomain: false,
    aiCreditsPerMonth: 1_000,
    storageGb: 100,
    roomCap: 6,
    staffCap: 15,
    socialAccountCap: UNLIMITED,
    socialPostsPerMonth: UNLIMITED,
    priceCents: 29700,
    capabilities: PRO_CAPS,
  },
  label: {
    label: "Label",
    tagline: "Labels, studio groups, and anyone who wants their own brand on it.",
    pitch: "Everything unlocked, wearing your brand instead of ours.",
    publicTier: true,
    custom: false,
    order: 3,
    subAccountCap: 5,
    magicLinkGrantsPerMonth: UNLIMITED,
    whitelabel: "full",
    customDomain: true,
    aiCreditsPerMonth: 5_000,
    storageGb: 1_000,
    roomCap: UNLIMITED,
    staffCap: UNLIMITED,
    socialAccountCap: UNLIMITED,
    socialPostsPerMonth: UNLIMITED,
    priceCents: 49999,
    capabilities: LABEL_CAPS,
  },
  enterprise: {
    label: "Enterprise",
    tagline: "Schools, studio networks, and larger music organizations.",
    pitch: "Custom scale, custom terms.",
    publicTier: true,
    custom: true,
    order: 4,
    subAccountCap: 25,
    magicLinkGrantsPerMonth: UNLIMITED,
    whitelabel: "full",
    customDomain: true,
    aiCreditsPerMonth: UNLIMITED,
    storageGb: 2_000,
    roomCap: UNLIMITED,
    staffCap: UNLIMITED,
    socialAccountCap: UNLIMITED,
    socialPostsPerMonth: UNLIMITED,
    priceCents: 0,
    capabilities: LABEL_CAPS,
  },
  // ── Legacy internal tiers. Not sold publicly; kept so existing rows resolve. ──
  growth: {
    label: "Studio Growth (legacy)",
    tagline: "Superseded by Label.",
    pitch: "Legacy plan.",
    publicTier: false,
    custom: false,
    order: 90,
    subAccountCap: 3,
    magicLinkGrantsPerMonth: 100,
    whitelabel: "studio_level",
    customDomain: true,
    aiCreditsPerMonth: 2_000,
    storageGb: 250,
    roomCap: UNLIMITED,
    staffCap: UNLIMITED,
    socialAccountCap: UNLIMITED,
    socialPostsPerMonth: UNLIMITED,
    priceCents: 19900,
    capabilities: PRO_CAPS,
  },
  agency: {
    label: "Agency (legacy)",
    tagline: "Multi-studio operators on the original agency plan.",
    pitch: "Legacy plan.",
    publicTier: false,
    custom: false,
    order: 91,
    subAccountCap: UNLIMITED,
    magicLinkGrantsPerMonth: UNLIMITED,
    whitelabel: "full",
    customDomain: true,
    aiCreditsPerMonth: UNLIMITED,
    storageGb: 2_000,
    roomCap: UNLIMITED,
    staffCap: UNLIMITED,
    socialAccountCap: UNLIMITED,
    socialPostsPerMonth: UNLIMITED,
    priceCents: 24900,
    capabilities: LABEL_CAPS,
  },
};

export function limitsFor(tier: TierKey): TierLimits {
  return PLAN_LIMITS[tier];
}

/** Public self-serve tiers in display order. */
export const PUBLIC_TIERS: TierKey[] = (
  Object.keys(PLAN_LIMITS) as TierKey[]
)
  .filter((k) => PLAN_LIMITS[k].publicTier)
  .sort((a, b) => PLAN_LIMITS[a].order - PLAN_LIMITS[b].order);

/** The three tiers we actually sell, cheapest first. */
/** The tiers we actually sell, cheapest first. Flow is built but parked
 *  (publicTier false), so it is deliberately absent here. */
export const SELLABLE_TIERS: TierKey[] = ["studio", "pro", "label"];

/** Formatted price, e.g. "$149.99". A payments-monetized plan prices in its
 *  take rate instead, and a custom tier has no price to show. */
export function priceLabel(tier: TierKey): string {
  const p = PLAN_LIMITS[tier];
  if (p.takeRateBps) return `${(p.takeRateBps / 100).toFixed(p.takeRateBps % 100 ? 2 : 0)}% of collections`;
  if (!p.priceCents) return "";
  return `$${(p.priceCents / 100).toFixed(2)}`;
}

/** What Pulse takes from a collected amount on this plan, in cents. */
export function takeCents(tier: TierKey, collectedCents: number): number {
  const bps = PLAN_LIMITS[tier].takeRateBps;
  if (!bps) return 0;
  return Math.round((collectedCents * bps) / 10_000);
}

/**
 * The month where a subscription becomes cheaper than the take rate.
 *
 * Answers the only question a studio actually asks about this plan: at what
 * point am I better off paying the monthly fee? Returned in cents collected.
 */
export function breakEvenCollectionsCents(from: TierKey, to: TierKey): number | null {
  const bps = PLAN_LIMITS[from].takeRateBps;
  const monthly = PLAN_LIMITS[to].priceCents;
  if (!bps || !monthly) return null;
  return Math.round((monthly * 10_000) / bps);
}

/** True when `tier` sits at or above `min` in the sellable ladder. Legacy and
 *  enterprise tiers are treated as top-of-ladder. */
export function tierAtLeast(tier: TierKey, min: TierKey): boolean {
  const rank = (t: TierKey) => {
    const i = SELLABLE_TIERS.indexOf(t);
    return i === -1 ? SELLABLE_TIERS.length : i;
  };
  return rank(tier) >= rank(min);
}


/* ============================================================
   Annual billing.

   Paying for a year up front earns 15% off. Kept as arithmetic on the
   monthly price rather than a second hand-maintained number, so a
   repricing can never leave the annual figure quietly stale.
   ============================================================ */

export const ANNUAL_DISCOUNT_PCT = 15;

/** What a year costs, in cents, with the discount applied. */
export function annualPriceCents(tier: TierKey): number {
  const monthly = PLAN_LIMITS[tier].priceCents;
  if (!monthly) return 0;
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT_PCT / 100));
}

/** What they keep by paying yearly, in cents. */
export function annualSavingCents(tier: TierKey): number {
  const monthly = PLAN_LIMITS[tier].priceCents;
  if (!monthly) return 0;
  return monthly * 12 - annualPriceCents(tier);
}

/** The annual price expressed per month, which is how people compare it. */
export function annualPerMonthCents(tier: TierKey): number {
  const annual = annualPriceCents(tier);
  return annual ? Math.round(annual / 12) : 0;
}

export type BillingInterval = "month" | "year";

/** Formatted price for an interval, e.g. "$149.99" or "$1,529.90". */
export function priceLabelFor(tier: TierKey, interval: BillingInterval): string {
  const cents = interval === "year" ? annualPriceCents(tier) : PLAN_LIMITS[tier].priceCents;
  if (!cents) return priceLabel(tier);
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
}

/* ============================================================
   Early adopter pricing.

   Half price for the first 3 months, then the regular rate. One
   percentage, applied to the tier price, so a repricing can never leave
   an intro number quietly stale:

     Studio      $74.99  ->  $149.99
     Studio Pro  $148.50 ->  $297.00
     Label       $249.99 ->  $499.99

   MONTHLY ONLY, and that is deliberate. Stripe expresses a repeating
   discount in months, so a 3-month coupon against a yearly subscription
   lands on the first (and only) invoice of that year - half off twelve
   months instead of three. Annual billing already carries its own 15%,
   which is the better deal anyway.
   ============================================================ */

/** Stripe measures repeating discounts in months, so the window is
 *  expressed the same way. Three months is the ~90 day intro. */
export const EARLY_ADOPTER_MONTHS = 3;
export const EARLY_ADOPTER_DISCOUNT_PCT = 50;

/** Whether the launch offer is open. Flip to false to retire it without
 *  touching a price, a plan or a checkout path. */
export const EARLY_ADOPTER_OPEN = true;

/** Intro price per month, in cents. Floor keeps the familiar .99 endings
 *  ($149.99 -> $74.99) rather than rounding up to a whole dollar. */
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

/** "$74.99/mo for 3 months, then $149.99" - the whole offer in one line,
 *  because quoting the intro without the step-up is how people feel
 *  tricked in month four. */
export function earlyAdopterLabel(tier: TierKey): string {
  const intro = earlyAdopterPriceCents(tier);
  const full = PLAN_LIMITS[tier].priceCents;
  if (!intro || !full) return "";
  const fmt = (c: number) =>
    `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${fmt(intro)}/mo for ${EARLY_ADOPTER_MONTHS} months, then ${fmt(full)}`;
}

/* ============================================================
   The starter price book, by name.

   convex/agencyPlans.ts lays these plans down and the agency console
   describes them before it does ("this rebuilds N plans..."), so the names
   are derived here rather than typed out in both places - the console spent
   months promising a reset to "Free Forever, 30 Day Free and 1 Year Free",
   plans the seeder had stopped creating.
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

/** The tier a beta studio runs on.

    Label, deliberately: a beta tester is being asked to evaluate the product,
    and evaluating it through a locked door is not an evaluation. They see
    everything, white label included, and pick the tier they actually want at
    the end of the year. */
export const BETA_TIER: TierKey = "label";
