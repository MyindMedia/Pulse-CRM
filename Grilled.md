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

## Feature: AI tenant-binding + prompt-injection guardrails (2026-06-01)

Owner: keep every AI response tied to the subaccount it's responding from, and
defend against prompt-injection. AI booking voice agent is permanently
scratched.

**Defense model (layered):** the access engine already loads ONLY the current
org's data into any prompt's context, so a successful injection still can't
reach another tenant's data. These are prompt-layer defenses on top.

- **One chokepoint:** `lib/openai.complete()` now appends a global
  `INJECTION_GUARD` to EVERY system prompt (alongside the no-em-dash rule), so
  all AI surfaces inherit it (Agent, concierge portal, email enrichment).
- **New `convex/lib/aiGuard.ts`:** `INJECTION_GUARD`, `tenantGuard(studioName)`
  (binds the model to one studio, refuses cross-tenant talk), `fenceUntrusted`
  (wraps client-controlled free text as data, not instructions),
  `detectInjection` (phrase-based heuristic, tuned to avoid false positives on
  normal questions).
- **Concierge portal (`portal.ask`, public/free-text = top risk):** detect +
  REFUSE obvious injection attempts (returns `source: "blocked"`, logs them),
  bind via `tenantGuard`, fence the client question.
- **Agent (`agent.ts`):** inline tenant line replaced with `tenantGuard`;
  studio-memory block fenced as untrusted.
- **Email enrichment (`aiActions.ts`):** `tenantGuard` in the system prompt;
  client-influenced FACTS fenced.

Validated: tsc clean, 282/282 vitest (23 new aiGuard tests + portal), lint 0
errors, build green.

## Feature: auto-recurring membership packages + public subscribe + booking-link share kit (grilled 2026-06-01)

Owner, from the agency command center: (1) the per-studio booking link must be
unique + shareable (it already is — `/book/<slug>`, slug-unique, real rooms /
pricing / availability); (2) "build out a recurring charge function in Stripe"
so studios with monthly memberships can create the packages in their settings.

**State of play before this pass:** booking links ARE unique per sub-account and
resolve real data. Memberships are ~80% built — `convex/memberships.ts` +
`settings → memberships-panel.tsx` + the Connect subscription webhook routing
all exist. The ONE real gap: a studio had to create the recurring Price in their
Stripe dashboard and paste the `price_…` id (plans were dead until then), and
there was no public way for a client to subscribe.

**Decisions (grilled, all "recommended"):**
- **Auto-create the recurring Stripe Price** on the studio's CONNECTED account
  when they save a package — no dashboard trip, no pasting ids. If Stripe isn't
  connected yet, the plan saves "unlinked" with a one-click "Sync to Stripe"
  once they connect (graceful, non-blocking — matches the existing unlinked UI).
- **Public self-subscribe** on `/book/<slug>`: active+linked packages show with
  pricing + perks; a visitor enters name+email and is sent to a Connect
  subscription Checkout. Find-or-create the artist by email (mirrors
  `booking.createBooking`), source `membership_signup`.
- **Share kit** for the owner in Settings → Branding: the full live booking URL,
  Copy, Open, and "Send to a client" (prefilled mailto), with a "live & unique
  to this studio" confirmation. (QR deferred — needs a `qrcode` dep we can't
  install in-agent; one-package follow-up.)

**Non-goals (this pass):** editing an existing plan's price (archive + recreate),
proration UI, member portal/self-cancel (Stripe handles via webhook), QR image,
non-USD currency.

**Build surface (no schema changes — membershipPlans/memberships/artists already
suffice):**
- `convex/memberships.ts` += `createPlanWithStripe` action (auto-creates Price on
  the connected account, falls back to unlinked), `syncPlanToStripe` action,
  `subscribePublic` action (slug-resolved, find-or-create artist, Connect
  subscription checkout), `publicPlans` query (active+linked, by slug,
  tenant-scoped), internal helpers `_planStripeContext` / `_insertPlan` /
  `_publicSubscribeContext` / `_findOrCreateArtistForSub`. Existing `createPlan`
  mutation kept (back-compat + tests + no-Stripe path).
- `src/components/settings/memberships-panel.tsx` — dialog calls the action,
  drops the manual price-id field, surfaces Stripe-connection state + "Sync to
  Stripe".
