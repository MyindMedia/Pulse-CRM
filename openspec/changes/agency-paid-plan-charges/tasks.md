## 1. Rules (pure)

- [x] 1.1 `isPaidPlan`, `isActiveWithoutSubscription` in `convex/lib/trialCheckout.ts`; `initialBillingFor` parks every paid plan in `pending_card`

## 2. Backend

- [x] 2.1 Schema (additive): `orgs.billingCheckoutSessionId`, `orgs.planConfirmReminderSentAt`
- [x] 2.2 `agencyBilling.needsSubscriptionCheckout` (alias `needsTrialCheckout`), `trialForOrg` one trial per studio, `buildSubscriptionCheckout` for no-trial plans (`kind: "subaccount_plan"`)
- [x] 2.3 `settlePriorCheckout` + `_recordCheckoutSession`; refuse setup mode on a live paid subscription
- [x] 2.4 `_markPaymentMethodOnFile` never activates a paid plan
- [x] 2.5 `billingWebhooks`: accept `subaccount_plan` on `checkout.session.completed`
- [x] 2.6 `cardOnlyStudiosReport`, `sendCardOnlyConversionReminders` (dry run default), `betaPlanStudiosReport`
- [x] 2.7 `planConfirmSubject` / `planConfirmHtml` (brandEmail)

## 3. Frontend copy

- [x] 3.1 `/billing` "Confirm your plan" state and no-trial "Start your plan" copy
- [x] 3.2 Lock screen copy for no-trial plans; `/billing/added` mentions the immediate first charge
- [x] 3.3 Agency console: "Plan not started", "Not being charged", plan hint

## 4. Tests

- [x] 4.1 `convex/agencyPaidPlanCharges.test.ts`: rules, assign, checkout params, webhook-only activation, incomplete payment, setup-mode save, card-only confirm, demo path, duplicate guards, Beta untouched, reports, reminder dry run and apply
- [x] 4.2 Existing `trialRequiresCard`, `agencyBilling`, `betaClock` suites still green
- [x] 4.3 `npx tsc --noEmit`, eslint on changed files, full vitest

## 5. Owner steps (not done here)

- [ ] 5.1 Confirm the platform webhook endpoint sends `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted` (trial-requires-card 5.1)
- [ ] 5.2 Set `stripePriceId` on every paid agency plan
- [ ] 5.3 After deploy: run the runbook in design.md (report, dry run, apply), then decide on `manual` rows
- [ ] 5.4 Decide the grace period before unconfirmed card-only studios are moved to `pending_card`
