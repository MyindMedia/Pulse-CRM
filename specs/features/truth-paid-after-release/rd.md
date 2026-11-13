# RD: Client charged for a released booking (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `client-messages-paid-after-release`.
Code read on `develop` (2026-11-12).

## What Pulse says
The public checkout page, for a booking whose hold was released: "This booking was released and can no longer be paid. Start a new booking from the studio front." (`src/app/book/[slug]/checkout/[sessionId]/page.tsx:131-135`)

## What actually happens today
1. A public booking is held for 60 minutes (`HOLD_MINUTES = 60`, `convex/booking.ts:53`; `holdExpiresAt` set at `:1062`).
2. The client clicks Pay. `booking.payViaStripe` (`convex/booking.ts:1288-1325`) creates a Stripe Checkout session on the studio's connected account with no `expires_at`. Stripe's default lifetime for a Checkout session is 24 hours.
3. The hold passes; the 15-minute automation releases it: `status: "cancelled"` (`convex/automation.ts:311-343`) and emails the client that the slot is open again.
4. The client finishes paying in the still-open Stripe tab, or comes back to it later. Stripe takes the money on the studio's account.
5. The webhook calls `settlePayment` (`convex/billingWebhooks.ts:161-176`), which throws "This booking was released." (`convex/payments.ts:120`). The webhook catches it, logs `[webhook] settlePayment skipped`, and marks the event processed. No `payments` row, no refund, no message to the client or the studio.
6. Stripe's success page sends the client back to the checkout page, which now says the booking "can no longer be paid".

`_chargeContext` (`convex/booking.ts:1263-1286`) also does not look at `session.status`, so a client can even start a fresh Checkout on an already-cancelled booking if they still have the link (the page hides the button, but the action does not refuse).

## Who is hurt and how
- **The client** pays for a session they do not have, and the page tells them it was never payable. Their money sits on the studio's Stripe account.
- **The studio** holds money it does not know about, with no booking behind it, and faces a chargeback or complaint.
- Real harm, real money.

**Can it be happening in production now?** Yes, whenever a client pays more than 60 minutes after starting a hold (or 60 minutes after the hold began, even if they opened Checkout later). How the owner can check: Convex production logs, search for `[webhook] settlePayment skipped: This booking was released.`; or in `stripeEvents`, `checkout.session.completed` events whose metadata `sessionId` points to a `sessions` row with status `cancelled` and no matching `payments` row. Each hit is a client who paid and got nothing. Do not query; the owner looks.

## Cause (verified on develop)
- No `expires_at` in `checkout.sessions.create` (`convex/booking.ts:1306-1323`).
- Webhook swallows the "released" error with no refund or alert (`convex/billingWebhooks.ts:168-175`).
- `_chargeContext` / `payViaStripe` do not refuse a cancelled booking.
The audit description is correct.

## Proposed fix
1. **Stop new late payments.** In `payViaStripe`: refuse when the booking is `cancelled`; when it is a tentative hold, set `expires_at` to `holdExpiresAt` (Stripe requires at least 30 minutes in the future, so if less than 30 minutes remain, extend the hold to now + 31 minutes before creating the session, or refuse with "Your hold is about to expire, start again"). Recommend extending the hold: the client is actively paying.
2. **Handle the ones that still arrive** (a payment can complete in the seconds around expiry). In the webhook's `sessionId` branch, when the session is `cancelled`:
   - if the slot is still free, re-confirm the booking and record the payment (owner decision below), or
   - schedule an internal action that refunds the PaymentIntent on the connected account (`stripe.refunds.create({ payment_intent }, { stripeAccount })`), records a `payments` row with status `refunded`, emails the client "Your hold had expired, so we refunded you in full", and tells the team.
   The webhook is a mutation, so the refund must be an `internalAction` scheduled from it, keyed by the event id so a replay cannot refund twice (Stripe `idempotencyKey` = event id).
3. Any other error from `settlePayment` (for example "already paid in full", which is a real double payment) gets the same treatment: alert the team at minimum.

Files: `convex/booking.ts`, `convex/billingWebhooks.ts`, `convex/payments.ts` (a status for refunded), new `convex/lateRefunds.ts` (or inside `payments.ts`), tests in `convex/billing.test.ts`. There is no refund code anywhere in `convex/` today, so this is new money-moving code.
**Schema:** none. `payments.status` (`convex/schema.ts:1673-1678`) already allows `"refunded"`.
**One-time correction:** the owner reviews past cases found by the check above and refunds them by hand in each studio's Stripe dashboard, or asks the studio to.

## Decisions for the owner
1. Late payment on a released booking whose slot is still free: (a) always refund (recommended: simple, honest, and what the page already says); (b) re-book if the slot is free, refund otherwise.
2. Who issues the refund: (a) Pulse automatically (recommended, it is the client's money and the studio never earned it); (b) Pulse only alerts the studio and the studio refunds.

## Interim step (no money logic)
Change the released message on the checkout page to: "This hold expired. If you were charged after it expired, contact the studio and they will refund you." and add the same sentence to the "Hold released" email (`convex/automation.ts:326-333`). This is wording only and tells an affected client what to do.

## Risk
- An automatic refund that fires wrongly (for example on a booking the studio re-opened by hand) gives money back the studio was owed. Guard: refund only when the session is `cancelled` at the time the webhook runs, and log every refund to the team.
- `expires_at` too short makes Stripe reject session creation; covered by the 30-minute rule above.
- **Rollback:** remove the refund scheduling (behaviour returns to "log and ignore") and remove `expires_at`. Refunds already issued cannot be undone, which is why decision 2 matters.
