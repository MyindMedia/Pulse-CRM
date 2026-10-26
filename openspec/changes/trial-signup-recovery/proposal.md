## Why

Since the 14-day card trial went live (2026-10-10), every public checkout that was not the owner's own test expired without Pulse ever learning who it was: the pricing button opens Stripe anonymously and Pulse only sees an email after payment. People who get as far as checkout and stop are the warmest leads Pulse has, and today they leave no trace.

## What Changes

- "Start free trial" asks for email and studio name on Pulse first, saves a **Signup Lead**, then opens Stripe Checkout with the email prefilled.
- A lead converts when its checkout completes. Leads that have not converted get up to 3 reminder emails (1 hour, day 1, day 4) with a resume link that opens a fresh checkout.
- Consent: a notice under the email field for most visitors. EU/EEA/UK visitors (by Netlify geo) get an unticked opt-in box, and without it they get no emails. Every email has one-click unsubscribe.
- Reminder emails are off until `TRIAL_NUDGES_LIVE=true` is set on Convex. Lead capture and the agency list are live immediately.
- Agency admin gets an "Unfinished sign-ups" page: who started, tier, when, consent, emails sent, converted or unsubscribed.
- The privacy policy describes reminder emails and how to stop them.

## Capabilities

### New Capabilities
- `signup-recovery`: capturing trial sign-up intent before checkout, following up with people who did not finish, and the platform owner's view of them.

### Modified Capabilities
<!-- none: no main specs exist yet for billing -->

## Impact

- Convex: new `signupLeads` table; `billing.beginPublicCheckout` gains email, studio name and consent; new `signupLeads.ts` (start, resume, unsubscribe, sweep, admin list); webhook marks leads converted; cron every 15 minutes; `lib/email.ts` accepts headers; HTTP route for one-click unsubscribe POST.
- Web: subscribe button becomes a small form; `/start/[token]` resume page; `/unsubscribe/[token]` page; `/agency/signups` page; privacy policy text.
- Env: `TRIAL_NUDGES_LIVE` (Convex prod), off by default.
- No new vendors. Emails go through Resend, which already sends Pulse mail.
