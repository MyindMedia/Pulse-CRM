## Context

Public trial path today: `SubscribeButton` -> `billing.beginPublicCheckout({tier, interval})` (anonymous action, no DB write) -> Stripe hosted Checkout (collects email + studio name) -> `/welcome/activate`. The webhook `checkout.session.completed` (kind `platform_signup`) emails the activation link. Nothing records a checkout that is never finished, and `lib/email.ts` cannot set headers.

## Goals / Non-Goals

**Goals:** know every person who reaches checkout, follow up with them by email under clear consent rules, stop the moment they convert or opt out, and show the owner the list.

**Non-Goals:** ad pixels, a cookie banner, SMS, Clerk webhooks, Stripe's own consent/recovery features.

## Decisions

1. **Lead row before Checkout.** `beginPublicCheckout` gains `email`, `studioName`, `consent`, and an optional `country`. It upserts a `signupLeads` row through an internal mutation, then creates Checkout with `customer_email`, a `studio_name` default value, and `leadId` in session + subscription metadata. *Alternative:* Stripe `consent_collection` + `after_expiration.recovery`. Rejected: it only captures people who typed their email into Stripe AND ticked a box.
2. **Resume = fresh session.** Reminder links point to `/start/<token>`, which calls `signupLeads.resume({token})`, creating a new Checkout for the lead's tier and interval. Stripe sessions expire after 24h, and our link should work on day 4.
3. **Consent recorded per lead, enforced server-side in the sweep.** The form learns the country from `/api/geo` (Netlify's `x-nf-geo` header, falling back to `x-country`). If the country is unknown or in EU/EEA/UK/CH, the form shows an unticked opt-in box. The server re-derives what to store: an EU or unknown country without the box ticked is stored as `none`. A visitor can only lie about their own country to get reminders they asked for, so client-reported geo is acceptable.
4. **Sweep cron every 15 minutes** over the index `by_status_next` (`status`, `nextNudgeAt`). It reads `TRIAL_NUDGES_LIVE` first and returns if it is not `true`, so leads stay due without advancing. It skips leads older than 7 days (marks them `stale`) and anything with consent `none`. Each send advances `nudgesSent` and `nextNudgeAt` in the same mutation that claims the row, then an action sends the email, so a retry cannot double-send.
5. **Unsubscribe.** A per-lead random token (32 hex). The `/unsubscribe/<token>` page calls a public mutation. A Convex HTTP POST route `/signup/unsubscribe?t=` serves RFC 8058 one-click (`List-Unsubscribe-Post: List-Unsubscribe=One-Click`). Unsubscribing sets `unsubscribedAt` on every lead with that email, and new leads for an unsubscribed email start as `unsubscribed`.
6. **`sendEmail` gains optional `headers`**, passed to Resend's `headers` field. Existing callers are unchanged.
7. **Conversion.** The webhook's `platform_signup` branch calls `signupLeads._markConverted({leadId?, email})` before the activation email.
8. **Admin view.** `signupLeads.list` returns rows only when `resolveViewer` is an agency member of the platform agency (`platformAgencyId`). The page lives at `/agency/signups` with a link from the agency home.

## Risks / Trade-offs

- **Someone types another person's email** -> that person gets at most 3 reminders, each with one-click unsubscribe. One open lead per email, and the schedule resets only on a new start. Accepted. This is the standard abandoned-cart risk.
- **Public action spam** creates lead rows. Bounded by one row per email and Stripe's own rate limits on session creation. If abuse appears, add Turnstile.
- **The extra form step may lower click-through.** The form is two fields inside a dialog that the button already opens, and checkout is prefilled.
- **The geo header may be missing in some Netlify paths** -> the visitor is treated as unknown and shown the opt-in box. Compliant by default.

## Migration Plan

Additive table and fields, so no backfill. Deploy Convex prod after merge. Emails stay off until `npx convex env set TRIAL_NUDGES_LIVE true` with the owner's OK. Rollback: unset the env and revert the PR. The table can stay.
