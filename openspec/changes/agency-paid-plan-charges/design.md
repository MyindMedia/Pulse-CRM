## Context

Before this change, three paths could leave a paid agency studio `active` with nothing charging it:

1. `startPaymentSetup` / `startMyPaymentSetup` on a paid plan with `trialDays === 0`: setup-mode Checkout, then the `subaccount_billing` webhook called `_markPaymentMethodOnFile`, which set `billingStatus: "active"`.
2. `assignPlan` / `agency.provision` via `initialBillingFor`: a paid no-trial plan became `active` when `paymentMethodOnFile` was already true (`past_due` otherwise).
3. `markActiveManually` (agency override for offline payment). Kept as is: it is an explicit, recorded agency decision. Those studios show up in the report as `source: "manual"` and are never emailed.

## Decisions

### D1. Every paid plan is a Stripe subscription
`isPaidPlan(plan, override)` = priced (override wins, 0 means free for that studio) and not the Beta plan. `initialBillingFor` puts every paid plan in `pending_card`. `needsSubscriptionCheckout` routes every paid, non-comped studio without a live subscription to `buildSubscriptionCheckout` (renamed from `buildTrialCheckout`), which uses `buildSubscriptionCheckoutParams`. No trial means no trial fields, so Stripe charges on completion. Metadata `kind` is `subaccount_plan` (no trial) or `subaccount_trial`; both are accepted by the webhook.

### D2. Active only from the webhook
Nothing in the action writes billing status. `trialBilling.applyOrgSubscription` (already shared with trials) maps Stripe `active` to `active` with `paidSince`, and leaves `incomplete` alone. In demo (no `STRIPE_SECRET_KEY`) the simulated subscription goes through the same mirror.

### D3. Gate copy, no new gate reason
`pending_card` keeps the `trial_needs_card` reason (locked). The UI reads `plan.trialDays === 0` to say "Start your plan" and "charged when you confirm".

### D4. Double-charge guards
1. `assertNoLiveSubscription(org.billingSubscriptionId)` (unchanged).
2. New `settlePriorCheckout(org.billingCheckoutSessionId)`: open session is expired; completed session whose subscription is live refuses with "already has a subscription"; anything else continues. The id is written by `_recordCheckoutSession` after each create.
3. Webhook `isDuplicateSubscription` keeps the first and schedules `_cancelDuplicateSubscription` (unchanged). For a no-trial plan the duplicate has already charged once: the `billing.duplicate_subscription` activity row is the signal to refund it by hand. Guard 2 makes this case much rarer.
4. `assignPlan` refuses a studio with a live subscription (unchanged).
5. "Add a card" on a paid plan with a live subscription refuses (portal instead) rather than opening setup mode.

### D5. Card-only studios: ask, never charge
`isActiveWithoutSubscription`: `active`, no `billingSubscriptionId`, paid plan, not an unfinished beta cohort. They keep access. The reminder goes only to `source: "stripe_card"` rows (card saved and a Stripe customer exists), once (`planConfirmReminderSentAt`), and links to `/billing`, where "Confirm my plan" opens a no-trial subscription Checkout (charged then). No saved card is ever charged without the owner completing Checkout. A Checkout link is not emailed because it expires in 24 hours.

### D6. Beta untouched
Beta plans are excluded by `isPaidPlan`, so they never reach the subscription path. "Add a card" on the Beta plan stays setup mode and charges nothing; beta-to-paid is still `billing.beginBetaConversionCheckout`.

## Runbook (production, owner runs it; ids and counts only)

```bash
cd ~/Dev/pulse-web
# 1. Who is on a paid plan, marked active, with no subscription (ids, price, source)
npx convex run agencyBilling:cardOnlyStudiosReport --prod
# 2. Dry run: who would get "please confirm your plan"
npx convex run agencyBilling:sendCardOnlyConversionReminders --prod
# 3. Send (once per studio; re-running skips anyone already asked)
npx convex run agencyBilling:sendCardOnlyConversionReminders '{"apply":true}' --prod
# 4. Beta-plan studios: start, end, days left
npx convex run agencyBilling:betaPlanStudiosReport --prod
```

Then decide, per `manual` row in step 1, whether that studio really pays offline. After a grace period of your choosing, any `stripe_card` studio that has not confirmed can be moved with `assignPlan` (which parks it in `pending_card` and locks it until it subscribes). That step is deliberately not automated.

## Stripe webhook events that matter (platform endpoint)

- `checkout.session.completed` with `metadata.kind = "subaccount_plan"` (new kind, existing event): schedules the sync.
- `customer.subscription.created` / `.updated`: carries `metadata.orgId`; `active` activates, `past_due` / `unpaid` mirror to `past_due`.
- `customer.subscription.deleted`: `canceled`, paywalled.
- `invoice.payment_failed` is not handled directly; the failure arrives as `customer.subscription.updated` with `past_due`.

These are the same events trial-requires-card task 5.1 already asks to enable; nothing new to enable if that is done.

## Risks

- **New studios on a paid no-trial default plan now start locked** (`pending_card`) instead of open. Intended by the owner rule; the agency should keep Beta as the default for invites.
- **Re-assigning a plan to a card-only studio locks it** until it subscribes. Same reason.
- **A duplicate no-trial subscription that slips past both guards has already charged once.** It is canceled automatically and logged as `billing.duplicate_subscription`; refund by hand.
- **Inline `price_data`** when a plan has no `stripePriceId` creates a Stripe product per checkout (pre-existing). Set `stripePriceId` on paid plans.
- **No codegen run.** New functions live in an existing module and new schema fields are optional, so `_generated` needed no change; the deploy regenerates anyway.
