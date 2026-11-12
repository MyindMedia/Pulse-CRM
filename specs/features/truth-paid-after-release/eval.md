# Eval: Client charged for a released booking
Status: draft, waiting for owner approval
Risk: High. New code that refunds real money on studios' Stripe accounts. If it is wrong, a client keeps being charged for nothing, or a studio refunds a payment it was owed, or refunds twice.
RD: ./rd.md

## Must not break
- Public booking: hold, deposit checkout, balance checkout, paid-in-full checkout, confirmation emails
- Hold-expiry nudge SMS and hold release (`convex/automation.ts` steps 2c and 3)
- Booking requests (approval flow) and pricing-hidden requests
- Invoice, package and membership webhook branches; Stripe event idempotency
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Checkout for a held booking expires no later than the hold (or the hold is extended to cover Stripe's 30-minute minimum) | Unit test with a mocked Stripe client: `expires_at` argument equals `holdExpiresAt`, or hold extended when < 31 min remain | PASS | `convex/paidAfterRelease.test.ts` "U-01: expires_at equals the hold's end when more than 30 minutes remain" and "U-01: with under 31 minutes left the hold is extended to cover Stripe's 30-minute minimum" (mocked Stripe) |
| U-02 | `payViaStripe` refuses a cancelled booking | convex-test: cancelled session → ConvexError, no Stripe call | PASS | `convex/paidAfterRelease.test.ts` "U-02: payViaStripe refuses a cancelled booking with no Stripe call"; also "a hold already past its end (not yet swept) cannot start a Checkout and is not revived" |
| U-03 | Normal payment inside the hold still confirms the booking | convex-test: webhook for tentative session → `payments` row, status confirmed | PASS | `convex/paidAfterRelease.test.ts` "U-03: a normal payment inside the hold still confirms the booking" |
| U-04 | Payment that lands after release is refunded once | convex-test: cancelled session + webhook → one refund action scheduled with the PaymentIntent id and the connected account | PASS | `convex/paidAfterRelease.test.ts` "U-04: a payment after release schedules exactly one refund and records no booking payment" |
| U-05 | Replayed webhook does not refund twice | convex-test: same event id twice → one scheduled refund; refund call uses event id as idempotency key | PASS | `convex/paidAfterRelease.test.ts` "U-05: a replayed webhook (same event, or the same payment on a new event) does not refund twice" (idempotency key = `pulse-stray-refund-<event id>`) |
| U-06 | Refund goes to the studio's own connected account | Mocked Stripe: `stripeAccount` = org's `stripeAccountId` | PASS | `convex/paidAfterRelease.test.ts` "U-06: the refund goes to the studio's own connected account, for that payment" |
| U-07 | Event from the wrong connected account is ignored, no refund | convex-test: other studio's account → `.account_mismatch`, nothing scheduled | PASS | `convex/paidAfterRelease.test.ts` "U-07: an event from another studio's connected account is ignored, nothing refunded" |
| U-08 | Client gets a refund email and the team gets an alert | convex-test: notifications rows for client and team | PASS | `convex/paidAfterRelease.test.ts` "U-08: after the refund the client gets a refund email and the team an alert" |
| U-09 | "Already paid in full" double payment alerts the team | convex-test: fully paid session + second webhook → team alert (and refund if decided) | PASS | `convex/paidAfterRelease.test.ts` "U-09: a second payment on a booking already paid in full alerts the team and is not refunded automatically" (refund not decided in the write-up, so alert only) |
| U-10 | Refund failure is visible | Mocked Stripe throws → team alert "refund failed, refund by hand", `payments` row marks it | PASS | `convex/paidAfterRelease.test.ts` "U-10: a failed refund is recorded and the team is told to refund by hand". The record is a `strayPayments` row (status `refund_failed`), not a `payments` row: several revenue reports sum `payments` without checking status, so a refunded row there would count as income. |
| U-11 | Staging end to end | Staging, test card: start hold, set `holdExpiresAt` to the past on that test session via the staging dashboard, pay → refund visible in the connected test account, email received | NOT RUN | Needs staging Stripe test mode. Owner: on staging, start a hold, open Checkout, set that session's `holdExpiresAt` to the past and `status` to `cancelled` in the staging Convex dashboard, pay with 4242 4242 4242 4242: refund appears in the connected test account and the client email is logged. |
| U-12 | Double click on Pay does not create two charges on one hold | Staging: two Checkout tabs, pay both → second one refunded or refused | NOT RUN | Needs two real Checkout tabs on staging. Webhook side is unit-tested: `convex/paidAfterRelease.test.ts` "U-12 (webhook side): two deposit Checkouts paid for one hold - the second counts toward the balance, nothing is lost" and "a stale full-price Checkout paid after the deposit: the extra the client paid is flagged for the studio". |
| U-13 | Checkout page wording for expired holds is accurate | Read the page on staging after release | NOT RUN | Wording changed in `src/app/book/[slug]/checkout/[sessionId]/page.tsx`; owner reads it on staging on a released booking's checkout page. |
| U-14 | Must-not-break list passes | Full suite plus staging booking smoke test | NOT RUN | Full suite, tsc and lint pass on this branch with only the known failures (see pull request); the staging booking smoke test is for the owner. |
