## 1. Accounts

- [x] 1.1 Checkout makes a studio sub-account, not an agency (PR #41)
- [x] 1.2 Agency console only for the Pulse agency (PR #41)
- [x] 1.3 Agency operator with no sub-account entered goes to `/agency` (`AgencyHomeRedirect`)
- [x] 1.4 `/onboard`, `/onboard/done` redirect to `/pricing`; `/vs` link; `billing.beginCheckout` removed

## 2. Locked features

- [x] 2.1 Tier-initial badge on locked rows, link to `/settings?tab=billing`
- [x] 2.2 `orgs.hideLockedFeatures` + `orgs.setHideLockedFeatures` (branding.edit) + Settings > Billing switch
- [x] 2.3 Settings opens the tab named in `?tab=`

## 3. Upgrades

- [x] 3.1 `agencyBilling.changeMyPlan`: portal swap for a live subscription, beta conversion, studio checkout otherwise
- [x] 3.2 Subscription price sets `tier` and the Pulse plan row in `applyOrgSubscription`
- [x] 3.3 Settings > Billing uses `changeMyPlan`

## 4. Tests

- [x] 4.1 `convex/changeMyPlan.test.ts` (11): portal swap, same-plan refusal, studio checkout with trial, no second trial, Stripe outage stops, owner only, price to tier (mutation-checked), hide setting
- [x] 4.2 `npx tsc --noEmit`, eslint on changed files, full vitest (only the 2 failures that also fail on main)
