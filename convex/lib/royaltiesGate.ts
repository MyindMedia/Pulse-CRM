import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { DEMO_ORG } from "./tenant";
import { requireFeature, orgHasFeature } from "./entitlements";

/* ============================================================
   Royalties ship dark. Two locks, both required:
     1. tier   - the studio is on Max (`royalties` capability);
     2. switch - its agency turned Royalties on (agencies.royaltiesEnabled).
   Every royalty query and mutation calls requireRoyalties first, so with
   the switch off the API refuses, not just the navigation.
   ============================================================ */

/** The agency switch for the agency that owns this studio. A studio with no
 *  agency (or the demo workspace) is off: nobody has turned it on. */
export async function royaltiesSwitchOn(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<boolean> {
  if (orgId === DEMO_ORG) return false;
  const org = await ctx.db
    .query("orgs")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .first();
  if (!org?.agencyId) return false;
  const agency = await ctx.db
    .query("agencies")
    .withIndex("by_agency", (q) => q.eq("agencyId", org.agencyId!))
    .first();
  return agency?.royaltiesEnabled === true;
}

export function royaltiesOffError(): ConvexError<{ code: string; message: string }> {
  return new ConvexError({
    code: "ROYALTIES_OFF",
    message: "Royalties are not switched on for this studio yet.",
  });
}

/** Hard gate: switch first (so a Max studio with the switch off is told
 *  "not on yet", not "upgrade"), then the tier. */
export async function requireRoyalties(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<void> {
  if (!(await royaltiesSwitchOn(ctx, orgId))) throw royaltiesOffError();
  await requireFeature(ctx, orgId, "royalties");
}

/** Non-throwing: should this studio see Royalties at all. */
export async function royaltiesAvailable(
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<boolean> {
  return (await royaltiesSwitchOn(ctx, orgId)) && (await orgHasFeature(ctx, orgId, "royalties"));
}
