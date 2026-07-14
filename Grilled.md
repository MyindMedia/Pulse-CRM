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

## Feature: marketing landing page at root URL (built + shipped 2026-06-07)
**Goal:** full modern SaaS marketing site at `/` for logged-out visitors, login
top-right, self-serve sign-up.
**Decisions (grilled):** cohesive dark-glass look (reuses app tokens); primary
CTA = self-serve `/sign-up`; signed-in users at `/` auto-redirect to
`/dashboard`; show 3 pricing tiers (Solo/Studio/Label, placeholder prices); no
platform fee messaging (studios keep 100%).
**Stack/where:**
- `src/app/page.tsx` now an async server component: Clerk `auth()` -> redirect
  signed-in users to `/dashboard`, else render `<LandingPage/>`. `/` already
  public in middleware.
- `src/components/marketing/`: `landing-nav` (client, frosts on scroll), `hero`
  (CSS faux dashboard preview, no raster dep), `chain` (Inquiry->Royalty),
  `features` (6 cards), `pricing` (Solo/Studio*/Label), `cta`, `footer`,
  `landing-page` (composer), `reveal` (client, dependency-free
  IntersectionObserver; `immediate` mode for above-the-fold).
- No framer-motion (not a dep); animation = CSS + Reveal. No em dashes.
**Bug caught + fixed pre-ship:** scroll-reveal `-10%` bottom margin left the
hero CTA invisible until scroll; added `immediate` reveal mode for all
above-the-fold hero content.
**Non-goals:** blog, real logo wall, testimonials, i18n.
**Spec:** `docs/superpowers/specs/2026-06-07-landing-page-design.md`. Verified
tsc + lint + build + visual (agent-browser). Deploys via Netlify on push.

## Redesign: cinematic landing (liquid-glass + HLS video) (2026-06-07)
**Goal:** restyle the whole landing in a high-end dark aesthetic (from a
"CodeNest" reference brief) but KEEP PULSE BRANDING - gold not green, Pulse
copy/logo/display font. User decisions: Pulse brand + this style; provided Mux
stream as placeholder bg video; whole landing restyled.
**Techniques applied (all brand-tuned to gold/black):**
- Full-bleed HLS background video (`hero-video.tsx`, hls.js dynamic-imported,
  `enableWorker:false`, native-HLS fallback) at 60% opacity + left/bottom
  gradient overlays. Placeholder stream is the brief's Mux URL - swappable.
- Center-top gold ellipse glow (inline SVG, 25px feGaussianBlur).
- Three vertical structure lines at 25/50/75% (`.grid-lines` util, desktop).
- Liquid-glass card (`liquid-card.tsx` + `.liquid-frame` util): whisper-thin
  fill, 4px backdrop blur, inset specular, razor 1.4px gradient border via
  masked `::before` + `mask-composite: exclude`. Gold-tinted. Pulled up 50px.
- Hero headline "RUN YOUR WHOLE STUDIO." (Space Grotesk extrabold uppercase,
  40->72px, gold period). Eyebrow in Plus Jakarta Sans. Rounded-full gold CTA.
- Instrument Serif italic accent on one word in every section heading
  (working / royalty / whole / grow). Featured pricing tier uses `.liquid-frame`.
- Mobile hamburger -> full-screen overlay (`landing-nav.tsx`, Menu/X, body
  scroll lock). Auth-aware CTAs preserved.
**Fonts added:** Instrument Serif (italic), Plus Jakarta Sans (layout.tsx +
`@theme` `--font-serif`/`--font-jakarta`). **Dep added:** hls.js.
**Verified:** tsc + lint + build green; video confirmed playing (readyState 4)
via agent-browser; hero + full page captured. Brand kept gold/black throughout.

## Feature: animated site-background loop + hover pass (2026-06-07)
**Goal:** an animated video loop as the whole-site background + richer hover
interactions across the landing. (User said "use higgsfield skill" - in this
setup "Higgsfield" = the `seedance-*` skill pack; there is no separate
Higgsfield tool, and AI gen needs a MUAPI key that is not in the vault.)
**What shipped:**
- `site-backdrop.tsx`: fixed full-viewport looping video behind the WHOLE page
  (not just hero). Video is grayscaled + gold color-blended + dark wash so it
  reads molten-gold-on-black and keeps every section readable. Landing wrapper
  made transparent so it shows through.
