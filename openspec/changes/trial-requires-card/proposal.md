## Why

Owner rule, 2026-10-07: "For the pricing for trials, users must enter a card. It will auto charge on renewal after the trial period. Beta is the only one that doesn't require a payment, but will require payment after the term, 365 days."

Today a trial on an agency plan starts locally the moment a plan is assigned, with no card and no Stripe subscription. Nothing charges at the end; the studio either keeps going on `past_due` or hits a lock screen, depending on a per-plan switch. The beta has a lock at its end, but the plan picker on that lock opens a checkout that is not tied to the studio, so a beta studio that pays stays locked. Studios auto-enrolled on the Beta plan by an agency (not in the signed cohort) never lock at all, and the beta year was 360 days, not 365.

## What Changes

- Every trial starts in Stripe Checkout, subscription mode, with `payment_method_collection: "always"`, the plan's `trial_period_days` (or a promised `trial_end`), and `trial_settings.end_behavior.missing_payment_method: "cancel"`. The card is saved at the start and Stripe charges it when the trial ends, then the plan renews normally.
- A paid trial plan no longer starts a trial when assigned. The studio waits in a new `pending_card` status (a "start your trial" screen) until Checkout completes. The webhook then mirrors Stripe's trial window into `orgs.trialEndsAt`. Stripe is the source of truth.
- A free plan with a trial (a card-free trial) can no longer be created, updated into, set as default or assigned.
- `customer.subscription.trial_will_end` (3 days out) emails the owner in the Pulse client layout and records it.
- The beta stays card-free for its whole term (365 days). At the end, a paywall (`beta_expired`) until they add a card and pick Core, Growth or Max. Reminders at 30, 7 and 1 days out link to a new `/billing` page that opens the beta's own checkout. Subscribing early does not charge early: the first charge is deferred to the end of the term.
- Double-charge guards: no second checkout while a live subscription exists, the webhook cancels any duplicate, and the agency cannot move a live-subscribed studio to another plan.
- Trials that started card-free before this change are grandfathered: they keep running, are listed by a report query (ids only), and get one "add a card before your trial ends" email that sets `trialCardRequiredBy`.
- Copy on /pricing, /mypulse, the agency console, billing screens and beta emails says a card is required to start a trial, it renews automatically, cancel before the trial ends, and the beta is free for 365 days with no card and payment after.

## Audit: every place a trial starts or is shown

