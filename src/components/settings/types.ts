import type { Id } from "@convex/_generated/dataModel";

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

/** Plan tiers - presentational billing config (no real Stripe). */
export const PLAN_TIERS: {
  value: OrgPlan;
  label: string;
  price: string;
  blurb: string;
  features: string[];
}[] = [
  {
    value: "solo",
    label: "Solo",
    price: "$49 / mo",
    blurb: "One engineer, one room. The essentials to run a personal studio.",
    features: [
      "1 team member",
      "Song catalog & sessions",
      "Up to 3 rooms / gear items",
      "Basic invoicing",
    ],
  },
  {
    value: "studio",
    label: "Studio",
    price: "$129 / mo",
    blurb: "A working studio with a small team and a full booking pipeline.",
    features: [
      "Up to 8 team members",
      "Unlimited rooms & gear",
      "Pipeline & client CRM",
      "Splits, deliverables & reports",
    ],
  },
  {
    value: "label",
    label: "Label",
    price: "$199 / mo",
    blurb: "A multi-room operation or imprint running many artists at once.",
    features: [
      "Unlimited team members",
      "Multi-room scheduling",
      "Roster & release campaigns",
      "Priority support & exports",
    ],
  },
];

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