- `hls-video.tsx` (renamed from hero-video): generic `HlsVideo` - hls.js for
  `.m3u8` (enableWorker:false, native-HLS fallback), direct src for plain files.
  `DEFAULT_SRC` = the Mux placeholder; swap to `/bg-loop.webm` when the real loop
  lands. Hero no longer carries its own video.
- Hover pass: `.link-underline` (animated gold underline) on nav + footer links;
  `.hover-glow` (gold bloom) + icon scale on chain/features/pricing cards.
- Seedance/Higgsfield loop PROMPT authored via `seedance-director` skill, saved
  to `docs/seedance-bg-loop-prompt.md` (loopable, gold/black, text-safe).
**To finish (user):** generate the loop (give a MUAPI key OR run the prompt in
Higgsfield Motion with Loop on), drop `public/bg-loop.webm`, flip `DEFAULT_SRC`.
**Verified:** tsc + lint + build green; backdrop confirmed playing + gold-tinted
via agent-browser. **Brand:** gold/black kept throughout (no green).

## Feature: branded embedded Stripe Connect onboarding (built 2026-06-09)
**Goal:** studios connect Stripe inside Pulse (themed gold/black) instead of
being redirected to Stripe's hosted onboarding. Also added a read-only go-live
verifier and confirmed branding is Dashboard-only.
**Build:**
- `convex/stripeConnect.ts`: `createAccountSession` action (ensures the Express
  account via shared `ensureExpressAccount`, then `accountSessions.create` with
  `account_onboarding`). Returns `clientSecret`. `createAccountLink` (hosted)
  refactored onto the same helper and kept as fallback.
- `src/components/payments/embedded-connect-onboarding.tsx`: themed
  `<ConnectAccountOnboarding>` in a Dialog; ConnectJS dynamic-imported in an
  effect (browser-only, no SSR side effect); `embeddedConnectAvailable` gates on
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
- `stripe-connect-card.tsx` + `payments-setup-walkthrough.tsx`: open the embedded
  dialog when the publishable key is present, else fall back to hosted redirect.
- Deps: `@stripe/connect-js` + `@stripe/react-connect-js`.
- Go-live tooling: `scripts/verify-go-live.{mjs,sh}` (read-only health check);
  branding confirmed API-impossible for own platform account (Dashboard only),
  assets prepped at `public/stripe-icon.png` + `public/pulse-logo-main.png`.
