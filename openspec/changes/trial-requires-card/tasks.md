## 1. Rules (pure)

- [x] 1.1 `convex/lib/trialCheckout.ts`: checkout builder (card always, trial days or trial_end, cancel without a card), plan predicates, `initialBillingFor`, subscription mirror, duplicate guard, grandfather predicate
- [x] 1.2 `convex/lib/billingGate.ts`: `pending_card` gate, `canceled` paywall, Beta-plan paywall, live subscription clears the beta stop, `trialCardRequiredBy`
- [x] 1.3 `convex/lib/pricing.ts`: `PLATFORM_TRIAL_DAYS`, `BETA_TERM_DAYS`, `TRIAL_TERMS`; `convex/lib/plans.ts`: `betaTermMs`

## 2. Backend

- [x] 2.1 Schema (additive): `pending_card`, `trialCardRequiredBy`, `trialCardReminderSentAt`, `trialWillEndNotifiedAt`, `agencyPlans.isBeta`, `agencies.trialWillEndNotifiedAt`
- [x] 2.2 `agencyPlans`: refuse card-free trials, force card on paid trials, pin `isBeta`
- [x] 2.3 `agency.provision` and `agencyBilling.assignPlan`: no local trial for paid plans; refuse plan change on a live subscription
- [x] 2.4 `agencyBilling`: trial Checkout for paid trial plans (fresh, grandfathered, resubscribe), `openMyBillingPortal`, Stripe-only `extendTrial`, sweep skips Stripe trials
- [x] 2.5 `billing`: platform checkouts through the builder; `beginBetaConversionCheckout`
- [x] 2.6 `billingWebhooks`: `subaccount_trial` / `beta_conversion` completion, org subscription mirror, `trial_will_end`
- [x] 2.7 `trialBilling`: sync, apply, duplicate cancel, Stripe trial extension, trial-will-end email + record, grandfather report and reminders
- [x] 2.8 `betaClock`: 365 days, Beta-plan studios, skip subscribed, closest-threshold reminders, `/billing` link

## 3. Frontend and copy

- [x] 3.1 New `/billing` page (outside the app shell, reachable while locked)
- [x] 3.2 Billing banner and lock: charge date and price, reason-specific lock, beta picker on the beta checkout
- [x] 3.3 Agency console: pending card row, Stripe-only extend, plans page hints
- [x] 3.4 /pricing FAQ, /mypulse sheet, preview, billing-added page, beta and trial emails

## 4. Tests

- [x] 4.1 `convex/trialRequiresCard.test.ts` (30 tests): checkout params, no trial without checkout, webhook mirror, trial_will_end, duplicate guard, studio checkouts, beta term, paywalls, reminders, conversion, grandfathering
- [x] 4.2 Updated `agencyBilling.test.ts` and `betaClock.test.ts` for the new rules
- [x] 4.3 `npx tsc --noEmit`, eslint on changed files, full vitest

## 5. Owner steps (not done here)

- [ ] 5.1 Enable `customer.subscription.created`, `.updated`, `.deleted`, `.trial_will_end` on the live platform webhook endpoint
- [ ] 5.2 Confirm `STRIPE_PRICE_GROWTH_MONTHLY` is the current Growth price; archive the old $199 Growth price
- [ ] 5.3 Customer portal: allow cancel and payment method update
- [ ] 5.4 Before deploy: count Beta-plan studios outside the cohort (they now lock at the end of their window)
- [ ] 5.5 After deploy: run the grandfather report, then the reminder dry run, then `{"apply":true}` (design.md D8)
- [ ] 5.6 Decide D6: keep the deferred first charge for early beta subscribers, or flip to charge on subscribe
