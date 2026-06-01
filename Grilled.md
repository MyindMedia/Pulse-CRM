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

## Epic: staff scheduling / shift management (grilled + BUILT 2026-05-24)

Decisions: auto-shift + soft-warn on session engineers; shifts tied to a studio/room; dedicated Schedule page; who's-working dashboard widget; notify staff; "/goal do it all" → full self-service too.

**Built + deployed (commits `72b1ca5` + `d712af0`):**
- Schema: `shifts` (memberId, start/end, roomId, kind scheduled|session, sessionId, status), `availability` (weekly slots), `timeOff` (request/approve). New cap `schedule.manage` (owner+manager).
- `convex/shifts.ts`: create/update/cancel (manager), `listRange` (week grid), `whosWorking` (dashboard), `mine` (staff), conflict detection, staff email notify; `ensureSessionShift` auto-creates the engineer's "session" shift from `sessions.create` + returns a soft staffing warning on double-book (never blocks).
- `convex/availability.ts`: my availability get/set, time-off request/list, manager pending-list (graceful) + decide (notify).
- Frontend: `/schedule` week grid (staff × day, room-tagged chips, inline add/cancel, week nav, who's-working strip) + `ShiftDialog`; `WhosWorkingCard` on dashboard; `MySchedulePanel` (my upcoming + availability editor + time-off) + `TimeOffInbox` (manager) on the Schedule page; "Schedule" nav item. Tenant-scoped. 159 vitest green.

## Feature: invited team-member (staff) onboarding (grilled 2026-05-24)

Distinct from the studio-OWNER invite. A studio owner (or agency owner in view-as) invites staff by email; the teammate gets a branded email, creates their account, joins the studio's Clerk org as a member, and runs a lightweight onboarding. Decisions: **auto-send invite when a teammate is added with an email**; staff onboarding = **role/access intro → profile photo → weekly availability** (then dashboard).

**Build:** `invites.role` widened from `"owner"` literal → studio-role union; `invites.record` takes a role; `invites.accept` adds owner/manager as `org:admin` else `org:member` and returns the role; new `members.inviteTeammate` action (create member + record invite + branded staff email); `members.setMyPhoto` (a member sets their OWN photo — staff lack `members.invite`); MemberDialog auto-invites when an email is present; `/invite` accept routes owner→`/welcome`, staff→`/welcome-team`; new `/welcome-team` onboarding page (intro → photo → availability).

## Feature: capture cell phone on team invite (2026-05-24)

Decision: collect a **cell phone** in the invite flow. Two wins — (1) it satisfies Clerk's "phone number Required" instance setting that was breaking account creation ("missing data" / `form_data_missing`), so we send `phone_number` to Clerk and leave phone ENABLED there (do NOT disable it); (2) gives the studio a contact record for **SMS later**. Phone stored on the `members` row (our record, for future SMS) AND on the Clerk user (auto-verified). Owner can pre-fill the phone when adding a teammate (optional in the dialog); the invitee enters/confirms it at the portal (required there, normalized to E.164). Carried invite→accept via the `invites.phone` field.

## Epic: Pulse Agent (dedicated AI ops manager per sub-account + agency control plane) (grilled 2026-05-25)

Source spec: `SaaS Build Pack/Pulse Agent Convex Technical Specification.md` (5-phase, approval-first, tool-calling, tenant-isolated AI ops layer). Decisions (grilled):
- **Build all 3 surfaces:** (1) agency control plane to automate sub-accounts + per-sub agent policy, (2) conversational Agent per sub, (3) per-sub Daily Brief + Studio Health.
- **New parallel agent tables per the spec** (agentPolicies/agentRuns/agentMessages/agentApprovals/agentInsights/agentUsage/agentAuditLogs) — NOT folded into the existing opsActions.
- **Key adaptation:** spec `workspace`/`workspaceId` maps to Pulse's existing **`org`/`orgId: v.string()`** (the entire app + access engine is orgId-scoped; a separate `workspaces` table would fork the tenant model). New agent tables are orgId-scoped and gated by the existing `resolveViewer`/`requireCapability` access engine.
- **LLM:** reuse `convex/lib/openai.ts` `complete()` (gpt-5-mini, already carries the no-em-dash rule + output sanitizer). Approval-first: client-facing/financial/file/automation actions create `agentApprovals`; execution reuses existing send paths (clientEmail/sms). Audit + usage metering from day one.
- Existing `opsBrain`/`opsActions`/`agents/generators`/`agencyOps` stay as the deterministic automation layer; the Agent is the reasoning/chat/insight layer on top.

Build order this epic: schema → policy + runtime (createRun→runAgentLLM→finalize, audit, usage) → approvals (approve/reject/execute) → daily brief (scheduled, policy-gated) → agency fleet (list subs + toggle/autonomy/run-now + cross-sub approvals) → UI (studio `/agent` page + agency Agents surface).

**BUILT + deployed 2026-05-25 (commits `662af6d`→`359fbb4`):** Phases 1-3 + 5 + memory, all live. Schema (agentPolicies/Runs/Messages/Insights/Approvals/Usage/AuditLogs/Memories); `convex/agent.ts` (policy, createRun→runAgentLLM→_finalize, approvals approve/reject/execute via email+sms, daily-brief sweepDigests on automation.tick, memory CRUD, usage + append-only audit); `convex/agentHealth.ts` (deterministic 6-component Studio Health, fed into context + agency fleet); `convex/agentFleet.ts` (agency control plane); UI `/agent` (command bar, health panel, insights, approval inbox, settings, memory) + `/agency/agents` (fleet toggles/autonomy/run-now + cross-sub approvals). Controlled autonomy: auto_trusted auto-runs low-risk reminders only. 195 tests. **Remaining:** (a) set `OPENAI_API_KEY` on Convex to leave fallback mode (user credential choice); (b) Phase-4 full "suggestion → deterministic automation rule" builder (overlaps existing opsBrain; not yet built).

## Feature: inbound Google Calendar sync — true two-way (grilled 2026-06-01)

Owner wants studios that still run their schedule in Google to get a real
two-way sync the moment they connect their Google account (no iCal paste).
Push (Pulse -> Google primary) already ships in `googleCalendar.ts`; this adds
the read direction (Google -> Pulse).

**Decisions (grilled, all "recommended"):**
- **Import target = lightweight busy blocks**, NOT full sessions. Pulse
  sessions require artist + room + rate; raw Google events have none. Blocks
  show on the calendar and give conflict awareness without fabricating
  artists/revenue. (Mirrors the existing iCal block model.)
- **Source = the connected account's PRIMARY calendar, skipping Pulse-origin
  events** so nothing loops. Loop-skip is belt-and-suspenders: (1) every event
  Pulse pushes is tagged `extendedProperties.private.pulse = "1"`, and (2) the
  pull also filters out any id present in this org's `sessions.googleCalendarEventId`.
- **Freshness = incremental poll via a Convex cron** (every 10 min) using
  Google `syncToken` (only changed events). No public webhook infra; a 410 GONE
  on the token triggers a full re-pull.
- **Soft, never hard-block.** Following the established shift pattern
  (soft-warn, never blocks) and the fact that the primary calendar may hold
  personal events, blocks are display + awareness only. `assertNoBufferConflict`
  is left untouched (it still hard-checks session-vs-session in a room).
- **Org-wide blocks** (no room). The primary calendar isn't room-specific, so
  blocks live in a dedicated `googleBusyBlocks` table (org-scoped) rather than
  overloading the room-bound `externalCalendars`. They surface wherever iCal
  blocks already do (the per-room grid) by being merged into
  `externalCalendars.eventsInRange`, so existing consumers inherit them.

**Non-goals (this pass):** Outlook/MS inbound, turning blocks into real
sessions, real-time webhooks, importing across non-primary calendars.

**Build surface:** `orgs` += `googleCalendarSyncToken?` + `googleCalendarSyncedAt?`
+ `googleCalendarSyncError?`; new `googleBusyBlocks` table; `lib/google.ts` +=
`googleCalendarListEvents` (incremental) and a `pulse` extendedProperty on push;
new `convex/googleCalendarSync.ts` (pure `mapGoogleEvent` + `pullOrg`/`pullAllOrgs`
actions + `syncNow`/`status` + `blocksInRange`); `crons.ts` += 10-min
`google-calendar-pull`; `eventsInRange` merges blocks; Settings calendar-sync card.

**Also (2026-06-01):** OpenAI key for enrichment = `op://Security/OpenAI/GCM AGENTS`
(same key as GCM). Set as `OPENAI_API_KEY` on Pulse's cloud Convex (`pastel-corgi-340`)
to leave Gemini/template fallback. Scratched this pass per owner: the AI voice
booking agent.

## Standing context / prior fix
- **Crash fixed (2026-05-23):** `/agency/[orgId]` showed "page couldn't load" because `invites.list` threw `AccessError` (a plain `Error` → redacted by Convex) with no `error.tsx` boundary. Fixes: `invites.list` degrades to `[]` on access denial; `AccessError extends ConvexError`; `/agency/error.tsx` boundary; `createSubaccount` + `adoptOrphanSubaccounts` stamp/repair `agencyId` so the owner isn't scope-denied. 128 vitest green.