**Config to go live (user):** set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`
on Netlify + redeploy. Without it the hosted redirect still works.
**Verified:** tsc + lint + next build green; 351 vitest pass. NOT yet committed/
deployed (no cloud Convex access in agent env).

## Redesign: chrome/Dylanbrouwer aesthetic, Pulse gold accent (in progress 2026-06-09)
**Direction (grilled):** restyle the ENTIRE site (landing + full app) to the
"Dylanbrouwer" style reference (monolithic chrome display type, achromatic
neutrals, mono metadata, ghost borders, single 14.4px radius, brutalist scale)
but KEEP Pulse **gold #FDB913** as the sole accent (NOT the template's Ember
orange). Videos: author Higgsfield/Seedance prompts, user renders (Higgsfield
MCP now configured; auth pending).
**Branch:** `feat/chrome-redesign` (keep main clean; user deploys).
**Foundation (DONE):** additive tokens in `globals.css` @theme - achromatic
palette (`--color-obsidian/graphite/slate/steel/mist/fog/paper/white`), `--radius-chrome:14.4px`,
type voices `--font-chrome` (Anton = ABC Gravity sub), `--font-grotesk` (Inter =
Die Grotesk B sub), `--font-meta` (IBM Plex Mono); utilities `.chrome-display`,
`.chrome-fill`/`.chrome-fill-dark` (metallic gradient text), `.chrome-meta`,
`.chrome-ghost`/`.chrome-ghost-gold`. Fonts added in `layout.tsx` (Anton, IBM_Plex_Mono).
NON-destructive: existing app tokens (ink/coal/gold/bone) untouched.
**Landing (DONE):** all marketing components restyled (nav, hero, chain,
features, pricing, faq, cta, footer, subscribe-button). Hero = chrome-fill
monolithic "RUN YOUR WHOLE STUDIO." over desaturated montage; mono metadata;
gold + ghost CTAs. Kept the page DARK (cohesive w/ app + SiteBackdrop loop) - the
template's dark->light "work section" rhythm is OFFERED but not applied (pending
user call). Verified: tsc + lint + next build green; screenshots captured.
**Remaining:** (1) app shell + shared UI primitives (button/card/input/dialog/
table) to chrome tokens; (2) per-surface sweep (~30 pages); (3) video prompts +
Higgsfield generation; (4) optional dark->light landing register.

## Standing context / prior fix
- **Crash fixed (2026-05-23):** `/agency/[orgId]` showed "page couldn't load" because `invites.list` threw `AccessError` (a plain `Error` → redacted by Convex) with no `error.tsx` boundary. Fixes: `invites.list` degrades to `[]` on access denial; `AccessError extends ConvexError`; `/agency/error.tsx` boundary; `createSubaccount` + `adoptOrphanSubaccounts` stamp/repair `agencyId` so the owner isn't scope-denied. 128 vitest green.

## Feature: sub-account white-label theming (BUILT + deployed 2026-06-12)

**Goal:** studios fully white-label their booking sites + dashboard. Uploading a logo auto-creates the hero and derives the brand colors from the logo; manual branding still available; branding matches across the whole app for that sub-account; the Pulse logo stays pinned on public navbars + footers.

**Decisions/architecture:**
- Color engine `src/lib/brand-theme.ts`: canvas hue-bucket extraction (accent + up to 4-color palette) at upload time; `deriveBrandTokens()` maps one accent onto the five `--color-gold*` Tailwind v4 token vars, so a wrapper style rethemes everything (booking layout root + `OrgTheme` display:contents wrapper in the app shell).
- `orgs.applyBrandFromLogo` mutation stores accentColor + brandPalette; called from the settings branding panel and the /welcome wizard after `setLogo`. Stock #fdb913 = no override.
- Booking page hero: when no hero photo, an auto-generated palette gradient hero (logo + name + tagline + accent stripe) renders.
- Pulse pinned: PulseLogo is a baked-gold image (immune to token overrides); booking navbar "Secured by Pulse" + footer "Powered by Pulse" now render on every plan (whitelabel gate removed by product decision).
- **AI brand heroes (2026-06-12):** `convex/brandHero.ts` generates a low-key studio interior lit in the org accent via Gemini (`gemini-2.5-flash-image`, GEMINI_API_KEY on prod) on every logo upload (3s after `setLogo`; manual `bookingHeroId` wins; "Generate with AI" button in branding panel). Booking landing redesigned: full-bleed hero background (manual > generated > palette gradient) under a dark ink fade + brand tint, themed CTA.

## Hardening: go-live resilience pass (3-agent audit, 2026-07-08, /goal)

**Trigger:** recurring "This page couldn't load" (Chrome error page) on
/dashboard right before go-live. Three parallel review agents audited the
auth/load chain, all page query handling, and deploy/perf resilience.
**Root causes found + fixed:**
- **Shell white-screens (the big one):** a dozen shell components (Sidebar,
  Topbar, OrgTheme, banners, widgets) run useQuery OUTSIDE any boundary -
  Next's error.tsx cannot wrap its own layout segment, and Convex useQuery
  THROWS server errors into render. On fresh loads the shell subscribes
  before Clerk auth attaches -> UNAUTHENTICATED throw -> whole tree unmounts.
  Fixes: `ShellErrorBoundary` class boundary wrapping the entire (app) shell,
  `global-error.tsx` last-resort net, error regexes broadened to all
  AccessError shapes (NO_WORKSPACE etc. now offer "Sign in again" instead of
  a futile Try-again loop), AND chrome reads degrade server-side instead of
  throwing (orgs.current -> null, insights.counts/open, activityFeed -> [],
  agencyBilling.myBilling -> null; catch AccessError - the myCapabilities
  pattern applied everywhere the shell reads).
- **Deploy skew:** self-heal head script (commit `9d3af9a`) - stale-chunk /
  ChunkLoadError / React #310 -> one sessionStorage-guarded reload.
- **Unbounded hot queries:** dashboard.overview's sessions/invoices/
  opportunities collects bounded to a rolling 400-day indexed window (KPIs
  look back <=13mo; unpaid invoices older than that age out of Outstanding -
  accepted); insights.open, opsActions.list/counts, aiArtifacts.list bounded
  to newest-500. recovery.summary still whole-table (needs a materialized
  counter - FOLLOW-UP).
- **Duplicate subscription:** LiveToasts activityFeed limit 15 -> 20 to dedupe
  with InsightsBell.
- **Aurora GPU cost:** backdrop blobs settle after 2 cycles (glass panels
  backdrop-blur that layer; forever-motion = forever re-sampling).
**GO-LIVE BLOCKER (config, owner-owned):** Clerk still runs the DEV instance
(pk_test alive-emu-4) - cross-origin handshakes, dev-browser tokens, session
wedging all stem from it. Promote to a Clerk PRODUCTION instance (custom
domain e.g. clerk.pulse.myindsound.com), then update NEXT_PUBLIC_CLERK_
PUBLISHABLE_KEY + CLERK_SECRET_KEY on Netlify AND Convex prod, and
CLERK_JWT_ISSUER_DOMAIN on Convex; keep session-token aud:"convex"
customization + phone settings when recreating.

## Feature: customizable dashboard (widget grid) + chart fixes (2026-07-08, /goal)

**Owner asks:** service names on the bookings donut (legend showed only dots/
numbers in narrow cards), remove Catalog-by-stage, move Next Arrivals up,
and a customizable dashboard (move/remove/add widgets).
**Build:**
- `CategoryDonut` stacked (donut over full-width legend) - the row layout
  crushed the label column to zero in 1-col cards; agency page benefits too.
- TodayBoard side rail `order-first lg:order-none` - arrivals sit under the
  counters on phones instead of below the timeline.
- **Widget system:** `src/lib/dashboard-layout.ts` (pure order/hidden state,
  normalizeLayout reconciles saves against the registry; 5 tests) +
  `src/components/dashboard/widget-registry.tsx` (12 widgets, span map onto
  the 4-col grid) + `customizable-dashboard.tsx` (dnd-kit rectSortingStrategy
  drag-reorder, X to remove, Add-widget tray, Reset; per-user localStorage
  `pulse:dash-layout:<userId>`, same pattern as nav order). Page slimmed to
  header + nudges + seed card + <CustomizableDashboard/>. Inline chart cards
  extracted to `chart-cards.tsx` (self-querying so tiles mount anywhere).
- Catalog chart = `defaultHidden` in the registry (removed from default view,
  re-addable from the tray - verified in the tray).
**Verified:** local demo-mode run - donut names render, customize mode
(frames/remove/tray) exercised in-browser; tsc/lint/640 vitest/build green.

## Overhaul: app-wide liquid-glass + transitions.dev motion (2026-07-08, /goal)

**Owner ask:** super modern/crisp UI through the ENTIRE app, glass effect,
transitions.dev skill for motion, futuristic + eye-catching.
**Approach - amplify the primitives so every screen changes at once:**
- transitions.dev **motion tokens** installed in globals.css (:root
  --duration-* / --ease-* / --distance-* / --scale-* / --blur-*); overlay
  anim-* utilities, rise-soft/rise-stagger, Card/StatTile hovers all retimed
  onto the token scale.
- **Aurora backdrop**: .app-bloom now carries two slow-drifting blurred blobs
  (gold + whisper of info blue; transform-only 26s/34s alternates, stilled
  under prefers-reduced-motion) - glass finally has something to refract.
- **.glass-edge utility**: 1px masked-gradient razor hairline (specular white
  -> gold trace) replacing flat borders on Card (thin/regular) + StatTile;
  brightens on hover. Declared after material-* so its border-color override
  wins the cascade.
- **rise-in-soft** now rises out of a blur (--blur-medium) - every staggered
  entrance app-wide got the futurist voice; PageHeader text is staggered.
- **AppTransition** (route changes): blurred rise in, quick blurred exit.
- **Topbar** de-flattened: bg-obsidian/65 + backdrop-blur-2xl + saturate so
  content visibly blurs beneath the sticky header.
- Skeletons already shimmered; buttons already sheen + press-scale.
Verified tsc/lint/629 vitest/build. NOTE prior deploy b3c8c9e (dashboard-3
interface) WAS live - owner "saw no change" because the top fold (header +
TodayBoard) was intentionally unchanged; this pass changes the whole feel.

## Redesign: dashboard on the @efferd/dashboard-3 interface (2026-07-08)

**Owner ask:** install `@efferd/dashboard-3` (shadcn registry block), keep all
existing items, change the interface, keep Pulse branding.
**Setup:** `components.json` created by hand (Tailwind v4, css=globals.css,
aliases @/, registry `@efferd: https://efferd.com/r/{style}/{name}.json`);
`npx shadcn add @efferd/dashboard-3` run with "No" to every overwrite - ALL 10
existing ui primitives kept (avatar/badge/button/card/dropdown/select/table/
sheet/tooltip/skeleton). shadcn appended sidebar vars + `@custom-variant dark`
to globals.css (left in, inert).
**Kept from the block:** `delta.tsx` (retuned: Badge tone=positive/critical,
Pulse signal tokens), `indicator.tsx` (StatusIndicator ping, colors mapped to
positive/critical/caution/info), `formater.ts`, `ui/chart.tsx` (shadcn chart
wrapper; semantic tokens bridged in globals.css: background/foreground/border/
muted(-foreground) -> Pulse palette). Deleted the unused app-shell-3 family +
sidebar/breadcrumb/kbd/collapsible/input/separator + demo block files (mined
for patterns first). Dep added: `radix-ui` (monolith, for kept prims).
**New interface (src/components/dashboard/):** `kpi-stats.tsx` (six delta stat
cards, financial-gated), `revenue-chart-card.tsx` (gold gradient AreaChart via
ChartContainer, 6/12mo select, MoM delta badge), `upcoming-sessions-card.tsx`
+ `activity-card.tsx` (bordered-header list cards). Dashboard page recomposed:
TodayBoard (untouched) -> KPI row -> revenue(3)+insights(1) -> distribution
trio + RecoveredByPulse -> upcoming+activity -> Ops Autopilot + Pulse AI.
WhosWorkingCard's on-clock dot upgraded to the pulsing StatusIndicator. All
items preserved; gold/black brand throughout. 629 vitest, tsc/lint/build green.

