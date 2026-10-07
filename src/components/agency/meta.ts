import type { BadgeProps } from "@/components/ui/badge";

/* Shared subaccount vocabulary - plan + status presentation. */

import { PRICING, type TierKey } from "@convex/lib/pricing";

/** A sub-account's plan: the same three keys as everywhere else. */
export type Plan = TierKey;
export type SubStatus = "active" | "paused" | "setup";

export const PLAN_LABEL: Record<Plan, string> = {
  core: PRICING.core.name,
  growth: PRICING.growth.name,
  max: PRICING.max.name,
};

type Tone = NonNullable<BadgeProps["tone"]>;

export const STATUS_TONE: Record<SubStatus, Tone> = {
  active: "positive",
  paused: "caution",
  setup: "info",
};

export const STATUS_LABEL: Record<SubStatus, string> = {
  active: "Active",
  paused: "Paused",
  setup: "Setup",
};

/** Lowercase-dashed slug suggestion from a free-text studio name. */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
