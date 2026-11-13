import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { paidTowardSession } from "./cardConsent";

/**
 * Money paid on invoices linked to this session (a completion balance paid by
 * link or marked paid by staff). Paying an invoice never updates
 * session.amountPaidCents, so this is added on top of it. `exclude` is the fee
 * invoice being assessed or charged, which is never "already paid" toward
 * itself.
 */
export async function paidOnSessionInvoicesCents(
  ctx: QueryCtx,
  s: Doc<"sessions">,
  exclude?: Id<"invoices">,
): Promise<number> {
  // Same per-client index the fee and completion invoices are looked up by.
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_artist", (q) => q.eq("artistId", s.artistId))
    .collect();
  return invoices
    .filter((inv) => inv.sessionId === s._id && inv._id !== exclude && inv.orgId === s.orgId && inv.status === "paid")
    .reduce((sum, inv) => sum + Math.max(0, inv.amountCents), 0);
}

/** Everything the client has paid toward a session: the session's own running
 *  total (or deposit) plus paid invoices for it. A no-show fee is never charged
 *  for money already in hand. */
export async function paidTowardSessionAll(
  ctx: QueryCtx,
  s: Doc<"sessions">,
  exclude?: Id<"invoices">,
): Promise<number> {
  return paidTowardSession(s) + (await paidOnSessionInvoicesCents(ctx, s, exclude));
}
