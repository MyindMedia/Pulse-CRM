import type { Id } from "@convex/_generated/dataModel";
import { priceLabel, type TierKey } from "@convex/lib/plans";
import { PRICING, TIERS } from "@convex/lib/pricing";

/* Shared Settings module types and config. */

/** The workspace's plan: core | growth | max (convex/lib/pricing.ts). */
export type OrgPlan = TierKey;

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
  /** Effective plan, resolved server-side (beta flag, own tier, agency). */
  tier: OrgPlan;
  tierLabel: string;
  status: string;
  accentColor: string;
  timezone: string | null;
  briefRequireAll: boolean;
  /** Booking page: show the room's gear list to clients. */
  showGearOnBooking: boolean;
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
  managersSeeMoney: boolean;
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

   Names, prices and copy all come from convex/lib/pricing.ts, so this
   list can never sell a ladder the product stopped charging.
   ============================================================ */

const PLAN_FEATURES: Record<OrgPlan, string[]> = {
  core: [
    "Online booking with deposits",
    "Clients, bills, payments and reminders",
    "Card on file and no-show protection",
    "Google Calendar both ways and your own Gmail",
  ],
  growth: [
    "Everything in Core",
    "Staff scheduling, time clock and payroll",
    "Gear list, cable map and software subscriptions",
    "The assistant",
  ],
  max: [
    "Everything in Growth",
    "Unlimited studios, one flat price",
    "Releases, licensing and split sheets",
    "Your brand on the whole app and your own web address",
  ],
};

export const PLAN_TIERS: {
  value: OrgPlan;
  label: string;
  price: string;
  blurb: string;
  features: string[];
}[] = TIERS.map((value) => ({
  value,
  label: PRICING[value].name,
  price: `${priceLabel(value)} / mo`,
  blurb: PRICING[value].tagline,
  features: PLAN_FEATURES[value],
}));
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
