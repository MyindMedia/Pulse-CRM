## 1. Data and email plumbing

- [x] 1.1 `signupLeads` table + indexes (`by_email`, `by_token`, `by_status_next`, `by_created`) in schema; add to sub-account deletion only if org-scoped (it is platform-scoped, so it is not)
- [x] 1.2 `lib/email.ts`: optional `headers` passed to Resend
- [x] 1.3 `lib/signupLeads.ts`: consent derivation (EU/EEA/UK/CH list), schedule (1h, 1d, 4d), 7-day cutoff, 180-day retention, token

## 2. Capture and conversion

- [x] 2.1 `beginPublicCheckout` takes email, studio name, consent, country; upserts the lead; prefills Checkout; leadId in metadata
- [x] 2.2 `signupLeads.resume({token})` action: fresh Checkout for the lead
- [x] 2.3 Webhook `platform_signup` marks the lead converted (by leadId or email)

## 3. Reminders and unsubscribe

- [x] 3.1 Sweep (cron every 15 min) gated on `TRIAL_NUDGES_LIVE`; claim-then-send; 3 templates
- [x] 3.2 `unsubscribe` public mutation + HTTP one-click POST route
- [x] 3.3 Email templates (no em dashes, owner voice), List-Unsubscribe headers

## 4. Web

- [x] 4.1 `/api/geo` route
- [x] 4.2 Subscribe button opens an email + studio name dialog with notice or opt-in box
- [x] 4.3 `/start/[token]` resume page, `/unsubscribe/[token]` page, both in middleware public routes
- [x] 4.4 `/agency/signups` list + link from agency home
- [x] 4.5 Privacy policy: reminder emails + unsubscribe

## 5. Verify and ship

- [x] 5.1 convex-test suite for every spec scenario
- [x] 5.2 tsc, vitest, eslint on changed files, `next build`
- [ ] 5.3 PR, deploy preview checks, merge, Convex prod deploy, live smoke (lead row created, checkout prefilled)
- [x] 5.4 Compliance note + pentest of the new public endpoints
- [ ] 5.5 Send sample emails to the owner, and set `TRIAL_NUDGES_LIVE` only on his OK
