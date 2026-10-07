import {
  ALL_TIER_TERMS,
  ALLOWANCES,
  PRICING,
  PULSE_APP_CAPABILITIES,
  TIERS,
  TIER_ACCESS,
  UNLIMITED,
  formatUsd,
  publicFeatureGroups,
  tierAtLeast,
  type TierKey,
} from "@convex/lib/pricing";
import {
  ANNUAL_MONTHS_FREE,
  BETA_DEFAULT_MONTHS,
  EARLY_ADOPTER_DISCOUNT_PCT,
  EARLY_ADOPTER_MONTHS,
  annualSavingCents,
  earlyAdopterApplies,
  earlyAdopterPriceCents,
} from "@convex/lib/plans";

/* ============================================================
   Everything /pricing shows, as plain data. Read from
   convex/lib/pricing.ts and nothing else, so the page renders from the
   config and the tests can check it without a browser.

   Customer-safe by construction: no sales notes, no "how to tell on a
   call", no rival names, nothing that is not built.
   ============================================================ */

/* Lawrence flips this to true after the per-studio R2 buckets are
   provisioned in production and the move dry run reports zero files left
   (docs/R2-PER-ORG-BUCKETS.md, "What Lawrence must do"). Until then the
   infrastructure line is NOT rendered anywhere, because it is not yet true
   in production. */
export const R2_PER_ORG_LIVE = true;

export const R2_LINE =
  "Every file and every version is stored on Cloudflare R2, in a bucket of your own.";

/** The primary call to action on the page (existing route: the booking
 *  calendar for a demo). */
export const DEMO_HREF = "/demo";

/* The feature names on the internal sheet are written about the studio
   ("their"). The public table speaks to the studio ("your"). Joined by
   exact name, so a renamed feature falls back to its config name. */
const PUBLIC_NAME: Record<string, string> = {
  "Their own card-payment account": "Your own card-payment account",
  "Their brand inside the app": "Your brand inside the app",
  "The app looks like theirs": "The app looks like yours",
  "Their own login screen": "Your own login screen",
  "Emails in their colors": "Emails in your colors",
  "Their own web address": "Your own web address",
  "Fake data for a pitch": "Sample data for a demo",
  // The count changes every release; the public line states the fact only.
  "955 automatic checks": "Automatic checks on money, privacy and plans",
};

const PUBLIC_GROUP_TITLE: Record<string, string> = {
  "Making it look like theirs": "Making it look like yours",
};

export function publicName(name: string): string {
  return PUBLIC_NAME[name] ?? name;
}

export type PlanCard = {
  tier: TierKey;
  name: string;
  tagline: string;
  who: string;
  gets: string;
  access: readonly string[];
  monthly: { price: string; cents: number };
  annual: { price: string; cents: number; saves: string; monthsFree: number };
  /** Launch offer line for monthly billing, or null when closed. */
  launchOffer: string | null;
  unlimitedStudios: boolean;
  highlight: boolean;
  includesLabel: string | null;
};

export function planCards(): PlanCard[] {
  return TIERS.map((t, i) => {
    const p = PRICING[t];
    return {
      tier: t,
      name: p.name,
      tagline: p.tagline,
      who: p.who,
      gets: p.gets,
      access: TIER_ACCESS[t],
      monthly: { price: formatUsd(p.monthlyCents), cents: p.monthlyCents },
      annual: {
        price: formatUsd(p.annualCents),
        cents: p.annualCents,
        saves: formatUsd(annualSavingCents(t)),
        monthsFree: ANNUAL_MONTHS_FREE,
      },
      launchOffer: earlyAdopterApplies(t, "month")
        ? `Launch offer: ${formatUsd(earlyAdopterPriceCents(t))} a month for your first ${EARLY_ADOPTER_MONTHS} months on monthly billing.`
        : null,
      unlimitedStudios: p.unlimitedStudios,
      highlight: p.highlight,
      includesLabel: i === 0 ? null : `Everything in ${PRICING[TIERS[i - 1]].name}, plus`,
    };
  });
}

