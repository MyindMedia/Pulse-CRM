import type { Doc } from "../_generated/dataModel";

/* ── What the booking checkout charges ─────────────────────────
   The one source for the booking checkout's money, used by the checkout
   page's data (booking.booking), the hosted Stripe Checkout it opens
   (booking.payViaStripe and its _chargeContext; the webhook then settles
   through payments.settlePayment, whose `outstanding` does the same
   arithmetic) and the session delivery page, which offers a Pay button to
   this checkout only when the amount it charges is the amount the client is
   shown (sessionDelivery.payTargetFor). Change the checkout's money here and
   every one of them follows. */

export type CheckoutKind = "deposit" | "balance" | "full";

/** Online card payment on the studio's own connected Stripe account. The
 *  checkout page shows a Pay button only when this is true
 *  (`booking.booking().stripeCheckout`); payViaStripe returns no URL without it. */
export function onlineCardPayments(org: Pick<Doc<"orgs">, "stripeAccountId" | "stripeChargesEnabled"> | null): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && org?.stripeAccountId && org?.stripeChargesEnabled);
}

/** A room's payment mode. Undefined means deposit: every room that predates
 *  the switch was sold that way, and a silent flip to paid-in-full is a
 *  studio's pricing changed without them touching it. */
export function roomPaymentMode(room: Pick<Doc<"rooms">, "paymentMode">): "deposit" | "full" {
  return room.paymentMode ?? ("deposit" as const);
}

/** The payment mode the checkout page reads for a booking: its room's, or
 *  deposit when the booking has no room. */
export function checkoutPaymentMode(room: Pick<Doc<"rooms">, "paymentMode"> | null): "deposit" | "full" {
  return room ? roomPaymentMode(room) : ("deposit" as const);
}

/** What the checkout treats as still owed: the rate less booking payments. */
export function checkoutBalanceCents(s: { rateCents: number; amountPaidCents?: number }): number {
  return Math.max(0, s.rateCents - (s.amountPaidCents ?? 0));
}

/** What payViaStripe charges for one kind of payment. */
export function checkoutChargeCents(c: { depositCents: number; balanceCents: number }, kind: CheckoutKind): number {
  return kind === "deposit" ? Math.min(c.depositCents, c.balanceCents) : c.balanceCents;
}

/** The kinds of payment the checkout page offers for a booking, as
 *  src/app/book/[slug]/checkout/[sessionId]/page.tsx and
 *  src/lib/checkout-view.ts decide them: nothing paid yet, a deposit (the
 *  preselected choice) or the full amount, unless the room is sold paid in full
 *  or takes no deposit, when only the full amount; something paid, the
 *  balance; paid in full, nothing. convex/sessionDelivery.payTarget.test.ts
 *  checks this against checkoutView itself. */
export function checkoutKindsOffered(
  s: { rateCents: number; amountPaidCents?: number; depositCents: number },
  paymentMode: "deposit" | "full",
): CheckoutKind[] {
  const paid = s.amountPaidCents ?? 0;
  if (paid === 0) return paymentMode === "full" || s.depositCents <= 0 ? ["full"] : ["deposit", "full"];
  if (paid >= s.rateCents) return [];
  return ["balance"];
}
