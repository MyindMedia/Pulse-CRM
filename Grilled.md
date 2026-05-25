# Grilled.md — Pulse

> Per-project alignment record. The agency owner grilling for the **invite portal + branded studio onboarding** feature, plus the standing context for Pulse.

## Project

**Pulse** — a song-centric Studio OS / CRM. Agencies run a command center (`/agency`) over multiple studio **sub-accounts**; each studio gets its own workspace, public booking page (`/book/<slug>`), bookings, sessions, invoicing, AI agents. Next.js 16 (App Router, "use client" pages) + Convex + Clerk (v7 Signals API). Access engine in `convex/lib/access.ts` (resolveViewer → requireCapability → audit). File storage = Convex `_storage` (logos already wired in `convex/orgs.ts`).

Live site: `pulse-dash-kit.netlify.app`. **Deploy topology:** local repo Convex is an *anonymous local* backend (`127.0.0.1:3210`); the live site uses a **cloud** Convex deployment (URL set in the Netlify UI) — deploys need `CONVEX_DEPLOY_KEY` / `npx convex login` (not available in the agent env). Clerk is a **development** instance (`sk_test_…`). Agency admin email: `lawrenceb@myindsound.com`.

## Feature: invite portal + branded onboarding (2026-05-23)

**Goal:** the agency invites a studio by email; the owner gets a branded email, creates their account, then walks an elegant branded onboarding to set up their studio (logo, company info, branding, first room) so they can start taking bookings. For the beta team.

**Decisions (grilled):**
- **Invite entry:** agency enters **email + optional studio name** (+ plan). If name given it pre-fills; otherwise the owner names the studio during onboarding. (Q left blank in grilling; assumed from "I put in the email" + "owner fills all info" — confirm if wrong.)
- **Onboarding collects (all):** ① logo upload (+ accent color) · ② company/contact info (legal/display name, contact email + phone, address, website) · ③ branding & booking page (tagline, booking headline + intro, deposit policy text) · ④ booking setup (first room: name, type, hourly rate, deposit %).
- **Activation:** **active immediately, resumable.** Org is usable right away; a dashboard banner nudges the owner to finish onboarding until `onboardingCompletedAt` is set. No hard gate.
- **Storage:** Convex `_storage` (reuse `orgs.generateUploadUrl` + `setLogo`).
- **Account creation:** already exists — `/invite/[token]` sets name + password via Clerk; after this feature it routes new owners to `/welcome` (onboarding) instead of `/dashboard`.

**Non-goals (this pass):** multi-owner invites, custom domains, payment/plan changes during onboarding, importing existing data.

**Build surface (BUILT 2026-05-23, 137 vitest green, build clean — not yet deployed):**
- Backend: `orgs` schema += `contact` object + `onboardingCompletedAt`; `agency.inviteStudio` action (email-first); new `convex/onboarding.ts` (`mine` query + `saveBasics`/`saveContact`/`addRoom`/`complete`; branding reuses `orgs.update`; logo reuses `orgs.generateUploadUrl`+`setLogo`).
- Frontend: `InviteStudioDialog` on `/agency`; branded 5-step `/welcome` wizard (basics → logo+accent → company → booking copy → first room; resumable, "Finish later"); `OnboardingNudge` banner on `/dashboard`; `/invite/[token]` now redirects new owners to `/welcome`.
- **Deploy pending:** backend needs `CONVEX_DEPLOY_KEY npx convex deploy` to the cloud deployment; frontend needs a Netlify build (git push to the connected branch). The agent env can't reach the cloud Convex (anonymous local only).

## Epic: full studio platform (grilled 2026-05-24)

Owner wants new sub-account owners to have a complete "enter onboarding" experience + multi-tenant data isolation. Decisions (grilled):
- **Build order:** isolation hardening (foundation) → **P1 photo uploads everywhere** (chosen first) → Stripe Connect → email.
- **Payments: Stripe Connect** — each studio connects its OWN Stripe during onboarding and gets paid directly; Pulse facilitates (not platform-collected).
- **Email (both):** **connect Google (OAuth)** to send/receive as their real Gmail, AND an **internal Pulse email** system (Resend-backed) for client comms. Studio chooses per-account.
- **Photo uploads:** camera (phone) or library/upload on **team/member profiles, inventory (equipment), and rooms**. Reuse Convex `_storage`.
- **Tenant isolation (security, must-have):** each sub-account's data + files are private; no cross-account visibility.

**Isolation audit (2026-05-24, preliminary):** Solid foundation — all data access goes through the access engine (`resolveViewer`→`requireCapability`, orgId-scoped, cross-org hard-denied); files served only via the caller's own org/record; storage IDs unguessable. Hardening TODO: (1) verify upload provenance on `setLogo`/`setBookingHero`/equipment-photo mutations (they trust a client-supplied `storageId`); (2) sweep for any unscoped `db.query(...).collect()`; (3) per-org tag on uploaded files.

**Phased plan + status:**
- **P0** Tenant-isolation hardening — audited solid (access engine orgId-scopes all data; per-photo setters assertOrg).
- **P1 ✅ DONE** Photo uploads (rooms, equipment, team) — reusable `PhotoUpload`, tenant-scoped.
- **P2 ✅ DONE** Onboarding expansion — `/welcome` now: basics → logo → business info → booking → **payments (Stripe Connect)** → **client email** → first room.
- **P3 ✅ DONE (code)** Stripe Connect — `convex/stripeConnect.ts` (createAccountLink/refreshStatus/createDepositCheckout on studio's connected acct) + `account.updated` webhook + `StripeConnectCard` (settings + onboarding). **Go-live config:** set `STRIPE_SECRET_KEY` (Connect-enabled platform key) + `STRIPE_WEBHOOK_SECRET` on Convex `pastel-corgi-340`, enable Connect in Stripe, register webhook `…/stripe/webhook` for `account.updated`.
- **P4 ✅ DONE (code)** Email — `convex/lib/google.ts` + `googleAuth.ts` + `/google/callback` http route + `clientEmail.ts` (provider choice; `sendToClient` routes Gmail vs Resend) + `EmailConnectCard`. Internal channel works now (Resend live). **Go-live config (Google):** create a Google Cloud OAuth client, set `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` on Convex, add authorized redirect `https://<CONVEX_SITE_URL>/google/callback`, scopes gmail.send + userinfo.email.
- All shipped on `feat/ops-autopilot`→`main`, deployed to `pastel-corgi-340` + Netlify; 150 vitest green.

## Standing context / prior fix
- **Crash fixed (2026-05-23):** `/agency/[orgId]` showed "page couldn't load" because `invites.list` threw `AccessError` (a plain `Error` → redacted by Convex) with no `error.tsx` boundary. Fixes: `invites.list` degrades to `[]` on access denial; `AccessError extends ConvexError`; `/agency/error.tsx` boundary; `createSubaccount` + `adoptOrphanSubaccounts` stamp/repair `agencyId` so the owner isn't scope-denied. 128 vitest green.
