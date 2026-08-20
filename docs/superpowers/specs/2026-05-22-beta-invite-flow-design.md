# Beta Invite Flow — Design Spec

**Date:** 2026-05-22
**Project:** Pulse (studio operating system)
**Status:** Approved design — ready for implementation plan

## Problem

For the private beta, every new studio sub-account owner must be able to create
their login from an invitation. Today:

- `convex/agency.ts → createSubaccount` relies on **Clerk's built-in org-invitation
  email**, which is plain and unbranded, and lands on Clerk's hosted page.
- `convex/lib/notify.ts` only **simulates** delivery (writes a `notifications` row
  with `status:"simulated"`); no real email provider is wired.
- Sign-up uses Clerk's generic hosted `<SignUp>` widget, not a Pulse-native screen.

We want a **custom branded HTML invitation email** and a **Pulse-native account-creation
screen**, both matching the approved mockup
(`.superpowers/brainstorm/.../invite-flow-v2.png`).

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Email provider | **Resend** (`op://Security/Resend Pulse/Api` → `RESEND_API_KEY`) |
| Email content | Custom branded HTML, sent from our domain, with our own `/invite/<token>` link |
| Landing screen | **Pulse-native** custom screen (not Clerk's hosted widget) |
| Credential handling | **Clerk** (headless) under the hood; email pre-verified via Clerk **ticket** |
| Invite scope (beta) | **Studio owners only**; team-member invites deferred post-beta |
| Token lifetime | 7 days |
| SSO | Email/password + "Continue with Google" (via Clerk) |
| Sender address | `hello@pulse.studio` (placeholder — confirm at setup; domain must be verified) |

## Architecture & Data Flow

1. Agency owner adds a sub-account → existing `createSubaccount` action runs.
2. Server, in addition to provisioning the Convex org:
   - Creates a **Clerk invitation ticket** for the owner email (Clerk Invitations API).
   - Writes a Convex `invites` row:
     `{ token, orgId, email, ownerName, role:"owner", clerkTicket, status:"pending", expiresAt: now+7d, invitedBy }`.
3. **Resend** sends the branded HTML email containing a link to `…/invite/<token>`.
4. User clicks → `/invite/[token]` route does a **public lookup by token** (no auth)
   and renders the account-creation screen: workspace name shown, email locked, fields
   for name + password, plus "Continue with Google".
5. Submit → Clerk **headless** signup using `strategy:"ticket"` (email already verified,
   so no extra email-code step). Google path uses Clerk OAuth with the same ticket.
6. On success → attach the new Clerk user to the Convex org as **owner**, mark the invite
   `accepted`, redirect to `/dashboard`.

**Why the ticket:** keeps the fully custom screen *and* skips Clerk's email-verification
code step (the token already proves inbox ownership), while Clerk still owns credentials
and the session.

## Components

### Convex
- **`convex/invites.ts`** (new): `invites` table helpers — `issue` (internal), public
  `lookupByToken` query, `accept` mutation (attaches user to org + flips status, guards
  against double-accept / expired / revoked), `revoke` mutation, `list` (agency console).
- **`convex/schema.ts`**: add `invites` table with `by_token`, `by_org`, `by_email` indexes.
- **`convex/lib/email.ts`** (new): real Resend send via `fetch` to the Resend API
  (`RESEND_API_KEY`). Used by the invite path; the simulated `notify()` seam stays for
  other channels until migrated.
- **`convex/lib/emailTemplates/invite.ts`** (new): the branded HTML string (matches mockup
  — dark gold-accented header with PULSE logo, workspace card, single CTA, paste-link
  fallback, deliverability footer with unsubscribe + sender identity).
- **`convex/agency.ts`**: extend `createSubaccount` to (a) create the Clerk ticket,
  (b) issue the Convex invite, (c) send the Resend email. Email failure is non-fatal and
  surfaced for a later "Resend invite" action.

### Frontend
- **`src/app/invite/[token]/page.tsx`** (new): the screen from the mockup. Uses Clerk
  headless hooks (`useSignUp`) with the ticket strategy; locked invited email; name +
  password + Google. Reuses Pulse brand tokens (ink/coal/bone/ash/gold) and `PulseLogo`.
- **Invalid-state UI**: expired / used / revoked / unknown token → friendly "this link is
  no longer valid — ask your admin to resend" screen. Already-registered email → "you
  already have an account — sign in" with a link to `/sign-in`.
- **`src/app/sign-up/[[...sign-up]]/page.tsx`**: beta is invite-only, so replace open
  registration with an "invitation required" message (link to marketing / contact).
  `/sign-in` is unchanged for returning owners.
- **Agency console**: add a "Resend invite" action on a sub-account whose invite is still
  `pending` (calls `issue` again / re-sends email).

## Error Handling

- Expired / used / revoked token → friendly invalid-link screen (above).
- Resend send failure → non-fatal; sub-account is still provisioned; agency console exposes
  "Resend invite".
- Email already has a Pulse/Clerk account → screen flips to sign-in prompt.
- Clerk ticket creation failure → surfaced to the agency owner; sub-account provisioning
  still succeeds so it can be retried.

## Testing

- **Convex unit (vitest, convex-test)** — matches existing `*.test.ts` style:
  - issue → lookupByToken returns the row; unknown token returns null.
  - expired / revoked token returns null from lookup and rejects accept.
  - accept attaches user to org as owner + flips status; double-accept is guarded.
  - email helper builds correct Resend payload (mock fetch).
- **Playwright e2e**:
  - valid token renders the screen with the workspace name + locked email.
  - invalid token renders the invalid-link state.

## Environment / Setup Carry-overs

- `RESEND_API_KEY` — from `op://Security/Resend Pulse/Api`, set on the Pulse Convex
  deployment.
- Verified Resend sender **domain** (e.g. `pulse.studio`). Until verified, Resend only
  delivers to the account owner's own address — fine for dev/first tests.
- `NEXT_PUBLIC_APP_URL` (or equivalent) for building absolute `/invite/<token>` links in
  the email.

## Out of Scope (this spec)

- Team-member / non-owner invitations (engineers, assistants) — deferred post-beta.
- Migrating all `notify()` callers to Resend (only the invite path is wired now).
- Custom-domain white-label sender per agency (Agency-tier feature, later).