- `src/components/book/membership-plans.tsx` (new) + `book/[slug]/page.tsx` — a
  Memberships section with a subscribe dialog.
- `src/components/settings/branding-panel.tsx` — booking-link share card.
- Tests in `convex/memberships.test.ts` (unlinked-save path, public-subscribe
  context, find-or-create dedupe, publicPlans tenant isolation).

**BACKEND DEPLOYED + Stripe webhooks wired 2026-06-01 (prod `pastel-corgi-340`,
TEST mode):**
- Convex functions deployed (createPlanWithStripe / syncPlanToStripe /
  subscribePublic / publicPlans + helpers; verified `publicPlans` callable).
- `convex/http.ts` `/stripe/webhook` now uses `constructEventAsync` (correct for
  the Convex Web-Crypto runtime — the old sync `constructEvent` was a latent bug)
  and verifies against BOTH `STRIPE_WEBHOOK_SECRET` (platform) and the new
  `STRIPE_CONNECT_WEBHOOK_SECRET` (connected accounts). Liveness + signature
  rejection verified against the live URL.
- Stripe endpoints (same URL `…convex.site/stripe/webhook`):
  - Platform `we_1TanQG…`: account.updated, checkout.session.completed,
    customer.subscription.updated, customer.subscription.deleted (the last two
    newly added — also fixes agency-tier plan tracking).
  - Connect `we_1TdkXj…` (new): checkout.session.completed,
    customer.subscription.created/updated/deleted (studio connected-account
    deposits, invoices, memberships). Idempotent dedup (auditEvents by event.id)
    makes the checkout.session.completed overlap harmless.
  - `STRIPE_CONNECT_WEBHOOK_SECRET` set on Convex prod.
- **Still owned by the user:** (1) FRONTEND deploy — the settings panel, booking
  page Memberships section and share card need a Netlify build (git push the
  connected branch) to appear. (2) GO-LIVE for real money — prod currently holds
  Stripe TEST keys; to charge live, swap to live `STRIPE_SECRET_KEY`, recreate
  BOTH webhook endpoints in live mode, and set the live signing secrets.

## Feature: per-studio inventory import from Excel/CSV (built + shipped 2026-06-02)

Owner: each sub-account needs to bulk-import its gear inventory from a
spreadsheet, auto-discovering "any row and column configuration by using the top
level" (the header row), plus a template that captures every component of the
assets screen.

**Decisions/build:**
- New **Settings → Inventory** tab (`InventoryImportPanel`). Upload .xlsx/.xls/
  .csv; reads the header row and auto-maps columns in any order/naming via a
  synonyms + fuzzy matcher; owner confirms the mapping in a per-column dropdown,
  sees a live preview, then imports. Serial-number dedupe toggle (default on).
- **Client-side parsing only** (xlsx/SheetJS) — uploaded files never hit the
  server (keeps SheetJS parse-path CVEs off the backend / other tenants). The
  server gets clean, validated rows.
- `src/lib/inventory-import.ts` = single source of truth (column spec, header
  auto-map, value coercion for category/status aliases + money + dates). Drives
  both the importer and the downloadable .xlsx **template** (Inventory sheet +
  Instructions sheet listing required fields + allowed values).
- `equipment.importBulk` mutation: validates, maps room names → rooms in the
  caller's org (case-insensitive, unknown → storage), optional serial dedupe,
  ONE summary activity row (not per-item), tenant-scoped via currentOrg.
- Added `xlsx@0.18.5` dep (npm advisory vulns are parse-path; mitigated by
  client-only first-party parsing — a SheetJS-CDN pin is the clean-audit
  follow-up). vitest include now also covers `src/**/*.test.ts`.
- **DEPLOYED:** importBulk live on prod `pastel-corgi-340` (verified callable);
  frontend pushed to `main` (Netlify building). 301 vitest green, build clean.

## Fix: agency-admin cap convergence (empty cap-gated panels) (2026-06-05)

