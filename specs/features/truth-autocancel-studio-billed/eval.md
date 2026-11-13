# Eval: Studio-billed bookings are auto-cancelled
Status: draft, waiting for owner approval
Risk: High. It changes when Pulse cancels a confirmed booking and what it tells a client about money. If it is wrong, unpaid public bookings stop being released (studio loses deposits it is owed) or studio-billed bookings keep being cancelled.
RD: ./rd.md

## Must not break
- Public booking with prices: hold nudge, hold release, balance reminder, forfeit at T-2h
- Booking requests with prices and a deposit due (approval leaves the booking tentative)
- Staff-made bookings: deposit pay link (step 1), balance reminder (step 2), never auto-cancelled
- Stale resolution (step 0), waitlist fill on release
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Approved pricing-hidden request inside T-2h is not cancelled | convex-test: request with hidePricing, approve, set clock to start - 1h, run automation → status `confirmed`, no `booking.forfeited` | PASS | `convex/studioBilledAutocancel.test.ts` "U-01: an approved pricing-hidden request inside T-2h stays confirmed, no forfeit" (real createBooking + bookingRequests.approve) |
| U-02 | No balance email or SMS with a pay link for a pricing-hidden booking at T-3h | convex-test → no `booking.balance_reminder` notification | PASS | `convex/studioBilledAutocancel.test.ts` "U-02: no balance email or SMS with a pay link at T-3h" |
| U-03 | Team heads-up sent once (if decision 2a) | convex-test: run twice → one team notification | PASS | `convex/studioBilledAutocancel.test.ts` "U-03 / U-09: the team heads-up is sent once, however often automation runs"; also "a studio-billed booking approved inside T-2h still gets the heads-up" and "no heads-up once the studio records payment in full" |
| U-04 | Public booking with prices and unpaid balance is still forfeited at T-2h | convex-test → `cancelled`, `booking.forfeited` | PASS | `convex/studioBilledAutocancel.test.ts` "U-04: a public booking with prices and an unpaid balance is still forfeited at T-2h" |
| U-05 | Public booking with prices still gets the balance reminder at T-3h | convex-test | PASS | `convex/studioBilledAutocancel.test.ts` "U-05: a public booking with prices still gets the balance reminder at T-3h" |
| U-06 | Staff-made confirmed booking with unpaid balance is not cancelled | convex-test (guards the existing `if (!isPublic) continue`) | PASS | `convex/studioBilledAutocancel.test.ts` "U-06: a staff-made confirmed booking with an unpaid balance is not cancelled" |
| U-07 | Pricing-hidden request still pending is untouched (no hold, no nudge) | convex-test | PASS | `convex/studioBilledAutocancel.test.ts` "U-07: a pricing-hidden request still pending is untouched" |
| U-08 | Unapproved, declined or cancelled pricing-hidden booking is not revived | convex-test: declined request → stays declined | PASS | `convex/studioBilledAutocancel.test.ts` "U-08: a declined pricing-hidden request stays declined and cancelled" |
| U-09 | Running automation twice in the same window sends nothing twice | convex-test | PASS | `convex/studioBilledAutocancel.test.ts` "U-03 / U-09" runs automation three times across both windows: one heads-up per recipient, no client message |
| U-10 | Staging walk-through | Staging: link without prices, request, approve, move start time 1h ahead → booking stays confirmed, no client email | NOT RUN | Needs the staging site. Owner: on staging, turn on the link without prices, request a session, approve it, change its start to 1 hour from now in the Convex dashboard, wait for the 15-minute run: booking stays confirmed, client gets no email, team gets "Studio-billed session in 1 hour". |
| U-11 | Must-not-break list passes | Full suite | PASS | Full `npx vitest run`, `npx tsc --noEmit`, `npm run lint` on this branch; only the known failures (see pull request). |
| R3-01 | A booking whose Stripe payment arrived short is never forfeited automatically; staff are alerted and decide (re-review H206-R2-01, owner decision) | convex-test: $400 booking, $100 paid, $200 balance Checkout paid after a reprice → `shortPaidAt` set, automation inside T-2h leaves it `confirmed` with no `booking.forfeited`; team "Payment short" says Pulse will not cancel it and they decide; client told what is still due with no forfeit deadline; an unpaid booking never short-paid is still forfeited | PASS | `convex/highRiskBookingPaymentsRound2.test.ts` "the short payment is marked on the booking and the forfeit sweep leaves it confirmed inside 2h of start"; "the team is told the shortfall and that they decide; the client is not given a deadline Pulse will enforce"; "a short deposit tells the client what is still due, not that the session is held"; "an unpaid confirmed booking that was never short-paid is still forfeited (unchanged)"; "an exact payment does not mark the booking short-paid" |