## Features: live owner/manager toasts + punch-driven On-shift + Today/Dashboard merge (2026-07-07)

- **Live pop-ups (`9733060`):** clockIn/clockOut write `staff.clocked_in` /
  `staff.clocked_out` activity rows (added to the bell's NOTEWORTHY set); new
  `LiveToasts` shell component pops real-time toasts for `schedule.manage`
  holders on staff punches + new bookings (own punches muted, pre-mount
  history stays in the bell).
- **On-shift = real punches, today only (`9338a87`):** `shifts.whosWorking`
  rewritten - `now` = active time entries (new `timeEntries.by_org_status`
  index), `upcoming` = today's still-open shifts minus anyone already punched
  ("due" chip when the window is open); staff with neither punch nor shift
  today don't appear. `today.counts.staffOnShift` counts punches too.
- **Today + Dashboard are ONE pane (`9338a87`):** new
  `src/components/today/today-board.tsx` (counters, now strip, timeline,
  arrivals/balances/on-shift/tomorrow rail - StaffPanel replaced by the
  punch-driven WhosWorkingCard) tops /dashboard; /today redirects there;
  nav item removed, mobile tab + PWA start_url now /dashboard. Dashboard
  remains the login landing.

## Fix: blank app after a fresh member's first sign-in (2026-07-07)

**Symptom:** newly-invited staff (first real one: berlaw@gmail.com, manager on
Myind Sound) sign in successfully on mobile and the app never loads.
**Root cause:** Clerk only stamps the `orgId` claim once the session has an
ACTIVE organization, and nothing in the app called `setActive` after sign-in -
so a fresh member's token had no org claim and `resolveViewer` threw
NO_WORKSPACE on every query (the owner never hit it: agency paths resolve
without the claim). Two-layer fix:
- `members.by_clerk` index + resolveViewer fallback: no org claim + exactly
  ONE members row for the Clerk user -> resolves as that studio's member.
  Ambiguous (multi-studio) or no membership still denies (pinned by tests).
- `ActiveOrgSync` shell component: signed-in user with memberships but no
  active org -> `clerk.setActive(first membership)`, keeping the Clerk session
  itself correct (org roles, middleware auth().orgId, multi-org).
**Also this session:** invite-accept phone-collision fix (see memory
`pulse_clerk_phone_required_gotcha`): duplicate phone on the invite (owner's
own cell) was misreported as "account exists"; now classified via
`convex/lib/clerkErrors.ts`, retried without the phone identifier, or surfaced
honestly as phone_exists. berlaw account ultimately created via
`invites:accept` CLI run with a Clerk TEST phone (+14045550134, dev-instance
test range) because the instance keeps phone Required.

## Feature: staff mobile time clock + iOS app polish (built + shipped 2026-07-07)

**Goal (owner, /goal):** teams get a clock in/out function on mobile when
logged in, and the logged-in mobile experience feels like an iOS app for staff.

**What already existed (kept):** `convex/timeclock.ts` (self-scoped clockIn/
clockOut/snooze/myStatus/myEntries - ad hoc clock-in already allowed, no
backend change needed), the shift-prompt `ClockWidget` (pops at shift start/
end + floating on-the-clock pill), `MobileTabBar`, installable manifest,
branded mobile-friendly Clerk sign-in.

**Gaps closed:**
- NEW `/clock` page (`src/app/(app)/clock/page.tsx`): phone-first punch
  screen - live wall clock, one big circular punch button (gold "Clock in" /
  ticking h:mm:ss + "tap to clock out"), shift context line (open shift ->
  ties entry to it; else next shift; else "ad hoc entry"), Today + This-week
  stat tiles, recent-entries timesheet. Non-staff (agency view-as, clients,
  demo owner: myStatus.member=null) get a quiet explainer. Pure math in
  `src/lib/timesheet.ts` (clockedMs/startOfToday/startOfWeek/fmtDuration/
  fmtTicker) + tests (619 vitest total).
- Nav: "Time Clock" item (feature "schedule", no capability - staff see it);
  `featureForPath` maps /clock -> "schedule" so agency toggles gate it.
- MobileTabBar: /clock added to MOBILE_PRIMARY (after Today), shown only when
  `timeclock.myStatus` resolves a member row (real staff), hidden for agency
  viewers/demo owners.
- iOS/PWA polish: real square icons generated from the waveform mark on ink
  (public/icon-192/512, icon-maskable-512, apple-touch-icon 180) wired into
  manifest.ts + metadata.icons.apple; viewport gains `viewportFit: "cover"`
  (tab bar already pads safe-area-inset-bottom).

**Non-goals (this pass):** web push notifications (needs VAPID + schema),
geofenced clock-in, offline queueing of punches.
**Verified:** tsc + lint + 619 vitest + next build green (/clock +
manifest.webmanifest in the route list). Frontend-only - no Convex deploy.

## Feature: payroll pay-period schedule (built + shipped 2026-07-07)

**Goal (owner):** payroll for the entire team every month, and the Payroll page
shows the CURRENT pay period, where the schedule is every two weeks or monthly
per the studio manager/owner's preference.

**Decisions/build:**
- `orgs.payrollSchedule` ("monthly" | "biweekly", unset = monthly) +
  `orgs.payrollAnchorDate` (YYYY-MM-DD first day of a biweekly period).
- `payroll.getSchedule` (insights.read) / `payroll.setSchedule`
  (schedule.manage, so owner + manager only; validates anchor format; keeps the
  anchor when switching back to monthly).
- Window math stays CLIENT-side in the viewer's timezone (matches the page's
  existing rangeFor pattern): new pure lib `src/lib/pay-period.ts`
  (`payPeriodFor` monthly = calendar month, biweekly = 14-day spans aligned to
  the anchor; `defaultAnchorDate` = most recent Monday) + unit tests.