export type ComparisonRow = { name: string; tier: TierKey; included: Record<TierKey, boolean> };
export type ComparisonGroup = { id: string; title: string; rows: ComparisonRow[] };

/** The customer comparison table: the 14 groups, plus the production group
 *  once any of its features is built. Only built features, by construction
 *  of publicFeatureGroups(). */
export function comparisonGroups(): ComparisonGroup[] {
  return publicFeatureGroups().map((g) => ({
    id: g.id,
    title: PUBLIC_GROUP_TITLE[g.title] ?? g.title,
    rows: g.items.map((x) => ({
      name: publicName(x.name),
      tier: x.tier,
      included: Object.fromEntries(TIERS.map((t) => [t, tierAtLeast(t, x.tier)])) as Record<
        TierKey,
        boolean
      >,
    })),
  }));
}

export type AppTier = { tier: TierKey; name: string; lead: string | null; items: readonly string[] };

/** What the Pulse iPhone app does on each plan, each adding to the last. */
export function appTiers(): AppTier[] {
  return TIERS.map((t, i) => ({
    tier: t,
    name: PRICING[t].name,
    lead: i === 0 ? null : `Everything in ${PRICING[TIERS[i - 1]].name}, plus`,
    items: PULSE_APP_CAPABILITIES[t],
  }));
}

export type Faq = { q: string; a: string };

export function faqs(): Faq[] {
  const staff = TIERS.map((t) => {
    const n = ALLOWANCES[t].staff;
    return `${n >= UNLIMITED ? "unlimited" : n} on ${PRICING[t].name}`;
  }).join(", ");
  const max = PRICING.max;
  const out: Faq[] = [
    {
      q: "Is there a contract?",
      a: `No. Every plan is month to month and you can cancel any month. Paying yearly is optional and gives you ${ANNUAL_MONTHS_FREE} months free.`,
    },
    {
      q: "How do we move over from what we use now?",
      a: "We move your data for free, and you are running within a day. You can start taking bookings before setup is finished.",
    },
    {
      q: "Where do card payments go? Do you take a cut?",
      a: "Card payments go straight to your own Stripe account and Stripe pays them out to your bank. Pulse never holds your money and takes no booking commission.",
    },
    {
      q: "Do you charge per seat or per login?",
      a: `No. There are no per-seat fees. Plans are priced by features, and each one includes team logins (${staff}) plus unlimited guest passes at no extra cost.`,
    },
    {
      q: "How does Max work with more than one studio?",
      a: `Max includes unlimited studios at one flat price of ${formatUsd(max.monthlyCents)} a month, or ${formatUsd(max.annualCents)} a year. There is no per-studio charge, allowances are shared across all your studios, and each studio only ever sees its own records.`,
    },
    {
      q: "What happens to my beta access?",
      a: `Studios in the beta keep full access, with everything on Max switched on, until their beta ends (${BETA_DEFAULT_MONTHS} months unless your invite said otherwise). Then you pick the plan that fits how your studio works. Book a demo any time to talk it through.`,
    },
  ];
  if (TIERS.some((t) => earlyAdopterApplies(t, "month"))) {
    out.push({
      q: "Is there a launch offer?",
      a: `Yes. Monthly plans are ${EARLY_ADOPTER_DISCOUNT_PCT}% off for your first ${EARLY_ADOPTER_MONTHS} months, then the regular monthly price. Yearly billing already includes ${ANNUAL_MONTHS_FREE} months free, so the launch offer applies to monthly billing only.`,
    });
  }
  if (R2_PER_ORG_LIVE) {
    out.push({ q: "Where are our files stored?", a: R2_LINE });
  }
  return out;
}

/** "Growth includes everything in Core. Max includes everything in Growth." */
export function includesLine(): string {
  return TIERS.slice(1)
    .map((t, i) => `${PRICING[t].name} includes everything in ${PRICING[TIERS[i]].name}.`)
    .join(" ");
}

/** The three promises that hold on every plan. */
export const TERMS = ALL_TIER_TERMS;
