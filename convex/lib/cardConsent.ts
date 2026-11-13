import { money } from "./money";

/* ============================================================
   Saving a client's card at checkout, and when Pulse may charge it.

   The client sees one plain sentence at checkout (cardConsentText). The
   booking stores that exact sentence, the policy it stated and when the
   client agreed (sessions.cardConsent). A fee is charged to the card only
   when every rule in `autoChargeDecision` holds; otherwise the fee stays a
   draft invoice, which is how Pulse has always billed it.
   ============================================================ */

export type ConsentPolicy = {
  studioName: string;
  feePct: number;
  windowHours: number;
  rateCents: number;
};

/** Clamp the studio's policy the same way sessions.assessNoShowShield does. */
export function normalizedPolicy(org: {
  cancellationFeePct?: number;
  cancellationWindowHours?: number;
} | null): { feePct: number; windowHours: number } {
  return {
    feePct: Math.min(Math.max(org?.cancellationFeePct ?? 0, 0), 100),
    windowHours: Math.max(org?.cancellationWindowHours ?? 0, 0),
  };
}

/** The full fee for a booking under a policy, in cents. */
export function feeCentsFor(rateCents: number, feePct: number): number {
  return Math.round((rateCents * feePct) / 100);
}

/** Everything the client has already paid toward this session: the running
 *  total, or the deposit when only that is recorded. A fee is never charged
 *  for money already in hand. */
export function paidTowardSession(s: {
  amountPaidCents?: number;
  depositPaid?: boolean;
  depositCents?: number;
}): number {
  return Math.max(s.amountPaidCents ?? 0, s.depositPaid ? (s.depositCents ?? 0) : 0);
}

/** What is still owed on a fee once what was already paid is applied. */
export function feeStillOwedCents(feeCents: number, paidCents: number): number {
  return Math.max(0, feeCents - Math.max(0, paidCents));
}

/** The sentence the client agrees to. Built on the server from the studio's
 *  own policy, so the page cannot show one thing and record another. */
export function cardConsentText(p: ConsentPolicy): string {
  const fee = feeCentsFor(p.rateCents, p.feePct);
  const studio = p.studioName.trim() || "The studio";
  // The card is charged automatically only for a no-show. A late cancel is
  // billed by an invoice the studio chooses to send, never to the card.
  const lateCancel =
    p.windowHours > 0
      ? ` If you cancel less than ${p.windowHours} hour${p.windowHours === 1 ? "" : "s"} before it starts, ` +
        `${studio} may bill you that fee by invoice; a cancellation is never charged to this card automatically.`
      : "";
  return (
    `${studio} will save the card you pay with today, securely with Stripe. ` +
    `If you miss this session, ${studio} may charge that card a fee of ${p.feePct}% of the session price ` +
    `(${money(fee)}), less anything you already paid for this session, under its cancellation policy.` +
    lateCancel
  );
}

/** Whether the studio is set up to save a card at checkout for this booking. */
export function cardSaveOffered(args: {
  switchOn: boolean;
  stripeReady: boolean;
  feePct: number;
  rateCents: number;
}): boolean {
  return (
    args.switchOn &&
    args.stripeReady &&
    args.feePct > 0 &&
    feeCentsFor(args.rateCents, args.feePct) > 0
  );
}

export type CardConsent = {
  text: string;
  feePct: number;
  windowHours: number;
  maxFeeCents: number;
  agreedAt: number;
  paymentMethodId?: string;
  savedAt?: number;
};

export type AutoChargeInput = {
  stripeConfigured: boolean;
  switchOn: boolean;
  stripeAccountId: string | null | undefined;
  chargesEnabled: boolean;
  stripeCustomerId: string | null | undefined;
  /** The client's card on file right now. */
  defaultPaymentMethodId: string | null | undefined;
  consent: CardConsent | null | undefined;
  status: "cancelled" | "no_show";
  /** The full fee being assessed now (before the deposit is applied). */
  feeCents: number;
  /** What would be charged to the card (fee less everything already paid). */
  chargeCents: number;
  /** Everything the client has already paid toward this session. */
  paidCents: number;
  startTime: number;
  now: number;
};

