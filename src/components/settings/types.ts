import type { Id } from "@convex/_generated/dataModel";
import { PLAN_LIMITS, priceLabel, type TierKey } from "@convex/lib/plans";

/* Shared Settings module types and config. */

export type OrgPlan = "solo" | "studio" | "label";

export type ServicePricing = {
  recording?: number;
  mixing?: number;
  mastering?: number;
  production?: number;
  consultation?: number;
  rehearsal?: number;
  writing?: number;
};

export type DiscountCode = {
  code: string;
  pct: number;
  label?: string;
  active: boolean;
};

export type Testimonial = {
  author: string;
  role?: string;
  quote: string;
  rating?: number;
};

export type Org = {
  orgId: Id<"orgs">;
  actor: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  status: string;
  accentColor: string;
  timezone: string | null;
  briefRequireAll: boolean;
  tagline: string;
  logoUrl: string | null;
  bookingHeroUrl: string | null;
  bookingHeadline: string | null;
  bookingIntro: string | null;
  depositPolicyText: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  contactPhone: string | null;
  configured: boolean;
  servicePricing: ServicePricing | null;
  discountCodes: DiscountCode[];
  testimonials: Testimonial[];
  defaultRateCutPct: number | null;
  taxState: string | null;
  taxRate: number | null;
  taxApply: boolean;
  aiReceptionistEnabled: boolean;
};

/** Service keys mirror sessions.serviceType. */
export const SERVICES: { key: keyof ServicePricing; label: string }[] = [
  { key: "recording", label: "Recording" },
  { key: "mixing", label: "Mixing" },
  { key: "mastering", label: "Mastering" },
  { key: "production", label: "Production" },
  { key: "writing", label: "Writing" },
  { key: "consultation", label: "Consultation" },
  { key: "rehearsal", label: "Rehearsal" },
];

/* ============================================================
   Plan tiers shown in Settings -> Billing.

   `OrgPlan` is the legacy three-value field stored on the org; the ladder
   it names lives in PLAN_LIMITS. Both prices and names are derived, because
   the hand-typed copy that used to sit here was still selling
   "Solo $49 / Studio $129 / Label $199" months after the real ladder became
   Studio $149.99 / Studio Pro $297 / Label $499.99.
   ============================================================ */

/** Legacy org plan value -> the tier in the real ladder it stands for. */
export const ORG_PLAN_TIER: Record<OrgPlan, TierKey> = {
  solo: "studio",
  studio: "pro",
  label: "label",
};

/** Blurb + inclusions are sales copy; the caps behind them are in PLAN_LIMITS. */
const PLAN_COPY: Record<OrgPlan, { blurb: string; features: string[] }> = {
  solo: {
    blurb: "One engineer, one room. The money loop: book it, hold the card, get paid.",
    features: [
      "Online booking with deposits",
      "Client CRM and pipeline",
      "Invoices, payments and dunning",
      "Card on file and no-show protection",
    ],
  },
  studio: {
    blurb: "A working studio with a team, a full weekly schedule and real numbers.",
    features: [
      "Everything in Studio",
      "Staff scheduling, time clock and payroll",
      "Inventory, rentals and maintenance",
      "The AI studio manager",
    ],
  },
  label: {
    blurb: "A multi-room operation or imprint, running on its own brand.",
    features: [
      "Everything in Studio Pro",
      "Multi-studio dashboard and reporting",
      "Releases, licensing and split sheets",
      "White-label UI and custom domain",
    ],
  },
};

export const PLAN_TIERS: {
  value: OrgPlan;
  label: string;
  price: string;
  blurb: string;
  features: string[];
}[] = (Object.keys(PLAN_COPY) as OrgPlan[]).map((value) => {
  const tier = ORG_PLAN_TIER[value];
  return {
    value,
    label: PLAN_LIMITS[tier].label,
    price: `${priceLabel(tier)} / mo`,
    blurb: PLAN_COPY[value].blurb,
    features: PLAN_COPY[value].features,
  };
});

/** Curated accent swatches - warm golds first (the house band), then a
 *  spectrum sweep. All sit in the UI-friendly mid-lightness range the
 *  theming engine expects; the full-spectrum picker covers everything else. */
export const ACCENT_SWATCHES: { value: string; label: string }[] = [
  { value: "#E0A226", label: "Studio gold" },
  { value: "#F4C84A", label: "Bright gold" },
  { value: "#C8861A", label: "Deep amber" },
  { value: "#B45A2B", label: "Copper" },
  { value: "#D9603A", label: "Burnt orange" },
  { value: "#E8842D", label: "Tangerine" },
  { value: "#B33939", label: "Brick red" },
  { value: "#C24A6B", label: "Crimson" },
  { value: "#E2557B", label: "Rose" },
  { value: "#B06AB3", label: "Orchid" },
  { value: "#9B6BC8", label: "Violet" },
  { value: "#7C4DD4", label: "Electric violet" },
  { value: "#6D7FE0", label: "Periwinkle" },
  { value: "#3E63C4", label: "Royal blue" },
  { value: "#4A8DB5", label: "Console blue" },
  { value: "#4FB9D8", label: "Sky" },
  { value: "#3BAFA8", label: "Teal" },
  { value: "#2F8F6B", label: "Emerald" },
  { value: "#5BA678", label: "Reel green" },
  { value: "#7BA05B", label: "Olive" },
];
