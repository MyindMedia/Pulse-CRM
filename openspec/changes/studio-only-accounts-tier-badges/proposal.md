## Why

Owner rule, 2026-10-10: "We don't allow agency accounts for any tiers, only I the platform owner has agency accounts. There should only be the sub accounts setup. Any new sign up gets its own new sub account." And: "Remove the sub account Pulse Studio. New accounts get their own sub account and access to the core features. Any other features they don't have should show a grayed out button with a small icon with an initial for the tier. They can get access when they upgrade. In settings they can set up an option to hide items not available in their tier."

Pulse Studio stays (owner's choice) but hidden: Apple's two App Store review logins sign into it.

## What Changes

- **Signup (PR #41, shipped):** checkout provisions a studio under the Pulse agency (`PULSE_AGENCY_ID`), never an agency. The agency console admits only the Pulse agency.
- **Pulse Studio unreachable:** an agency operator with no sub-account entered is sent to `/agency` instead of the demo workspace. Studio members (the review logins) are unaffected.
- **Old agency checkout retired:** `/onboard` and `/onboard/done` redirect to `/pricing`; `/vs` links to `/pricing`; `billing.beginCheckout` deleted.
- **Locked features:** the sidebar's "Locked on your plan" rows carry the initial of the tier that unlocks them (G, M) and link to Settings > Billing (`/settings?tab=billing`).
- **Hide setting:** `orgs.hideLockedFeatures` (leadership, Settings > Billing) hides those rows.
- **Upgrade that works:** Settings > Billing calls `agencyBilling.changeMyPlan`. A live subscription is changed in place in the Stripe portal (`subscription_update_confirm`, prorated upgrade, downgrade at period end): never a second subscription. A beta studio converts through its own checkout. A studio with no subscription gets a studio-scoped checkout (`kind: subaccount_plan`, `orgId`), with the platform trial on its first plan.
- **Tier follows the price:** `applyOrgSubscription` maps the subscription's price to the tier and the Pulse plan row, so a portal upgrade unlocks immediately. A beta studio keeps its Beta plan row until it graduates.

## Non-goals

- Deleting Pulse Studio or its seed data.
- Inline locked rows inside the main nav order (they stay grouped under "Locked on your plan").
- The iPhone app's agency fallback.
