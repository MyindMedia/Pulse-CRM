import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { TierKey, BillingInterval } from "./pricing";

type Ctx = QueryCtx | MutationCtx;

/* The Pulse team's own agency. Every paying studio is a sub-account of it,
   and only its members may open the agency console. Buyers are never agency
   members: checkout gives them a studio, not an agency.

   PULSE_AGENCY_ID pins it. Without it, the Pulse agency is the ONE agency
   with no platform subscription of its own (a buyer agency always has one).
   Two such agencies is ambiguous and resolves to none, so nobody is ever
   elevated into a guessed agency. */
export async function platformAgencyId(ctx: Ctx): Promise<string | null> {
  const pinned = process.env.PULSE_AGENCY_ID?.trim();
  if (pinned) return pinned;
  const unsubscribed = (await ctx.db.query("agencies").take(100)).filter((a) => !a.stripeSubscriptionId);
  return unsubscribed.length === 1 ? unsubscribed[0].agencyId : null;
}

/** The Pulse agency's plan row for a tier ("Core", "Growth", "Max"). */
export async function platformPlanIdForTier(
  ctx: Ctx,
  agencyId: string,
  tier: TierKey,
  interval: BillingInterval,
): Promise<Id<"agencyPlans"> | null> {
  const plans = await ctx.db
    .query("agencyPlans")
    .withIndex("by_agency_active", (q) => q.eq("agencyId", agencyId).eq("active", true))
    .collect();
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
  const pick =
    plans.find((p) => p.name === name && p.billingInterval === interval) ??
    plans.find((p) => p.name === name) ??
    plans.find((p) => p.name.startsWith(name) && !p.isPromo);
  return pick?._id ?? null;
}