Closes the open follow-up from the 2026-06-01 `/bookings` incident: an
agency admin entering a sub-account silently emptied cap-gated panels
(waitlist etc.). **Root cause = two divergent definitions of "agency admin":**
`agency.access` admits operators by the `AGENCY_ADMIN_EMAILS` env allowlist,
but `resolveViewer` granted agency caps ONLY from the `agencyMembers` table.
An allowlisted operator without a table row passed the console gate yet
resolved as a studio/demo viewer when acting as a studio, so studio-cap reads
of the sub-account threw `AccessError` (caught → `[]` → empty panels). The
demo-fallback also meant any authed user with no Clerk org became a de-facto
owner of the global `activeOrgId` (latent hole).

**Fix (Option A, approved):** `resolveViewer` now has a third agency path -
after the two `agencyMembers`-table lookups, a non-empty `AGENCY_ADMIN_EMAILS`
+ matching (lowercased) email elevates the caller to **owner of the SOLE
agency** (gated to the single-agency case; empty list elevates nobody; the
console-only "allow all when empty" rule stays out of `resolveViewer`).
`agencyMemberId` is a synthetic cast (only ever read from fn args, never
DB-queried - same pattern as the `demo`/`system` viewers). 6 new tests in
`access.test.ts`. tsc clean, 316/316 vitest, lint clean, next build green.

**Deploy + config (owned by user - agent env can't reach cloud Convex):**
1. Backend change → needs `CONVEX_DEPLOY_KEY npx convex deploy` to prod
   `pastel-corgi-340` (+ Netlify build via git push) to go live.
2. For the fix to actually elevate Lawrence on prod, `AGENCY_ADMIN_EMAILS`
   must be SET on prod Convex with his email AND exactly one agency must exist.
   Check: `npx convex env get AGENCY_ADMIN_EMAILS --prod`.
3. If the live issue is instead the data mode (he has an `agencyMembers` row but
   a sub-account's `org.agencyId` is unset → `SCOPE_DENIED`), repair with
   `npx convex run agency:adoptOrphanSubaccounts` (sole-agency only). If he has
   NO row at all, bootstrap with `npx convex run agency:seedAgencyOwner '{...}'`.

**Follow-ups (not this pass):** (a) `appState.activeOrgId` is a single GLOBAL
row shared by all viewers (demo-era artifact) - two agency staff can't view
different sub-accounts at once, and an authed user with no Clerk org falls into
demo-owner of whatever is globally active. Needs per-viewer active-org scoping.
(b) Broader `org.agencyId` integrity sweep beyond `createdByAgency` orphans.

## Feature: per-sub-account nav feature toggles (built + shipped 2026-06-07)
**Goal:** let the agency turn individual nav features on/off per sub-account, so
new tools (Agent, Songs, Licensing, etc.) can ship dark and be enabled per
studio when ready.
**Scope:** Dashboard + Settings are always on; all other nav items are
toggleable. Disabling hides the item from the sidebar AND command palette, and
blocks direct-URL access (redirect to /dashboard).
**Stack/where:**
- `orgs.disabledFeatures: string[]` (unset = everything enabled).
- `agency.setFeatures` mutation — `agency.subaccount.pause` cap (so only the
  owning agency can toggle), dedupes the list.
- `src/lib/features.ts` — `FeatureKey` union, `TOGGLEABLE_FEATURES` registry,
  `featureForPath()` route→feature map (roster keys to "clients").
- `nav.ts` carries `feature` keys; `sidebar.tsx` + `command-palette.tsx` filter
  by `orgs.current.disabledFeatures`; `feature-guard.tsx` enforces route gating.
- Agency console: Features section on `/agency/[orgId]` (`FeatureToggles`).
- Tests: `convex/agencyFeatures.test.ts` (dedupe/reflect + cross-agency reject).
**Non-goals:** per-user feature overrides; feature flags unrelated to nav.
**Deployed:** prod `pastel-corgi-340`; pushed `main` (cc37dbf, d8f560b).

## Standing context / prior fix
- **Crash fixed (2026-05-23):** `/agency/[orgId]` showed "page couldn't load" because `invites.list` threw `AccessError` (a plain `Error` → redacted by Convex) with no `error.tsx` boundary. Fixes: `invites.list` degrades to `[]` on access denial; `AccessError extends ConvexError`; `/agency/error.tsx` boundary; `createSubaccount` + `adoptOrphanSubaccounts` stamp/repair `agencyId` so the owner isn't scope-denied. 128 vitest green.
