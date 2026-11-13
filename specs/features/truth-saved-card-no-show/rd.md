# RD: Saved card and charging a no-show (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit ids covered: `money-reporting-saved-card`, `bookings-clients-card-never-saved`, `public-copy-card-on-file-autocharge`, `bookings-clients-noshow-charge`.
Code read on `develop` at the time of writing (2026-11-12).

## What Pulse says
- Core tagline: "Book it, hold the card, get paid." (`convex/lib/pricing.ts:80`)
- Price list row "Saved card": "You can charge it later without asking again, for example for a missed session." (`convex/lib/pricing.ts:507`, text at `:834-836`)
- Price list row "Charge for a missed session": "Pulse charges the saved card for the missed session" (`convex/lib/pricing.ts:530`, text at `:904-906`)
- Comparison page: "Card on file, policy, auto-charge, waitlist" (`src/app/vs/page.tsx:59`); marketing tiers: "Card on file and no-show protection" (`src/components/marketing/pricing-tiers.ts:25`)
- In the app, after a staff member types a client's card: "Card saved. No-show and late-cancel fees can be charged to it." (`src/components/payments/card-capture.tsx:156`)

## What actually happens today
1. Staff open a client's profile and add a card. Pulse creates a Stripe SetupIntent on the studio's connected account (`convex/cardOnFile.ts` `createSetupIntent`), Stripe confirms it, and the card is attached to the Stripe customer.
2. Nothing tells Pulse. The only code that writes `artists.defaultPaymentMethodId` is `_savePaymentMethod` (`convex/cardOnFile.ts:63`), and nothing calls it (search of `convex/` and `src/`: only its definition and the header comment at `convex/cardOnFile.ts:24-27`, which says the step "is not built yet"). The Stripe webhook has no `setup_intent.*` branch (`convex/billingWebhooks.ts`).
3. So the client profile keeps showing no card (`src/app/(app)/roster/[id]/page.tsx`, `hasCard={Boolean(data.defaultPaymentMethodId)}`), and the no-show charge never runs: `canAutoCharge` requires `artist.defaultPaymentMethodId` (`convex/sessions.ts:622-627`), so `cardOnFile.chargeFee` is never scheduled.
4. What does run on a no-show or late cancel: a fee invoice is created with status `draft` (`convex/sessions.ts:509-541`), the recovery ledger records the fee as recovered straight away (`convex/sessions.ts:609-616`), and the client is emailed "We have sent an invoice for the ... balance" (`convex/sessions.ts:645-651`) although the invoice is still a draft that nobody sent.
5. On a 3-D Secure card the browser is redirected and `onSaved` in `card-capture.tsx` never runs at all.

## Who is hurt and how
- **Studios** pay for Core partly for "hold the card, get paid", are told the card is saved, and never collect a no-show fee from it. Their recovery numbers count fees as won back that nobody paid.
- **Clients** get an email saying an invoice was sent when it was not.
- Nobody is charged wrongly today: the failure is that no charge happens.

**Can it be happening in production now?** Yes, for every studio. How the owner can check without code: in the Convex dashboard for production, `artists` table, filter `defaultPaymentMethodId` is set: expect none (or only seed rows). In each studio's Stripe connected account, Customers will show saved cards that Pulse does not know about. `recovery` rows with `kind` "no_show_fee" / "cancellation_fee" whose linked invoice is still `draft` are fees counted as recovered but never paid.

## Cause (verified on develop)
- `convex/cardOnFile.ts:24-27` header: the save step is a known follow-up.
- `convex/cardOnFile.ts:61-75` `_savePaymentMethod`: no caller.
- `src/components/payments/card-capture.tsx:137-158`: `confirmSetup` then a toast, no server call.
- `convex/billingWebhooks.ts:122-528` `handle`: no `setup_intent.succeeded` branch.
- `convex/sessions.ts:609-616`: recovery recorded before payment.
The audit descriptions are correct.

## Proposed fix (smallest correct change)
1. **Server-side save from the Stripe webhook, never from the browser.** In `convex/billingWebhooks.ts` `handle`, add a branch for `setup_intent.succeeded` on a connected account (`event.account` set):
   - find the artist by `si.customer` (needs an index `artists.by_stripe_customer`, see schema below),
   - check `connectedAccountOwnsOrg(ctx, event.account, artist.orgId)`,
   - check `si.status === "succeeded"`, `si.usage === "off_session"` and that `si.payment_method` is a string,
   - patch `defaultPaymentMethodId` (reuse `_savePaymentMethod`'s body as a helper), write an activity row, `markProcessed`.
   - On mismatch, `markProcessed(..., ".account_mismatch")` as the other branches do.
   This covers the 3-D Secure redirect too. Never accept a payment method id sent by the browser.
2. Tag the SetupIntent with `metadata: { kind: "card_on_file", artistId, orgId }` in `createSetupIntent` (`convex/cardOnFile.ts:~122`) and require it to match in the webhook, so a SetupIntent made by something else on the studio's Stripe account (for example the studio's own tools) cannot attach a card to a Pulse client.
3. `card-capture.tsx`: change the toast to "Card sent to Stripe. It shows as saved here in a few seconds." and let the profile flip to "Saved" from the live query.
4. Move `recovery.record` for the fee from `sessions.ts:609` to the moment the fee is actually paid (`cardOnFile._markFeePaid` and the invoice-paid path), or record it with a "pending" state. Owner decides (see below).
5. Fix the no-show email wording to match what happened ("We will send you an invoice" when it is a draft, "We charged your card ending 4242" when the charge succeeded).

