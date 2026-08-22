import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/* The agency's default plan is the Beta plan (`agencyPlans.isDefault`), and
   every beta studio belongs on it. A beta workspace with no plan row is not
   free-and-happy - it falls through the billing gate as "no_plan", which
   means no countdown, no warnings and nothing for the end-of-beta prompt to
   convert. */
export async function defaultAgencyPlanId(
  ctx: MutationCtx,
  agencyId: string | undefined | null,
): Promise<Id<"agencyPlans"> | null> {
  if (!agencyId) return null;
  const plans = await ctx.db
    .query("agencyPlans")
    .withIndex("by_agency_active", (q) => q.eq("agencyId", agencyId).eq("active", true))
    .collect();
  return plans.find((p) => p.isDefault)?._id ?? null;
}
