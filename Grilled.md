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

## Standing context / prior fix
- **Crash fixed (2026-05-23):** `/agency/[orgId]` showed "page couldn't load" because `invites.list` threw `AccessError` (a plain `Error` → redacted by Convex) with no `error.tsx` boundary. Fixes: `invites.list` degrades to `[]` on access denial; `AccessError extends ConvexError`; `/agency/error.tsx` boundary; `createSubaccount` + `adoptOrphanSubaccounts` stamp/repair `agencyId` so the owner isn't scope-denied. 128 vitest green.