- Payroll page: default range is now "This pay period" (+ "Last pay period"),
  shows the period dates next to the picker, and owner/manager get a
  "Paid monthly / Paid every two weeks" selector (useCapabilities-gated;
  first switch to biweekly anchors on the most recent Monday).
- `seedDemoFinance`: whole paid team now clocks a steady weekly rhythm so
  every period shows the full roster; seed also sets the demo org to biweekly
  anchored Monday of last week (mid-period on run day).
- Full-time pass (same day, owner ask): BOTH managers ($52k/yr) and the
  senior engineers Renzo + Sienna ($47.5k/yr) are now SALARIED full-timers
  clocking Mon-Fri 7-8h days; Theo stays hourly $32/hr part-time (2 shifts/wk
  3-4h) AND is the live on-the-clock engineer so ticking pay still demos the
  hourly path. Salary = annual cents prorated per period by lib/payroll;
  salaried entries carry no rateCentsSnapshot.
- Verified tsc + lint + 616 vitest + build; deployed Convex prod
  `pastel-corgi-340`; seed re-run (177 entries, 1,258h / $32,388 per 8wk).

**Non-goals (this pass):** weekly/semi-monthly schedules, a custom anchor-date
picker in the UI (anchor defaults to Monday; adjustable later), payroll
run/approval workflow.