Files: `convex/billingWebhooks.ts`, `convex/cardOnFile.ts`, `convex/sessions.ts`, `convex/schema.ts`, `src/components/payments/card-capture.tsx`, tests in `convex/cardOnFile.test.ts` (new) and `convex/billing.test.ts`.
**Schema:** add index `by_stripe_customer` on `artists` (`stripeCustomerId`). Additive, no data migration.
**Stripe configuration:** the Connect webhook endpoint must be subscribed to **both** `setup_intent.succeeded` (a card staff add with "Add a card") **and** `payment_intent.succeeded` (the card a client saves at checkout under the agreement, and settling a no-show fee charge whose action never heard back). Without `payment_intent.succeeded`, cards saved at checkout are never recorded and no fee is ever charged (it fails safe, but the feature does not work). The owner checks this in the Stripe dashboard (Developers, Webhooks, the Connect endpoint) for staging first, then production.
**One-time data correction:** cards already saved on Stripe customers are unknown to Pulse. Options: leave them (staff re-add cards), or a one-off script that lists each connected account's customers' payment methods and fills `defaultPaymentMethodId`. Recommend leaving them: a card typed months ago without a clear "you may charge this later" consent is the wrong card to start charging automatically.

## Decisions for the owner
1. **Consent wording before the first automatic charge.** Off-session charging needs the client's permission. Options: (a) staff tick "Client agreed to be charged for no-shows under the studio's policy" before saving; (b) clients save their own card from a link with the policy shown; (c) both. Recommend (b) with (a) as a fallback for walk-ins.
2. **Recovery ledger.** (a) record only when paid (recommended); (b) record as pending and flip to recovered on payment.
3. **Auto-charge switch.** Should a studio have to turn auto-charge on per studio (default off) once cards really save? Recommend yes, default off, so the first real charges are a deliberate choice.

## Interim step (no money logic)
Ship the B1 wording change now: tagline to something like "Book it, take the deposit, get paid."; "Saved card" and "Charge for a missed session" marked `built: false` (or reworded to "Bill a no-show fee"); the vs-page row and pricing-tiers line reworded; the toast changed to "Card added in Stripe. Pulse cannot charge it automatically yet." This removes the false promise without touching how money moves.

## Risk
- A bug in the webhook branch could attach a card to the wrong client (wrong account, wrong customer). The account check, metadata check and customer lookup are the guards; tests must cover each.
- Turning this on makes `chargeFee` live for the first time: real off-session charges on the studios' Stripe accounts. `chargeFee` has never run in production, so it must get its own tests (amount, idempotency, failure path) before the save goes live.
- **Rollback:** remove the webhook branch (cards stop saving, behaviour returns to today) and, if charges misfire, clear `defaultPaymentMethodId` on affected artists, which stops `canAutoCharge` immediately. Refunds for any wrong charge are done in the studio's Stripe dashboard.

## Round 2: review findings fixed (2026-11-12)
Owner decisions applied (from `docs/feature-truth/HIGH-RISK-BUILD.md`, round 2, #205):
- The saved card is charged automatically **only for a no-show**, never for a cancellation of any kind. A late cancel stays a drafted invoice that staff choose to send (H205-02, H205-04).
- The charge is never more than the fee minus everything the client already paid for that session (deposit or more). If they paid at least the fee, nothing is charged and no fee invoice is raised (H205-01, H205-03).
- The charge runs no sooner than 15 minutes after staff mark the no-show (`NO_SHOW_CHARGE_DELAY_MS`). Undoing the no-show in that time cancels it. A session that had not started when it was marked a no-show is never auto-charged (H205-07).

Other fixes: a Stripe customer from a previous or test-mode connection is never reused, and checkout never blocks payment over saving a card (H205-05, H205-06); a charge whose action died is checked against Stripe 15 minutes later and settled or surfaced (H205-08, H205-09); a late fee-charge webhook on an invoice already paid or voided another way, or for a different amount, alerts staff (H205-10, H205-11); the Stripe configuration above names both events (H205-12).

New optional fields: `artists.stripeCustomerAccountId` (the account the customer was made or confirmed on), `sessions.noShowFeeInvoiceId`. No data correction is needed: a legacy customer id with no account recorded is checked with Stripe the next time it is used.