export type AutoChargeDecision = { charge: true } | { charge: false; reason: string };

/** Every rule that must hold before a fee is charged to a saved card. */
export function autoChargeDecision(i: AutoChargeInput): AutoChargeDecision {
  if (i.chargeCents <= 0) return { charge: false, reason: "nothing to charge" };
  // Never charge for money already in hand: what was paid toward the session
  // (deposit or more) comes off the fee first.
  if (i.paidCents >= i.feeCents) {
    return { charge: false, reason: "the client already paid at least the fee" };
  }
  if (i.chargeCents > feeStillOwedCents(i.feeCents, i.paidCents)) {
    return { charge: false, reason: "charge is more than the fee less what the client already paid" };
  }
  if (!i.switchOn) return { charge: false, reason: "studio switch off" };
  if (!i.stripeConfigured || !i.stripeAccountId || !i.chargesEnabled) {
    return { charge: false, reason: "studio Stripe not ready" };
  }
  if (!i.consent) return { charge: false, reason: "client did not agree at checkout" };
  if (!i.consent.paymentMethodId) return { charge: false, reason: "no card saved at checkout" };
  if (!i.stripeCustomerId || !i.defaultPaymentMethodId) {
    return { charge: false, reason: "no card on file" };
  }
  // Only the card the client agreed for, and only while it is still on file:
  // a card staff removed or replaced is never charged.
  if (i.defaultPaymentMethodId !== i.consent.paymentMethodId) {
    return { charge: false, reason: "card on file is not the one agreed at checkout" };
  }
  // Never more than the client agreed to.
  if (i.feeCents > i.consent.maxFeeCents) {
    return { charge: false, reason: "fee is above what the client agreed" };
  }
  // Only a no-show is ever charged to the card. Every cancellation reaches
  // Pulse through staff (setStatus or an approved change request), and
  // nothing records whether the client or the studio asked for it, so a late
  // cancel stays a draft invoice that staff choose to send.
  if (i.status === "cancelled") {
    return { charge: false, reason: "a late cancellation is billed by invoice, not charged to the card" };
  }
  return { charge: true };
}

/** The client's no-show / late-cancel email, saying what really happened. */
export function feeEmailBody(a: {
  clientName: string;
  label: string; // "no-show fee" | "late cancellation fee"
  status: "cancelled" | "no_show";
  title: string;
  feeCents: number;
  depositForfeitCents: number;
  /** Everything already paid that was applied toward the fee (at most the
   *  fee). Defaults to the deposit. */
  paidAppliedCents?: number;
  balanceCents: number;
  outcome: "invoice_to_follow" | "charged";
  cardLast4?: string;
}): string {
  const applied = a.paidAppliedCents ?? a.depositForfeitCents;
  const depositLine =
    applied > a.depositForfeitCents
      ? ` The ${money(applied)} you already paid for this session has been applied toward it.`
      : a.depositForfeitCents > 0
        ? ` Your ${money(a.depositForfeitCents)} deposit has been applied toward it.`
        : "";
  const what =
    a.outcome === "charged"
      ? `We charged the ${money(a.balanceCents)} balance to your saved card${a.cardLast4 ? ` ending ${a.cardLast4}` : ""}, as you agreed when you booked.`
      : `The studio will send you an invoice for the ${money(a.balanceCents)} balance.`;
  return (
    `Hi ${a.clientName},\n\nPer our booking policy, a ${a.label} of ${money(a.feeCents)} applies to your ` +
    `${a.status === "no_show" ? "missed" : "late-cancelled"} session "${a.title}".${depositLine} ${what} ` +
    `Reply here with any questions - we would love to get you rebooked.`
  );
}
