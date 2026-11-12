# Eval: Saved card and charging a no-show
Status: draft, waiting for owner approval
Risk: High. It turns on off-session card charges on studios' own Stripe accounts for the first time. If it is wrong, a client is charged without consent, the wrong client's card is saved, or a studio's card is charged twice.
RD: ./rd.md

## Must not break
- Booking deposit and balance checkout (`booking.payViaStripe`, webhook `checkout.session.completed` with `sessionId`)
- Invoice pay link (`invoicePay.payViaStripe`) and package, membership and sub-account billing webhook branches
- Sub-account "add a card" (`agencyBilling`, `kind: subaccount_billing`), which also uses a setup flow
- No-show / late-cancel fee invoices, deposit forfeit, client roster profile page
- Stripe event idempotency (`stripeEvents`, `alreadyProcessed`)
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures listed in FIX-PLAN.md

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | A succeeded SetupIntent on the studio's own connected account saves the card on the right client | convex-test: `billingWebhooks.handle` with `setup_intent.succeeded`, `account` = org's `stripeAccountId`, customer = artist's `stripeCustomerId`, metadata `card_on_file` → artist has `defaultPaymentMethodId` | PENDING | |
| U-02 | The client profile shows "Saved" after a real card is added on staging | Staging, Stripe test card 4242: add card on a test client, reload profile | PENDING | |
| U-03 | 3-D Secure card saves even though the browser redirected | Staging, Stripe test card 4000 0027 6000 3184: complete the challenge; profile shows "Saved" from the webhook alone | PENDING | |
| U-04 | Wrong connected account is refused | convex-test: same event with `account` of another studio → no patch, `stripeEvents` type ends `.account_mismatch` | PENDING | |
| U-05 | No account (platform event) is refused | convex-test: event without `account` → no patch | PENDING | |
| U-06 | Customer that belongs to another studio's client is refused | convex-test: customer id of org B's artist, account of org A → no patch | PENDING | |
| U-07 | SetupIntent without Pulse metadata is ignored | convex-test: no `kind: card_on_file` metadata → no patch | PENDING | |
| U-08 | SetupIntent not succeeded (`requires_action`, `canceled`) does nothing | convex-test for each status | PENDING | |
| U-09 | Replayed webhook is a no-op | convex-test: same event id twice → second returns `{ duplicate: true }`, one activity row | PENDING | |
| U-10 | No browser path can set a card | Read the diff: no public mutation or action takes a payment method id; grep `defaultPaymentMethodId` writers = webhook helper only | PENDING | |
| U-11 | Signed-out caller cannot create a SetupIntent | convex-test: `createSetupIntent` with no identity → error | PENDING | |
| U-12 | A member without `invoices.send` cannot create a SetupIntent | convex-test with an engineer identity → FORBIDDEN | PENDING | |
| U-13 | Another studio's artist id is refused | convex-test: org A member, org B `artistId` → "Client not found." | PENDING | |
| U-14 | No-show with a saved card charges once | Staging: saved test card, mark session no-show → one PaymentIntent on the connected account, invoice `paid`, one recovery row | PENDING | |
| U-15 | Double click on "No-show" does not charge twice | convex-test: call the no-show path twice → one fee invoice (existing `alreadyBilled` guard), one `chargeFee` | PENDING | |
| U-16 | Declined card leaves the invoice open and tells the team | Staging, card 4000 0000 0000 0341 → invoice stays open, team notified, no recovery row (if decision 2a) | PENDING | |
| U-17 | Auto-charge off (if decision 3 = per-studio switch) means no charge even with a card | convex-test: switch off → no `chargeFee` scheduled | PENDING | |
| U-18 | Recovery is recorded only when paid (decision 2a) | convex-test: no-show without card → no recovery row; pay invoice → recovery row | PENDING | |
| U-19 | No-show email says what really happened | Snapshot test of the email body for "charged" and "invoice to follow" cases | PENDING | |
| U-20 | Toast and pricing copy no longer promise an automatic charge before this ships | Read `card-capture.tsx` toast and `pricing.ts` rows on the release | PENDING | |
| U-21 | Must-not-break list passes | Full suite plus staging smoke: book with deposit, pay invoice link, sub-account add card | PENDING | |