## Restyle: Clerk UI full glass branding + backdrop-filter pipeline fix (2026-07-08, /goal)

**Owner ask:** converted Clerk to a Pro account; fully brand the Clerk interfaces.
**Build:** `src/lib/clerk-appearance.ts` rebuilt onto the liquid-glass system -
`cardBox` = `material-thick glass-edge shadow-pop` (card + footer read as ONE
slab; inner `card`/`footer` forced transparent with Tailwind v4 `!` since
Clerk's stylesheet loads after ours; `bg-none!` kills the footer gradient
image), popovers `material-regular glass-edge`, modals `material-thick` over a
blurred ink backdrop, radius 14.4px (chrome), gold primary button gets
`sheen press`. `/sign-in`, `/sign-up`, `/welcome/activate` swapped their static
radial for the `app-bloom` aurora so the glass refracts something.
**Root-cause fix while verifying:** ALL authored `backdrop-filter` declarations
were compiled away - Lightning CSS keeps only the LAST of a
standard+`-webkit-` pair, and globals.css declared the standard prop FIRST, so
prod shipped only the webkit alias (live site included; glass held up in
Chrome/Safari purely via the alias). Swapped all 9 pairs so the standard
property comes last; verified blur(36px) now computes in-browser and both
props survive the prod build.
**Clerk CLI (new):** `npm i -g clerk` (v2.0.0) + `clerk/skills` agent skills
installed. Backend-API commands work from this dir via
`set -a; source .env.local; set +a; clerk users list`. Dashboard-auth commands
(`clerk config/apps/link`) still need interactive `clerk auth login` (user).
**User-owned to finish:** flip "Remove Clerk branding" in Dashboard ->
Customization (Backend API exposes no `branded` field; the dev instance forces
the badge regardless - clears on the production instance per the GO-LIVE
blocker), optionally rename the app display name ("Sign in to Pulse CRM"),
and git push for Netlify to ship the theme + backdrop-filter fix.
**Verified:** tsc, lint (2 pre-existing errors untouched: profitability.test.ts
any, twilioA2P.ts prefer-const), 640 vitest, next build, agent-browser visual.