| Path | Before | Card-free? | Stripe-backed? | Change |
|---|---|---|---|---|
| `convex/agency.ts` `provision` (~338) | Auto-enrolls the default plan; `trialDays > 0` sets `trialing`, `trialEndsAt = now + days` | Yes | No | Goes through `initialBillingFor`: Beta plan keeps its card-free window; a paid trial plan lands in `pending_card`; a legacy card-free default is skipped |
| `convex/agencyBilling.ts` `planTransition` / `assignPlan` | Same local trial on assign | Yes | No | Same rule; card-free trial plans refused; plan change refused while a live Stripe subscription exists |
| `convex/agencyBilling.ts` `extendTrial` | Pushes `trialEndsAt` locally, re-opens a lapsed trial | Yes | No | Only a Stripe-backed trial, only in Stripe (`_extendStripeTrial`), webhook mirrors back. Beta and card-free refused |
| `convex/agencyBilling.ts` `startPaymentSetup` / `startMyPaymentSetup` | Setup-mode Checkout: saves a card, marks `active` | n/a | Card only, no subscription | Paid trial plans (pending, grandfathered, or canceled Stripe plan) open a subscription Checkout with the trial; other cases keep setup mode |
| `convex/agencyBilling.ts` `_sweepTrials` | Flips lapsed local trials (not scheduled in `crons.ts`) | Yes | No | Skips Stripe-backed trials; grandfathered trials owe a card |
| `convex/agencyPlans.ts` `create` / `update` / `setDefault` | Any trial on any plan; card switch optional | Allowed | No | Rejects card-free trials; paid trials always `requireCardAfterTrial`; Beta plan pinned with `isBeta` |
| `convex/agencyPlans.ts` `insertStarterPlans` (~215) | Beta 365 days no card; EA and standard `trialDays: 0` | Beta only | No | Unchanged terms; `isBeta: true`, copy updated |
| `convex/billing.ts` `beginCheckout` (~91) | Subscription mode, no trial, bills on subscribe | No | Yes | Built by `buildSubscriptionCheckoutParams` (card always), `PLATFORM_TRIAL_DAYS = 0` |
| `convex/billing.ts` `beginPublicCheckout` (~172) | Same, pay-first signup | No | Yes | Same |
| `src/components/shell/billing-gate.tsx` `BetaPlanPicker` | Called `beginCheckout`: new agency customer, nothing tied to the studio, lock never cleared | n/a | Yes, wrong target | New `billing.beginBetaConversionCheckout` tied to the org |
| `convex/billingWebhooks.ts` | `checkout.session.completed` handled setup mode only; `customer.subscription.*` only for agencies; no `trial_will_end` | n/a | Partial | New branches for `subaccount_trial` / `beta_conversion`, org subscription mirror, `trial_will_end` |
| `convex/lib/billingGate.ts` | `trialing` open until the end; `canceled` never locked; Beta-plan non-cohort never locked | Yes | No | `pending_card` gate, `canceled` paywall when Stripe-backed, Beta-plan paywall, a live subscription clears the beta stop |
| `convex/betaClock.ts` | 12 x 30 = 360 days; warnings for cohort only; link `/settings?tab=billing` | Beta | No | 365 days (`betaTermMs`), Beta-plan studios included, subscribed skipped, link `/billing` |
| `convex/betaLicense.ts`, `convex/betaAccess.ts` | Grant sets `trialing`, no card, clock starts later | Beta | No | Unchanged (the exception) |
| `convex/lib/plans.ts`, `convex/lib/tier.ts`, `convex/lib/stripe.ts` | Beta name, tier and price ids | n/a | n/a | `betaTermMs` added; otherwise unchanged |
| `convex/schema.ts` | `billingStatus` without a pending state | n/a | n/a | `pending_card`; `trialCardRequiredBy`, `trialCardReminderSentAt`, `trialWillEndNotifiedAt` on orgs; `isBeta` on plans; `trialWillEndNotifiedAt` on agencies |
| `src/app/pricing/model.ts` (FAQ) | No trial answer; beta "12 months", no payment wording | n/a | n/a | "Is there a free trial?" from config; beta FAQ says 365 days, no card, payment after |
| `src/app/mypulse/features.ts` | "with free trials" | n/a | n/a | Card required at the start, renews automatically, beta the one no-card plan |
| `src/app/agency/plans/page.tsx` | "Free trial / promo days ... before a card is needed"; stale "30 days free" seed copy | n/a | n/a | Card required to start, Stripe charges at the end; seed copy matches the book |
| `src/components/agency/subaccount-billing.tsx` | "Extend trial" for anyone; "Assigning a plan starts its trial" | n/a | n/a | Extend only on Stripe-backed trials; pending card row; hint rewritten |
| `src/components/shell/billing-gate.tsx` banner and lock | "Free trial" countdown, add a card | n/a | n/a | Charge date and price, reason-specific lock copy |
| `src/app/onboard/page.tsx`, `/pricing` `SubscribeButton` | "Month to month. Cancel any time." / "Start with X", no trial | No | Yes | Unchanged: they bill on subscribe, true as written |
| Emails: `betaEnding`, `betaWelcome`, new `trialEmails` | Beta "free year", "Choose your plan" | Beta | n/a | 365 days, no card, payment after; "Add a card and pick a plan" |
| `src/app/preview/page.tsx` | "nothing ... deleted or locked away" | Beta | n/a | Payment required after the term, nothing deleted |

## Impact

- Backend: `convex/lib/trialCheckout.ts` (new, pure), `convex/trialBilling.ts` (new), `agencyBilling.ts`, `billing.ts`, `billingWebhooks.ts`, `agencyPlans.ts`, `agency.ts`, `betaClock.ts`, `lib/billingGate.ts`, `lib/plans.ts`, `lib/pricing.ts`, `schema.ts` (additive only), email templates.
- Frontend: new `/billing` page; billing gate, agency billing, plans page, pricing FAQ, mypulse sheet, preview, billing-added copy.
- Stripe: five webhook event types on the platform endpoint (see design.md). No Stripe objects were created or changed by this work.
- Data: no migration. Existing rows are read as before; grandfathered trials keep running.
