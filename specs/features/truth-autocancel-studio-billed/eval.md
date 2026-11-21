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
| U-01 | Approved pricing-hidden request inside T-2h is not cancelled | convex-test: request with hidePricing, approve, set clock to start - 1h, run automation → status `confirmed`, no `booking.forfeited` | PENDING | |
| U-02 | No balance email or SMS with a pay link for a pricing-hidden booking at T-3h | convex-test → no `booking.balance_reminder` notification | PENDING | |
| U-03 | Team heads-up sent once (if decision 2a) | convex-test: run twice → one team notification | PENDING | |
| U-04 | Public booking with prices and unpaid balance is still forfeited at T-2h | convex-test → `cancelled`, `booking.forfeited` | PENDING | |
| U-05 | Public booking with prices still gets the balance reminder at T-3h | convex-test | PENDING | |
| U-06 | Staff-made confirmed booking with unpaid balance is not cancelled | convex-test (guards the existing `if (!isPublic) continue`) | PENDING | |
| U-07 | Pricing-hidden request still pending is untouched (no hold, no nudge) | convex-test | PENDING | |
| U-08 | Unapproved, declined or cancelled pricing-hidden booking is not revived | convex-test: declined request → stays declined | PENDING | |
| U-09 | Running automation twice in the same window sends nothing twice | convex-test | PENDING | |
| U-10 | Staging walk-through | Staging: link without prices, request, approve, move start time 1h ahead → booking stays confirmed, no client email | PENDING | |
| U-11 | Must-not-break list passes | Full suite | PENDING | |
