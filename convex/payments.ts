import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { currentOrg } from "./lib/tenant";
import { notify } from "./lib/notify";
import { money } from "./lib/money";

/* ============================================================
   Payments — the booking-payment ledger and the provider seam.
   `record` is simulated today: it clears the payment instantly.
   Real Stripe = a createCheckout that returns a Checkout URL and a
   webhook that calls this same settle path. Booking logic is unchanged.
   ============================================================ */

const kindV = v.union(v.literal("deposit"), v.literal("balance"), v.literal("full"));

/** Every payment recorded against a session, oldest first. Public — the
    session id is the capability; payments belong to it regardless of org. */
export const forSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const rows = await ctx.db
      .query("payments")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    return rows.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Recent cleared payments across the workspace — internal money view. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrg(ctx);
    const rows = await ctx.db
      .query("payments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit ?? 25);
    return rows;
  },
});

/** What's still owed on a session. */
function outstanding(session: {
  rateCents: number;
  amountPaidCents?: number;
  depositCents: number;
}) {
  const paid = session.amountPaidCents ?? 0;
  return {
    paid,
    balance: Math.max(0, session.rateCents - paid),
    depositDue: Math.max(0, session.depositCents - paid),
    fullyPaid: paid >= session.rateCents,
  };
}

/**
 * Settle a payment against a booking. The amount is derived from the
 * session, never trusted from the client:
 *  - deposit → the configured deposit amount
 *  - balance → everything still owed
 *  - full    → everything still owed (deposit + balance in one)
 */
export const record = mutation({
  args: {
    sessionId: v.id("sessions"),
    kind: kindV,
    payerName: v.optional(v.string()),
    provider: v.optional(v.union(v.literal("simulated"), v.literal("stripe"))),
  },
  handler: async (ctx, { sessionId, kind, payerName, provider }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Booking not found.");
    const orgId = session.orgId;
    if (session.status === "cancelled") throw new Error("This booking was released.");

    const o = outstanding(session);
    const amountCents =
      kind === "deposit" ? Math.min(session.depositCents, o.balance) : o.balance;
    if (amountCents <= 0) throw new Error("This booking is already paid in full.");

    const paymentId = await ctx.db.insert("payments", {
      orgId,
      sessionId,
      kind,
      amountCents,
      provider: provider ?? "simulated",
      status: "paid",
      reference: `SIM-${String(Date.now()).slice(-8)}`,
      payerName,
      paidAt: Date.now(),
    });

    const paidTotal = o.paid + amountCents;
    const fullyPaid = paidTotal >= session.rateCents;
    const patch: Record<string, unknown> = {
      amountPaidCents: paidTotal,
      depositPaid: paidTotal >= session.depositCents,
    };
    // A paid deposit promotes a held booking to confirmed and ends the hold.
    if (session.status === "tentative" && paidTotal >= session.depositCents) {
      patch.status = "confirmed";
      patch.holdExpiresAt = undefined;
    }
    await ctx.db.patch(sessionId, patch);

    const artist = await ctx.db.get(session.artistId);
    await ctx.db.insert("activity", {
      orgId,
      kind: "payment.received",
      summary: `${money(amountCents)} ${kind} payment cleared — ${session.title}`,
      entityType: "session",
      entityId: sessionId,
      accent: "positive",
    });
    if (artist?.email) {
      await notify(ctx, {
        orgId,
        channel: "email",
        recipient: artist.email,
        subject: fullyPaid
          ? `Paid in full — ${session.title}`
          : `Deposit received — ${session.title}`,
        body: fullyPaid
          ? `We received ${money(amountCents)}. Your session is fully paid and locked in. See you in the studio.`
          : `We received your ${money(amountCents)} deposit. Your session is held. The ${money(
              session.rateCents - paidTotal,
            )} balance is due up to 2 hours before your start time.`,
        kind: fullyPaid ? "payment.full" : "payment.deposit",
        sessionId,
      });
    }

    return { paymentId, paidTotal, fullyPaid, balance: Math.max(0, session.rateCents - paidTotal) };
  },
});
