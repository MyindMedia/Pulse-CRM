## Why

Owner rule: every paid plan must actually be charged. Trials take a card up front and Stripe charges it when they end; the Beta plan is the only card-free path (365 days).

The trial-requires-card change (D10 in its design.md) left one gap open. A paid agency plan with no trial still used the old "add a card" flow: Stripe Checkout in setup mode saved a card, `_markPaymentMethodOnFile` marked the studio `active`, and no subscription was ever created. Nothing charged the card, ever. Assigning such a plan to a studio that already had a card also marked it `active` on the spot.

## What Changes

- **Every paid plan opens a real subscription.** `needsSubscriptionCheckout` (was `needsTrialCheckout`, alias kept) sends every paid, non-Beta, non-comped plan with no live subscription to the shared builder in `convex/lib/trialCheckout.ts`: subscription mode, `payment_method_collection: "always"`, the plan's Stripe price (or inline price data), no trial for a no-trial plan. Stripe charges the price when Checkout completes and renews it.
- **Not active until Stripe says so.** Assigning a paid plan (trial or not) parks the studio in `pending_card`, card on file or not. Opening Checkout changes nothing. The studio becomes `active` only when `checkout.session.completed` (metadata `kind: "subaccount_plan"`) schedules `trialBilling.syncOrgSubscription`, or `customer.subscription.created/updated` arrives, and the subscription is `active`. An `incomplete` first payment leaves the studio where it was.
- **A saved card alone never activates a paid plan.** `_markPaymentMethodOnFile` (setup mode) records the card and customer but leaves the status alone on a paid plan. Setup links opened before deploy and completed after land here.
- **One trial per studio.** `trialForOrg` gives a fresh trial only to `pending_card`; a card-only `active` studio, `past_due` or `canceled` is charged on subscribe.
- **Double-charge protection, stronger.** Existing guards kept (`assertNoLiveSubscription`, webhook duplicate cancel, `assignPlan` refusal). New: the last Checkout id is stored on the org (`billingCheckoutSessionId`). Opening a new one expires it if still open, and refuses if it already completed with a live subscription (covers the gap before the webhook lands). "Add a card" on a paid plan with a live subscription refuses and points to the billing portal instead of saving a card.
- **Studios the old flow left behind** (paid plan, `active`, no subscription): read-only report `agencyBilling:cardOnlyStudiosReport` (ids only) and `agencyBilling:sendCardOnlyConversionReminders` (dry run unless `{"apply":true}`), a branded "confirm your plan" email that links to `/billing`. Nothing is auto-charged. Their access is not changed.
- **Beta report.** `agencyBilling:betaPlanStudiosReport`: Beta-plan studios with start, end and days left (ids only).
- **UI copy.** `/billing` gets a "Confirm your plan" state; the lock screen and `/billing` say "Start your plan, charged when you confirm" for no-trial plans; the agency console shows "Plan not started" and "Not being charged".

## Impact

- Backend: `convex/agencyBilling.ts`, `convex/lib/trialCheckout.ts`, `convex/billingWebhooks.ts`, `convex/schema.ts` (two optional fields), `convex/lib/emailTemplates/trialEmails.ts`.
- Frontend: `src/app/billing/page.tsx`, `src/app/billing/added/page.tsx`, `src/components/shell/billing-gate.tsx`, `src/components/agency/subaccount-billing.tsx`.
- Tests: `convex/agencyPaidPlanCharges.test.ts` (21 tests).
- Stripe: no objects created or changed by this work. No new webhook event types beyond the ones trial-requires-card already needs.
- Data: no migration. Existing `active` card-only studios keep access until they confirm or the owner decides otherwise.