## Epic: Studio Operations Agent — KB + profitability + risk guardrails (grilled 2026-06-27)

**Goal (owner's words):** an extensive per-sub-account agent that looks ONLY at that sub-account's data (never cross-contaminating), runs an outreach algorithm, evaluates a studio's profitability and where it can improve, reasons against a knowledge base of global studio best practices / top-performer criteria, finds problems before they arise, and has guardrails + safeguards for every category (pipeline, songs, splitsheets, studio scheduling, staff scheduling). It should effectively replace multiple low-level roles.

**What already exists (extend, do NOT rebuild):**
- `opsBrain.ts` + `opsActions.ts` — deterministic per-org autopilot: gathers `by_org`-scoped signals → pure rule layer → candidate actions → dedupe → per-org autonomy graduation + `DAILY_AUTO_CAP` → idempotent, audited execution. Named agents cover leads, payments, sessions, deposits, revisions, split sheets, rooms, rights metadata, pricing, no-show, weak lead sources.
- `agent.ts` + `agent*` tables + `agentHealth.ts` — conversational Pulse Agent, approvals, memory, 6-component Studio Health, agency fleet.
- Tenant isolation rail: `lib/tenant.ts` (`currentOrg`/`currentOrgWithCapability`/`assertOrg`), access engine (`resolveViewer`/`requireCapability`), `lib/aiGuard.ts` (injection + tenant binding). Execution re-verifies `orgId` ownership before every mutation.

**Decisions (grilled 2026-06-27):**
- **Build order:** (1) Knowledge Base + Profitability engine FIRST, then (2) category guardrails/risk detector, then (3) scored outreach algorithm, then (4) isolation audit hardening across the new surfaces.
- **KB sourcing = both:** codify domain knowledge now (so the engine works immediately), AND run web research in parallel to refine the benchmark numbers with cited sources. KB is codified data in-repo (not per-tenant), versioned, reasoned against per-org.
- **Autonomy = auto for low-risk, approval-first for the rest:** internal-only analyses (profitability scores, risk flags, health) post automatically; anything client-facing or financial routes through the existing approval/inbox + autonomy-graduation mechanism. Reuse `opsActions` + `opsAutonomy`, never a new send path.
- **Deploy:** build → typecheck → full vitest → deploy Convex (node@22 + `CONVEX_DEPLOY_KEY` from `op://Security/Convex PULSE CRM/deploy key`) → push (Netlify auto-deploys frontend). Goes live on pulse.myindsound.com.

**Architecture (this epic):**
- `convex/lib/studioKnowledge.ts` — versioned, pure, in-repo KB: profitability criteria + benchmark bands (utilization, revenue/room, no-show %, lead→booking conversion, deposit capture, AR aging, staff cost ratio, revision overage, split-sheet execution, pipeline health) sourced from codified domain knowledge, refined by web research. No tenant data; pure scoring functions.
- `convex/profitability.ts` — per-org profitability evaluator: reads `by_org` signals, computes metrics, scores each against the KB band, returns a graded report + ranked improvement levers (estimated $ impact). Internal read auto-posts an insight; client-facing/financial levers → `opsActions` proposals.
- `convex/lib/guardrails.ts` + `convex/risk.ts` — category-specific safeguards + forward-looking problem detector for pipeline, songs, splitsheets (HARD gate: no release action while split unexecuted), studio scheduling (double-book/buffer/hold-expiry), staff scheduling (overtime, unfilled shift, availability conflict, single-point-of-failure). Each guardrail = pure predicate + severity.
- Wire new generators into `opsBrain` (same dedupe/autonomy/audit rail). New action types added to `ActionType`. Crons: add a daily profitability+risk sweep alongside `ops-brain`.
- **Isolation invariant (non-negotiable):** every new query is `by_org`-indexed; KB is global/read-only; no new code reads across orgs; tests assert cross-org reads return nothing.

**Non-goals (this pass):** new UI framework; replacing the conversational agent; live external per-tenant data feeds; auto-executing any client-facing/financial action without graduation.

## Feature: front-desk kiosk calendar + visitor check-in (2026-07-14)

**Goal (owner's words):** a calendar-only view for the sub-account to run full screen on an iPad at the front desk - all events for the month, filterable by day or week, with drill-down and a manual check-in option per session. Plus a Visitors screen on the nav bar showing every visitor's registered timestamps; visitors scan a QR, enter email + visit details, and get checked in. Visits feed a database usable for clients and outreach.

**Decisions (autonomous build - owner away; assumptions flagged):**
- **Kiosk stays authenticated.** Session data carries rates/deposits and the security audit closed unauthenticated org reads, so `/kiosk` is a signed-in route (staff signs the iPad into Pulse once). It lives OUTSIDE the `(app)` group so it renders chrome-less under the root layout; middleware already protects any non-public route. ASSUMPTION: no PIN-only kiosk auth for v1 - the iPad uses a staff login.
- **Views:** month (default, all events) / week / day toggle with touch-size targets, prev/today/next paging, live clock. Data = existing `api.sessions.inRange`; date math reused from `src/components/calendar/constants.ts` (week + day grids are new).
- **Session check-in = the existing status machine.** Drill-down overlay shows session detail; "Check in" runs `api.sessions.setStatus -> in_progress` (which already flips the room to in-use, drives No-Show Shield, Google mirror). Transitions follow SessionSheet's NEXT_STATUSES map (tentative must be confirmed first; in_progress can be marked complete). No schema change for sessions.
- **Visitors = new `visitors` table (visit log) + upsert into `artists` (the client/outreach database).** Dedup by lowercased email exactly like `booking.createBooking`; new contacts land as `status:"lead"`, `type:"other"`, `tags:["Visitor"]`, `source:"visitor_qr"`, first-touch source wins. The Clients directory therefore doubles as the outreach database - no parallel CRM table.
- **Public self check-in page `/visit/<slug>`** (added to middleware public routes), branded via existing public `api.orgs.getBySlug`, org resolved server-side from the slug (booking.ts pattern), rate-limited via `usageCounters` metric `visitor_checkins` (60/org/hour). Success screen auto-resets for the next guest. QR rendered with the already-installed `qrcode.react`.
- **Visitors nav item + `/visitors` page** gated by new feature key `"visitors"` (agency-toggleable like every other module): stat tiles (in studio now / today / this month / contacts), Visit log tab (name, contact, purpose, host, check-in + check-out timestamps, staff Check-out button), Directory tab (unique visitors by email: visit count, last visit, link into Clients), header actions = Check-in QR dialog (print/copy) + manual "Log visitor" dialog for front desk.
- **Activity feed:** each check-in writes an `activity` row (`visitor.checked_in`) so the dashboard feed shows walk-ins.
- **Tests:** convex/visitors.test.ts - register creates visit + artist lead, email dedup patches instead of duplicating, unknown slug throws, hourly rate limit throws, checkOut stamps, org scoping (other org's visits invisible), directory grouping.
- **Not in this pass:** visitor self-checkout on the iPad, badge printing, SMS host notification, per-visitor NDA/waiver capture, PIN-locked kiosk mode.
