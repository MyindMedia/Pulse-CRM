# RD: Studio-billed bookings are auto-cancelled (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `client-messages-pricing-hidden-autocancel`.
Code read on `develop` (2026-11-12).

## What Pulse says
To the client, 2 to 4 hours before the session: "Your {amount} balance is due before your session. Pay in full at least 2 hours before your start time to keep the booking." with a pay link (`convex/automation.ts:155-200`). Then at 2 hours: "The balance was not paid in full 2 hours before the session, so the booking was released. The deposit is non-refundable per the booking terms." (`convex/automation.ts:345-380`)

## What actually happens today
1. A studio can publish a booking link without prices ("hide pricing"). A request from it is stored with the real `rateCents`, `depositCents: 0` and `pricingHidden: true` (`convex/booking.ts:1029-1033`, `:1063`), source `public_booking`.
2. The studio approves it. Because no public deposit is owed, approval sets `status: "confirmed"` with nothing paid (`convex/bookingRequests.ts:264-271`). The studio intends to bill the client itself.
3. The 15-minute automation then treats it like any unpaid public booking:
   - step 2 sends the balance email and SMS with a checkout link (`convex/automation.ts:155-200`), and that link refuses to open: `payViaStripe` throws "The studio will follow up about payment for this booking." (`convex/booking.ts:1296`);
   - step 4, two hours before start, sets the booking to `cancelled`, emails the client that it was released and that "the deposit is non-refundable" (there was no deposit), tells the team, and offers the slot to the waitlist (`convex/automation.ts:345-380`).
4. Unless staff recorded a payment in full before T-2h, every approved studio-billed booking is cancelled on the day.

**Correction to the audit:** the second reviewer asked to "add `isPublic &&` to step 4 so staff bookings are never auto-cancelled". That is already in place on `develop`: `if (!isPublic) continue;` at `convex/automation.ts:256` runs before steps 2c, 3 and 4, so staff-made bookings are not auto-cancelled. Only step 2 (the reminder) runs for internal bookings, by design (comment at `:156`). No change is needed for that part.

## Who is hurt and how
- **The client** is told to pay through a link that does not work, then told their confirmed session is cancelled and a deposit they never paid is forfeited. They may not turn up, or turn up to a room given to someone on the waitlist.
- **The studio** loses the session, and its waitlist may double-book the slot.
- This hits every studio that uses a link without prices and approves requests.

**Can it be happening in production now?** Yes, whenever a pricing-hidden request is approved and not marked paid in full before T-2h. How the owner can check: production `sessions` with `pricingHidden: true` and `status: "cancelled"`, and an `activity` row of kind `booking.forfeited` for the same session; or `notifications` of kind `booking.forfeited` / `booking.balance_reminder` for sessions with `pricingHidden: true`.

## Cause (verified on develop)
- `convex/automation.ts:155-162` (step 2) and `:345-351` (step 4) do not check `s.pricingHidden`.
- `convex/bookingRequests.ts:264-271` confirms a pricing-hidden request with nothing paid, which is correct by itself.

## Proposed fix (smallest correct change)
In `convex/automation.ts`:
- step 2: skip when `s.pricingHidden === true` (the studio bills the client itself; Pulse has no working link to send);
- step 4: skip when `s.pricingHidden === true`.
- Optionally (recommended) send the team, not the client, a heads-up at the step-2 time: "Studio-billed session in 4 hours, balance not recorded in Pulse." so the studio still chases its money.
Files: `convex/automation.ts`, a test next to `convex/bookingRequests.test.ts` that approves a pricing-hidden request and runs `runAutomation` inside the 2-hour window.
**Schema:** none.
**One-time correction:** none in data. The owner may want to tell affected studios (from the check above) so they can contact clients.

## Decisions for the owner
1. Should Pulse ever cancel a studio-billed booking for non-payment? (a) never, the studio decides (recommended); (b) only when the studio turns on a per-studio rule.
2. Team heads-up at T-4h for unpaid studio-billed sessions: (a) yes (recommended); (b) no.

## Interim step
None that avoids the automation change; this is already a one-line guard in each step. If the fix waits, the owner can ask studios using hide-pricing to mark these bookings paid (or switch hide-pricing off) until it ships.

## Risk
- Small change. The risk is skipping too much: a booking that is pricing-hidden but where the studio later sent a normal deposit link would no longer be chased. That cannot happen today (`payViaStripe` refuses all pricing-hidden bookings).
- **Rollback:** revert the two guards.
