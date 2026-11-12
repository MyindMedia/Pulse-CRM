/* What the public checkout page offers for an unpaid booking, and the toast
   the booking pages show once createBooking returns. Pure, so the choice is
   testable without rendering the page.

   A booking with no deposit (paid-in-full rooms carry the whole price as the
   deposit, 0% rooms carry 0) has nothing to offer but "Pay in full": a $0
   deposit choice cannot be paid, so it is never shown. */

export type CheckoutBookingFacts = {
  paymentMode?: "deposit" | "full";
  depositCents: number;
  status: string;
};

export type CheckoutView = {
  /* Hide the deposit card and pay "full". */
  fullOnly: boolean;
  heading: string;
  intro: string;
  note: string;
};

export function checkoutView(b: CheckoutBookingFacts): CheckoutView {
  if (b.paymentMode === "full") {
    return {
      fullOnly: true,
      heading: "Hold your session",
      intro: "This session is paid in full to confirm it.",
      note: "This studio confirms sessions on payment in full. Nothing is held until it clears.",
    };
  }
  if (b.depositCents <= 0) {
    // A 0% deposit booking made well ahead is booked outright; one made at
    // short notice is a hold that the full payment confirms.
    if (b.status === "confirmed") {
      return {
        fullOnly: true,
        heading: "You're booked",
        intro: "No deposit is needed. Pay the balance at least 2 hours before your session.",
        note: "The balance is due 2 hours before your session, or the booking is released.",
      };
    }
    return {
      fullOnly: true,
      heading: "Hold your session",
      intro: "No deposit is taken for this room. Pay in full to confirm the session.",
      note: "Pay in full before the hold runs out to confirm the session, or the hold is released.",
    };
  }
  return {
    fullOnly: false,
    heading: "Hold your session",
    intro: "Pay a deposit to hold the room, or settle the full amount now.",
    note: "A deposit holds your booking; the balance is due up to 2 hours before your session, or the hold is released.",
  };
}

export type CreateBookingOutcome = {
  depositCents?: number;
  status?: string;
};

export function bookingToast(result: CreateBookingOutcome, pricingHidden: boolean): string {
  if (pricingHidden) return "Request sent. The studio will confirm by email and text.";
  if (result.depositCents === 0 && result.status === "confirmed") {
    return "Booked - pay the balance 2 hours before start.";
  }
  return "Booking held - finish payment to confirm.";
}
