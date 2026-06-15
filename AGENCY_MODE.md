# Agency Mode — GoHighLevel-style control plane

Design record for the agency build-out (2026-06-14). What it adds on top of the
existing agency console (sub-account CRUD, feature toggles, staff scoping, demo).

## Goal

1. **Agency price book.** An agency defines the plans its sub-account studios pay
   for — name, price, interval, trial length. (GHL "SaaS Mode" rebilling.)
2. **First-adopter promo.** A free tier with a countdown timer; when the timer
   runs out the studio must add a payment method or the app locks.
3. **Trial enforcement.** Expired trial + no card → studio is gated until a card
   is on file. Agency operators acting-as are exempt (they fix it).
4. **Agency settings hub** + plan/billing surfaces in the console.

## Data model

### `agencyPlans` (new) — the agency's price book
`agencyId, name, description?, priceCents, billingInterval(month|year),
trialDays, requireCardAfterTrial, isPromo, promoEndsAt?, isDefault, active,
featureCaps?, stripePriceId?, createdAt`. Indexes: `by_agency`, `by_agency_active`.

### `orgs` (extended) — per sub-account billing state
`agencyPlanId?, billingStatus?(trialing|active|past_due|comped|canceled),
trialStartedAt?, trialEndsAt?, paymentMethodOnFile?, priceCentsOverride?,
billingCustomerId?, billingSubscriptionId?, billingNote?`.

## State machine (assignPlan)

- price 0 & not promo → **comped** (free forever)
- trialDays > 0 → **trialing** (trialEndsAt = now + days)
- else → **active** if card on file, else **past_due**

Daily cron `sweepTrials`: trialing past trialEndsAt → **active** if card else
**past_due** (locked when the plan requires a card). Owner notified by email.

`billingGate(org, plan)` (pure): returns `{ locked, reason, trialDaysLeft }`.
Locked only when `past_due` AND the plan requires a card AND no card on file.

## Backend
- `convex/agencyPlans.ts` — price-book CRUD (gated billing.edit), seed starter.
- `convex/agencyBilling.ts` — assignPlan, comp, extendTrial, setPriceOverride,
  startPaymentSetup (Stripe Checkout setup-mode; simulate when Stripe unset),
  subaccountBilling (agency view), myBilling + startMyPaymentSetup (studio
  self-serve), markPaymentMethodOnFile (internal), _sweepTrials (cron).
- `convex/lib/billingGate.ts` — pure gate + trial-days math (unit-tested).
- `billingWebhooks.ts` — checkout.session.completed `{kind:"subaccount_billing"}`
  → markPaymentMethodOnFile.
- `orgs.current` returns a `billing` block so the studio shell can gate.

## UI
- `/agency/plans` — price-book manager (create promo/free + paid plans, default,
  trial length, require-card).
- `/agency/settings` — agency hub (display name, support email, billing defaults,
  link to branding).
- `/agency/[orgId]` — "Plan & billing" section (plan, status, trial countdown,
  effective price; change plan / comp / extend / override / send add-card link).
- Studio shell — trial countdown banner + hard "add payment method" lock gate.
- Nav — Plans + Settings added to the console header.

## Caps
Reuses `billing.read` / `billing.edit` (already on owner/admin/billing roles) and
`agency.viewAll`. No new capability strings required.
