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

export type Org = {
  orgId: Id<"orgs">;
  actor: string;
  name: string;
  slug: string;
  plan: OrgPlan;
  status: string;
  accentColor: string;
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
  defaultRateCutPct: number | null;
  taxState: string | null;
  taxRate: number | null;
  taxApply: boolean;
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

/** A short curated set of accent colors from the brand gold band. */
export const ACCENT_SWATCHES: { value: string; label: string }[] = [
  { value: "#E0A226", label: "Studio gold" },
  { value: "#F4C84A", label: "Bright gold" },
  { value: "#C8861A", label: "Deep amber" },
  { value: "#D9603A", label: "Burnt orange" },
  { value: "#4A8DB5", label: "Console blue" },
  { value: "#5BA678", label: "Reel green" },
  { value: "#9B6BC8", label: "Violet" },
  { value: "#C24A6B", label: "Crimson" },
];
