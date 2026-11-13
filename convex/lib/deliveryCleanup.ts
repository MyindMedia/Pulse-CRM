import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/* A booking's session file delivery (convex/sessionDelivery.ts) dies with the
   booking. Every place that deletes a sessions row one by one calls this
   first; places that delete a whole studio's tables list "sessionDeliveries"
   instead (subaccountDeletion.ORG_TABLES, which orgReset shares, seed.TABLES,
   agency._deleteSubaccount). A leftover row could not open anything (the
   public page needs its booking), but it would keep a client's address and a
   link token for a booking that no longer exists. Kept out of
   sessionDelivery.ts so seed and demo modules do not import the storage
   client. */

export async function deleteDeliveryForSession(ctx: MutationCtx, sessionId: Id<"sessions">): Promise<number> {
  const rows = await ctx.db
    .query("sessionDeliveries")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .take(10);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}
