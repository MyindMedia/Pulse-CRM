import { v } from "convex/values";
import type { TierKey } from "./pricing";

/* ============================================================
   LEGACY plan values. Migration support only.

   The old ladder (and every value an older row can still carry) is
   named here and nowhere else, so the "no old plan keys" test can
   exclude exactly this file and convex/migrations.ts.

   DELETE THIS FILE in the second deploy, after
   migrations:migrateToCoreGrowthMax has reported zero legacy rows on
   the production deployment. Then narrow the schema unions in
   convex/schema.ts to the three new keys (see the TWO-STEP DEPLOY note
   there) and drop orgs.plan.
   ============================================================ */

/** Every old value of orgs.tier and agencies.plan, mapped to its new tier. */
export const LEGACY_TIER_MAP: Record<string, TierKey> = {
  studio: "core",
  pro: "growth",
  label: "max",
  // Older internal keys
  flow: "core",
  enterprise: "max",
  agency: "max",
  agency_plus: "max",
};

/** The retired orgs.plan field used the same words for DIFFERENT tiers than
 *  orgs.tier: plan "solo" was the old studio tier, plan "studio" was the
 *  old pro tier, plan "label" was label. */
export const LEGACY_ORG_PLAN_MAP: Record<string, TierKey> = {
  solo: "core",
  studio: "growth",
  label: "max",
};

/** Resolve a stored tier string that may be an old value. New keys pass
 *  through; unknown strings return null so the caller picks the floor. */
export function migrateTierValue(value: string | undefined | null): TierKey | null {
  if (!value) return null;
  if (value === "core" || value === "growth" || value === "max") return value;
  return LEGACY_TIER_MAP[value] ?? null;
}

/** Old orgs.tier literals still accepted by the schema until the migration
 *  has run in production. */
export const legacyOrgTierV = v.union(
  v.literal("flow"),
  v.literal("studio"),
  v.literal("pro"),
  v.literal("label"),
  v.literal("enterprise"),
  v.literal("agency"),
);

/** Old agencies.plan literals, same reason. */
export const legacyAgencyPlanV = v.union(
  v.literal("flow"),
  v.literal("studio"),
  v.literal("pro"),
  v.literal("label"),
  v.literal("enterprise"),
  v.literal("agency"),
  v.literal("agency_plus"),
);

/** The retired orgs.plan field, kept optional so old rows still validate. */
export const legacyOrgPlanV = v.union(
  v.literal("solo"),
  v.literal("studio"),
  v.literal("label"),
);

/** Old agency price-book plan names laid down by the starter seeder, mapped
 *  to the new ones. Matched on the exact name or the "<name> - Early
 *  Adopter" form. */
export const LEGACY_PLAN_NAME_MAP: Record<string, string> = {
  Studio: "Core",
  "Studio Pro": "Growth",
  Label: "Max",
};
