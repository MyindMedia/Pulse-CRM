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
| U-01 | Checkout for a held booking expires no later than the hold (or the hold is extended to cover Stripe's 30-minute minimum) | Unit test with a mocked Stripe client: `expires_at` argument equals `holdExpiresAt`, or hold extended when < 31 min remain | PENDING | |
| U-02 | `payViaStripe` refuses a cancelled booking | convex-test: cancelled session → ConvexError, no Stripe call | PENDING | |
| U-03 | Normal payment inside the hold still confirms the booking | convex-test: webhook for tentative session → `payments` row, status confirmed | PENDING | |
| U-04 | Payment that lands after release is refunded once | convex-test: cancelled session + webhook → one refund action scheduled with the PaymentIntent id and the connected account | PENDING | |
| U-05 | Replayed webhook does not refund twice | convex-test: same event id twice → one scheduled refund; refund call uses event id as idempotency key | PENDING | |
| U-06 | Refund goes to the studio's own connected account | Mocked Stripe: `stripeAccount` = org's `stripeAccountId` | PENDING | |
| U-07 | Event from the wrong connected account is ignored, no refund | convex-test: other studio's account → `.account_mismatch`, nothing scheduled | PENDING | |
| U-08 | Client gets a refund email and the team gets an alert | convex-test: notifications rows for client and team | PENDING | |
| U-09 | "Already paid in full" double payment alerts the team | convex-test: fully paid session + second webhook → team alert (and refund if decided) | PENDING | |
| U-10 | Refund failure is visible | Mocked Stripe throws → team alert "refund failed, refund by hand", `payments` row marks it | PENDING | |
| U-11 | Staging end to end | Staging, test card: start hold, set `holdExpiresAt` to the past on that test session via the staging dashboard, pay → refund visible in the connected test account, email received | PENDING | |
| U-12 | Double click on Pay does not create two charges on one hold | Staging: two Checkout tabs, pay both → second one refunded or refused | PENDING | |
| U-13 | Checkout page wording for expired holds is accurate | Read the page on staging after release | PENDING | |
| U-14 | Must-not-break list passes | Full suite plus staging booking smoke test | PENDING | |
