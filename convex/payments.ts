import { query, MutationCtx } from "./_generated/server";
import { mutation } from "./functions";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { currentOrgWithCapability } from "./lib/tenant";
import { notify, notifyTeam } from "./lib/notify";
import { money } from "./lib/money";

/* ============================================================
   Payments - the booking-payment ledger and the provider seam.
   Public bookers pay through Stripe Checkout (booking.payViaStripe);
   the webhook settles via this same path. `record` is the staff-only
   manual entry for money taken outside the app (cash, card reader).
   ============================================================ */

const kindV = v.union(v.literal("deposit"), v.literal("balance"), v.literal("full"));

/** Every payment recorded against a session, oldest first. Public - the
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

/** Recent cleared payments across the workspace - internal money view. */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const orgId = await currentOrgWithCapability(ctx, "invoices.read");
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
/**
 * Settle a booking payment (insert the ledger row, advance the session, confirm
 * a held booking, notify). Shared by the simulated `record` mutation and the
 * Stripe webhook (provider "stripe"). Returns the settlement summary.
 */
export async function settlePayment(
  ctx: MutationCtx,
  { sessionId, kind, payerName, provider, reference }: {
    sessionId: Id<"sessions">;
    kind: "deposit" | "balance" | "full";
    payerName?: string;
    provider?: "simulated" | "stripe";
    reference?: string;
  },
) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Booking not found.");
  const orgId = session.orgId;
  if (session.status === "cancelled") throw new Error("This booking was released.");

  const o = outstanding(session);
  const amountCents = kind === "deposit" ? Math.min(session.depositCents, o.balance) : o.balance;
  if (amountCents <= 0) throw new Error("This booking is already paid in full.");

  const paymentId = await ctx.db.insert("payments", {
    orgId,
    sessionId,
    kind,
    amountCents,
    provider: provider ?? "simulated",
    status: "paid",
    reference: reference ?? `MANUAL-${String(Date.now()).slice(-8)}`,
    payerName,
    paidAt: Date.now(),
  });

  const paidTotal = o.paid + amountCents;
  const fullyPaid = paidTotal >= session.rateCents;
  const patch: Record<string, unknown> = {
    amountPaidCents: paidTotal,
    depositPaid: paidTotal >= session.depositCents,
  };
  if (session.status === "tentative" && paidTotal >= session.depositCents) {
    patch.status = "confirmed";
    patch.holdExpiresAt = undefined;
  }
  await ctx.db.patch(sessionId, patch);

  const artist = await ctx.db.get(session.artistId);
  await ctx.db.insert("activity", {
    orgId,
    kind: "payment.received",
    summary: `${money(amountCents)} ${kind} payment cleared - ${session.title}`,
    entityType: "session",
    entityId: sessionId,
    accent: "positive",
  });
  await notifyTeam(ctx, {
    orgId,
    subject: `Payment received - ${money(amountCents)} (${kind}) for ${session.title}`,
    body: `${payerName ?? artist?.name ?? "A client"} paid ${money(amountCents)} (${kind}) on "${session.title}". ${fullyPaid ? "The booking is now paid in full." : `${money(session.rateCents - paidTotal)} remains due.`}`,
    kind: "payment.received",
    sessionId,
  });
  if (artist?.email) {
    await notify(ctx, {
      orgId,
      channel: "email",
      recipient: artist.email,
      subject: fullyPaid ? `Paid in full - ${session.title}` : `Deposit received - ${session.title}`,
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
}

export const record = mutation({
  args: {
    sessionId: v.id("sessions"),
    kind: kindV,
    payerName: v.optional(v.string()),
    provider: v.optional(v.union(v.literal("simulated"), v.literal("stripe"))),
  },
  handler: async (ctx, { sessionId, kind, payerName, provider }) => {
    // Staff-only: manual recording of money taken outside the app (cash,
    // card reader, Zelle). Public bookers pay through Stripe Checkout
    // (booking.payViaStripe) - an unauthenticated caller must never be able
    // to mark a booking paid.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Sign in to record a payment.");
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Booking not found.");
    const orgId = await currentOrgWithCapability(ctx, "invoices.send");
    if (session.orgId !== orgId) {
      throw new Error("This booking belongs to a different studio.");
    }
    return settlePayment(ctx, { sessionId, kind, payerName, provider });
  },
});

