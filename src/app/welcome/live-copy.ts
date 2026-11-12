/* What the wizard's finish screen may honestly say. Rooms and Stripe are both
   optional steps, so "taking bookings ... with a deposit" is only true when the
   studio has a bookable room and a Stripe account that can take charges. */

export type LiveFacts = { studioName: string; bookableRooms: number; depositsReady: boolean };

export function liveScreenCopy({ studioName, bookableRooms, depositsReady }: LiveFacts) {
  if (bookableRooms === 0) {
    return {
      eyebrow: "Setup saved",
      headline: `${studioName} is almost ready`,
      body: "Your booking page is up, but there is nothing to book yet. Add a room in Settings to start taking bookings.",
      todo: depositsReady ? null : "Connect Stripe in Settings to take deposits.",
    };
  }
  return {
    eyebrow: "You are live",
    headline: `${studioName} is taking bookings`,
    body: depositsReady
      ? "Your booking page is live. Share the link and clients can pick a room, choose a time, and lock it in with a deposit - no back-and-forth."
      : "Your booking page is live. Share the link and clients can pick a room and choose a time. Connect Stripe in Settings to take deposits.",
    todo: null,
  };
}
