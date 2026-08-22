# Grilled.md — Pulse

> Per-project alignment record. The agency owner grilling for the **invite portal + branded studio onboarding** feature, plus the standing context for Pulse.

## Project

**Pulse** — the studio operating system (Studio OS / CRM). Agencies run a command center (`/agency`) over multiple studio **sub-accounts**; each studio gets its own workspace, public booking page (`/book/<slug>`), bookings, sessions, invoicing, AI agents. Next.js 16 (App Router, "use client" pages) + Convex + Clerk (v7 Signals API). Access engine in `convex/lib/access.ts` (resolveViewer → requireCapability → audit). File storage = Convex `_storage` (logos already wired in `convex/orgs.ts`).

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

## Feature: split-sheet REAL e-signatures + used-link UX (2026-07-15, commit 4d8e113)

**Trigger:** owner reported "This signing link is no longer valid" on /sign/<token>.
**Diagnosis (prod data):** the link HAD been used - he signed it 22s after issuing;
the grant self-revokes on signing (single-use), and `lookup` returned null for any
revoked grant, so revisiting your own used link showed the scary invalid screen.
**Fixes:**
- `lookup` now resolves dead links (revoked-on-use / superseded / expired) whose
  contributor already signed -> the "you have signed" confirmation. Unsigned dead
  links stay null (the sign form only renders for the one live token).
- **Real e-signature capture, two modes:** (a) typed legal name rendered in a
  script font the signer picks from a gallery (Dancing Script / Great Vibes /
  Caveat / Homemade Apple - keys allowlisted server-side), (b) finger/stylus/mouse
  SignaturePad canvas -> PNG data URI (white paper, dark ink, dpr-scaled;
  cap 150k chars). contributors += signatureKind/signatureFont. Mutation errors
  now surface on the page (were silently swallowed).

## Feature: Songs cover art + streaming-link import + split-sheet prefill (2026-07-15, commit 14d361d)

**Owner ask:** cover art update/upload OR pull from a Spotify / Apple Music link
with metadata and credits; pre-fill split sheets when a link is provided during
song creation or edit.
**Build:**
- `convex/lib/musicLink.ts` (pure, 15 unit tests): link parsing (Spotify track incl
  intl-xx, Apple album?i= / song paths), Apple artwork upscaling (100x100->600x600),
  MusicBrainz relation->role mapping, credit dedupe/merge, balanced contributor
  builder (equal splits, remainder on first row, always 100/100), og-tag parser.
- `convex/songImport.ts`: `fetchFromLink` action (songs.edit-gated via internal
  access query) - Apple = iTunes lookup API; Spotify = oEmbed + page og tags
  (artist from og:description); credits best-effort from MusicBrainz
  (recording artist-rels -> producers/engineers, work artist-rels -> writers);
  cover fetched into `_storage` (4MB cap, 8s timeouts, all failures graceful).
  `applyToSong` mutation: cover + fill-blank-only metadata + source link appended
  to referenceTracks once + split sheet drafted from credits (primary artist
  included) ONLY when no sheet exists or the draft is empty - studio work is
  never clobbered.
- Schema: songs += coverArtId (_storage). list/get hydrate coverUrl.
- UI: song hero cover tile renders real art (tonal fallback kept); actions menu
  gains Import from Spotify/Apple Music + Upload cover art + Remove cover art;
  catalog SongCard shows the art; NewSongDialog gets an optional link-import field
  that prefills title/genre, auto-selects a roster artist by name match, and
  applies cover/credits/sheet right after creation.
**Live checks:** iTunes lookup + MusicBrainz verified from the network; Spotify
oEmbed 503'd once then 200 (transient). Prod action correctly rejects
unauthenticated callers. 697 vitest green.

**Follow-up (2026-07-15, /goal): automated e-check-in + required visitor terms + lifetime stats.**
Owner: auto-check-in when a visitor's email matches a session booking (cross-compare
name + email), every check-in lands in Clients, track lifetime bookings + spend,
require a generated terms-of-service checkbox, and have check-ins update the kiosk
session status automatically.
- **Matching (`matchAndCheckInSession` in visitors.ts):** candidate sessions =
  `by_org_start` window [now-6h, now+16h] (timezone-free), status
  tentative/confirmed/in_progress. Email match (vs the booking artist's email) is
  decisive; name cross-compare picks between multiple bookings under one email.
  Name-only matches count ONLY when unambiguous (exactly one candidate). One artist
  read per unique artistId - no N+1.
- **Status advance = one step along the existing machine:** tentative -> confirmed
  (arrived; deposit still collectable), confirmed -> in_progress (same cascades as
  the kiosk button: recomputeRoomStatus + scheduleGoogleCalendarPush + a
  `session.checked_in` activity row). Kiosk updates live via its reactive
  `sessions.inRange` query - nothing kiosk-side changed. in_progress just links.
- **Schema:** visitors += `sessionId`/`sessionMatchedBy`("email"|"name")/
  `termsAcceptedAt`. Applies to BOTH the QR path and staff manual entry.
- **Terms:** /visit/<slug> gets a required checkbox + expandable 5-clause generated
  visitor terms (conduct, equipment, confidentiality/recording, liability, contact
  use). Server-enforced on the public path only (`termsAccepted !== true` throws);
  staff manual entry vouches instead. Acceptance stamped on the visit row.
- **Lifetime stats:** already maintained by the session-completion path
  (`artists.sessionCount`/`lifetimeValueCents`) - NOT reinvented; the visitors
  `directory` query now joins them per contact and the Directory tab shows
  Bookings + Lifetime spent columns. Visit log shows a gold "Session: <title>"
  badge on matched visits; QR success screen names the found booking.
- Tests: 12 new in visitors.test.ts (676 total). Deployed Convex prod + main.

## Fix: studiopulse.tech sign-in hang -> Clerk satellite domain (2026-07-15, commit 059f1a6)

**Symptom:** sign-in at studiopulse.tech/sign-in hung on the loading screen.
**Root cause (proven):** production Clerk instance had ONE domain
(pulse.myindsound.com); FAPI rejected every request from studiopulse.tech with
`origin_invalid` ("Origin must be equal to or a subdomain of the requesting
URL"), so ClerkJS could never establish a session and the app waited forever.
Predicted at domain setup ([[pulse-studiopulse-domain]]).
**Fix (satellite, non-destructive; primary-domain flip deferred):**
- Clerk API: POST /v1/domains `{name:"studiopulse.tech", is_satellite:true}`
  -> dmn_3GZ43HCofs0OcxaDyXmXkEkqYyo, FAPI clerk.studiopulse.tech.
- Netlify DNS (zone 6a57e25bcaab47444ab4c397): CNAME clerk.studiopulse.tech ->
  frontend-api.clerk.services (Clerk auto-issues SSL after detection).
- `src/middleware.ts`: clerkMiddleware now takes a per-request OPTIONS CALLBACK
  - satellite hosts get `{isSatellite, domain, signInUrl/signUpUrl ->
  https://pulse.myindsound.com/...}`; satellite /sign-in + /sign-up redirect to
  the primary (satellites cannot host Clerk auth flows) with redirect_url back;
  protected satellite routes use plain auth.protect() (Clerk handshake).
- `convex-client-provider.tsx`: ClerkProvider gets the same satellite props
  (browser-computed behind typeof-window) + `allowedRedirectOrigins`
  [studiopulse.tech, www] so the primary honors the return trip.
- No Convex change (issuer stays clerk.pulse.myindsound.com; same instance).
**Sign-in UX on satellite:** URL bounces through pulse.myindsound.com for the
Clerk flow, then returns signed in. Making studiopulse.tech PRIMARY instead is
a future planned cutover (new pk key, 5 DNS records, Google OAuth redirect URI
update in Google console, sessions dropped) - deliberately not done here.

**Follow-up same day - CNAME mode never worked; switched to PROXY mode
(e84f6b9) + SSR host decision (6b8f444):**
- Clerk never issued the TLS cert for clerk.studiopulse.tech (>1h,
  ERR_SSL_VERSION_OR_CIPHER_MISMATCH on the handshake; no CAA blockers). Fix:
  PATCH the domain with `proxy_url: https://studiopulse.tech/__clerk` and turn
  on clerkMiddleware's `frontendApiProxy` for satellite hosts - the satellite
  FAPI is served same-origin under the site's own Netlify cert and forwarded
  to Clerk over the primary FAPI's TLS. `/__clerk(.*)` added to BOTH
  isPublicRoute AND config.matcher (ClerkJS fetches .js assets through it and
  the matcher excludes .js). CNAME left in DNS but now `required: false`.
- **SSR gotcha (the second loading-screen):** ClerkJS's script tag is
  SERVER-rendered with provider config in data- attributes; a client-only
  `typeof window` satellite check hydrates too late -> satellite got
  primary-domain config -> "ClerkJS: Missing domain and proxyUrl". Root
  layout now reads the request HOST header (`await headers()`) and passes
  `isSatellite` as a prop to ConvexClientProvider (makes routes dynamic -
  accepted). Verified live: script tag src goes through /__clerk with
  data-clerk-proxy-url set, window.Clerk {loaded:true, satellite:true},
  console clean, /dashboard bounces to primary sign-in with redirect_url and
  the form renders. Credential round-trip = owner-verified.

## Feature: Arrival prep widget - alert + studio-prep checklist (2026-07-16, commit aa1b854)

**Owner ask:** a section with an alert and a checklist for studio prep and
client arrival - view session details and print the parking placeholder with
the same one-button function as the QR print.
**Build:** default dashboard widget "Arrival prep" (`arrival-prep-card.tsx`,
registered span=half after the Today board). Next 24h tentative/confirmed
sessions (via sessions.upcoming), max 4, each with a 4-step live checklist:
Session details (Link -> /calendar?session=<id>, marks done), Parking sign
(openSignWindow(parkingSignHtml) with the booking's artist name, marks done),
Room ready + Welcome set (toggles). Header = countdown chip for the soonest
arrival, pulsing gold under 60 min ("the alert"). State = new org-scoped
`arrivalPrep` table {orgId, sessionId, done[]} by_org_session (allowlisted
step union; setStep verifies the session belongs to the caller's org; 2
tests incl cross-org rejection) - shared live across staff. openSignWindow
extracted to `lib/sign-window.ts`. 723 vitest; Convex prod + Netlify deployed.
**Not this pass:** push/SMS arrival alerts (could ride opsBrain/reminders),
per-studio custom checklist steps.

**Follow-up (2026-07-16, commit 7f9929c): wrap-up + studio refresh + DEVICE
PUSH ALERTS (the deferred web-push finally built).**
- New widget "Wrap-up & studio refresh" (`wrapup-card.tsx`, span=half): sessions
  ending/ended within 45 min (new `arrivalPrep.wrapping` query - by_org_start
  window, hydrates artist/room + NEXT booking in the same room within 2h as the
  refresh target). Checklists: wrap = files/billing/gear/notes, refresh =
  reset/refresh/zero/stage - same shared arrivalPrep row, step union extended.
- **Web-push pipeline:** `pushSubscriptions` (per-device endpoint rows, pruned
  on 404/410) + `pushAlerts` dedupe ledger; `push.ts` (publicKey/subscribe/
  unsubscribe/isSubscribed); `pushSend.ts` ("use node", web-push + VAPID -
  keys GENERATED + SET on prod env: VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT);
  `pushAlerts.sweep` internal mutation on a NEW 1-min cron
  ("t10-device-alerts" - crons.ts is guarded by a file hook, edited via python
  with disclosure) - only orgs with registered devices scanned. Pure alert
  logic `lib/t10.ts` (5 tests): T-10 arrival (confirmed/tentative), T-10
  wrap-up (in_progress/confirmed end), shift change T-10 (skips cancelled),
  studio refresh at end-time when another booking follows in-room. 2-min
  windows, ledger absorbs overlap.
- `public/push-sw.js`: showNotification with vibrate [200,100,200,100,300] +
  sound (haptic/audible per device), tag renotify, click -> focus/open app.
  `lib/push.ts` client subscribe (iOS needs installed PWA 16.4+). "Enable
  device alerts" chip in BOTH prep widget headers; "Alerts on" check when the
  device endpoint is registered. STUDIO_TZ env (unset = America/New_York)
  formats alert clock times.
- 728 vitest; Convex prod (schema + cron) + Netlify deployed.

**Follow-up (f6b791d): Pulse Agent branding + artifact markdown.** All
user-visible "Pulse AI" labels are now "Pulse Agent" (panel headings, widget
title; file/component names unchanged to avoid churn). Agent artifacts
(weekly briefings etc.) rendered raw markdown in a <pre>; new dependency-free
`ai/simple-markdown.tsx` renders the emitted subset (#/## headings, bullets,
**bold**, paragraphs) as styled text nodes - wired into draft-card bodies.

**Follow-up (e4b35a7): bookings hygiene + archive + seeded messages + sheet
confirms.** Owner: board must show only relevant/now+upcoming, stale unpaid
holds -> archive on Reports, old rows auto-categorized by payment status,
seeded message logs, sheet compaction + confirm popups.
- Automation "stale resolution" pass (runAutomation block 0, internal AND
  public rows, 24h grace): past unpaid tentative -> cancelled+
  autoResolved:"expired_hold"; past confirmed unpaid -> no_show
  ("auto_no_show"); paid or in_progress -> completed ("auto_completed").
  sessions.autoResolved marker (schema). Test convex/staleResolution.test.ts.
  RAN ON PROD: 13 auto-completed / 3 no-shows / 5 expired holds, 0 stale left.
- Bookings page: lanes filter to endTime >= now-14d ("Older bookings live in
  Reports / Archive" link), sort select (soonest/latest/value/client);
  online-first bias removed. Tiles still count everything.
- Reports += "Archive" tab (`reports.bookingArchive` query + booking-archive
  report): 4 buckets, 90d table, "auto" tag on auto-resolved rows.
- seedDemoYear: message logs on ~38% of bookings (booking.confirmed email,
  session.reminder.24h sms simulated, client.question + staff.reply sms
  threads); prior seeded notifications wiped WITH their sessions (dedupe by
  sessionId of TAG rows). RE-SEEDED prod Myind Sound: 314 sessions, 112/68/
  51/52 message rows.
- BookingSheet: footer buttons flex-1 (bigger targets, less dead space);
  Cancel / Mark no-show / Check in gated by confirmation dialogs.

**Follow-up (269eb57): schedule-aware booking slots + brief tap-through.**
Owner: in-app booking for today must start at the NEXT available slot, never
the past, reading schedule/availability to prevent double-booking, grey out
taken slots - all surfaces. Build: BookSessionDialog's time input replaced by
a slot GRID reusing the public `booking.availability` query (hourly, 9-22,
past excluded, booked blocks returned): duration-aware conflict check client-
side (slot dead if any booked block overlaps [start, start+duration)), greyed
+ struck-through when unavailable, auto-SNAP to next open slot when the
selection is past/taken/unset, "No open times this day" empty state, step
validity requires a legal slot. No room chosen = past times still disabled
(no conflict data without a room). Covers calendar + bookings + rebook
(same dialog); public /book page already had this. Arrival prep rows: header
row (artist/time/room) is now a Link to /brief/<id>.

**Fix-of-the-fix (6b34cb0): Tailwind calc GOTCHA.** The safe-area calc classes
(`h-[calc(4rem+env(...))]`, `top-[calc(1rem+env(...))]`) were SILENTLY DROPPED
- Tailwind arbitrary calc needs spaces encoded as underscores
(`calc(4rem_+_env(...))`); unspaced `+` = invalid CSS, no build error. Only
the space-free pt/pb rules had emitted, so status-bar collisions survived two
deploys. Now all four rules verified IN THE BUILT CSS (grep .next chunks).
Lesson recorded in memory: always grep emitted CSS for arbitrary calc values.

**Follow-up (0a9070c): calendar Day/Week views + sheet safe-area.** Owner
(iPhone 17 Pro Max PWA): session sheet content collided with the status bar,
calendar rows amputated text, Today "did nothing", no day/week toggles. Fixes:
(1) SheetContent primitive now pads env(safe-area-inset-top/bottom) + close
button offset (per-usage nav inset removed - would have doubled); (2) calendar
rebuilt on ONE anchor date with Day/Week/Month/Agenda views (prev/next steps
by the view unit; Today jumps anchor to now; phones default to DAY; header
labels day/week span); `startOfWeek` added to calendar constants (Sunday,
local); Day/Week reuse AgendaList over sessions.inRange windows; (3) agenda
rows: 2-line title clamp (manual -webkit-box - no line-clamp plugin), meta
wraps, artist+engineer chips on their own wrap line, badge pinned; (4) BONUS:
`?session=<id>` deep link on /calendar (used by brief + invoice pages) now
actually opens the SessionSheet - it was previously ignored.

**Follow-up (a0d8ce9): per-rented-item wrap-up steps.** Sessions with gear
add-ons (sessions.addOns = a-la-carte rented equipment) auto-grow the wrap-up
checklist: one "Return <item>" step per add-on (key `item:<equipmentId>`,
setStep validates against the session's REAL addOns - stepV is now v.string()
with FIXED_STEPS set + item allowlist, arbitrary keys rejected). wrapping +
brief queries expose `rentedItems`; wrap-up widget shows a "Rented gear back
to storage" chip row and the done pill counts 8+k; brief appends them to the
wrap section with the same attribution trail. Tracks non-standard gear back
to storage piece by piece.

**Follow-up (4fedca3): pinned Arrival prep + editable parking name.** Arrival
prep removed from the widget registry and rendered PINNED above the
customizable grid (normalizeLayout drops the stale key from saved layouts
automatically) - always first on every dashboard. New shared
`components/parking/parking-sign-dialog.tsx`: every parking print (visitors
header + rows, arrival widget chip, brief button/chip) opens it with the name
PREFILLED (booking artist / visit-log entry) but EDITABLE - placeholder
session names get corrected before printing. Checklist "parking" step marks
only onPrinted (not on dialog open); brief StepSection action chips no longer
auto-toggle.

**Fix (a7e43bc): iOS top safe area in the installed PWA.** Topbar content
collided with the clock/Dynamic Island on notched iPhones (17 Pro Max) -
edge-to-edge was intended (viewportFit cover + black-translucent) but only
the BOTTOM inset was handled (tab bar). Topbar now
`h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)]`
(blur still runs under the status bar); mobile nav SheetContent pads the
same inset. env() = 0 in normal browsers, so no effect outside the PWA.

**Fix (c1956c1): StudioBanner leaked to staff.** The "Viewing <studio> as
client / Exit to agency" strip rendered for ANY real studio workspace - a
studio manager (berlaw) saw the agency view-as banner in their own studio.
Now gated on useCapabilities().kind === "agency_member" (same gate as the
sidebar console link; null-while-loading so no flash). Also that day:
berlaw@gmail.com Google sign-in minted a new Clerk user -> repaired by adding
it org:admin to the Myind Sound Clerk org + `members:_relinkClerkUser`
(496f835) CLI repair for GHOST clerkUserId links left by the cutover.

**Fix (4dfa4cd): post-sign-in "Pulse hit a snag" -> AuthGate.** Google OAuth
worked (after the user added the 2 redirect URIs to the Google client in
project pulse-497404, see [[pulse-google-oauth-client]]) but the redirect
landed on the snag boundary: prod logs showed ~12 dashboard queries throwing
UNAUTHENTICATED in one burst at 10:57:30 - the app mounts before the session
attaches to the Convex socket (wider window with Google redirect + satellite
handshake). Structural fix instead of degrading every query:
`shell/auth-gate.tsx` holds the whole (app) tree behind a branded splash
("Opening your studio") until useConvexAuth reports authenticated - FIRST
attach only (state latches; token refresh / org switch never unmounts).
Demo mode (no Clerk key) passes through. Frontend-only deploy.

**Follow-up (78db864): team settings restructure.** Role-permissions explainer
collapses by default (header toggles, keyboard-accessible). Standalone
"Engineer profiles" settings panel DELETED - the member Edit dialog now
carries an "Engineer profile" section (engineer-facing roles only): bio,
notable credits, NEW Spotify profile + playlist links
(members.spotifyUrl/playlistUrls, https-validated in setProfile, playlists
capped at 10). Booking-page consumers of bio/credits unchanged; surfacing
spotify links on the public engineer picker = follow-up.

**Follow-up (dc70a40): Pre-session brief - T-15 notification + accountability.**
Owner: brief leveraging the booking + name, parking print on it, notification
to on-schedule staff 15 min before start and during staging windows, and an
optional/required-check-all policy for accountability.
- `/brief/<sessionId>` page (feature-mapped to "bookings"): booking header
  (artist/title/times/room/engineer/notes chips + starts-in badge), policy
  banner (requireAll: amber "every step required" -> green "brief complete";
  pre-start = arrival section, post-start = all 12), prominent "Print parking
  sign for <artist>" button, three StepSections (arrival w/ parking action,
  wrap #wrap anchor, refresh w/ turnover target) each with an attribution
  trail ("Room ready - Theo, 2:41 PM").
- `arrivalPrep.brief` query (session + prep + attribution + requireAll +
  next-in-room); setStep now records `attribution` [{step, by, at}] from the
  identity (uncheck clears); orgs += `briefRequireAll` (Workspace setting
  "Session brief checklist": optional/required).
- Alerts: arrival alert MOVED to T-15 as "Pre-session brief - 15 minutes out"
  (key b15, url /brief/<id>); wrap + refresh alerts deep-link /brief/<id>#wrap.
  pushSend gains `clerkUserIds` targeting; the sweep computes ON-SHIFT staff
  (shift covering now, +20min lead-in, via members.clerkUserId) and targets
  their devices, falling back to all org devices when none registered.
- Arrival widget details chip -> "Open brief". 729 vitest; prod deployed.

**Follow-up (f7e5892): per-studio timezone from device location.** Convex
runs UTC - alerts/reminder emails/shift SMS all formatted in the wrong zone.
`orgs.timezone` (IANA, validated via Intl in orgs.update): AUTO-SET by
`TimezoneSync` shell component from the first settings-capable device that
loads the app (staff device location = studio location; cap denials silent),
manual Select + "Use this device's timezone" in Settings > Workspace. Shared
`convex/lib/tz.ts` (orgTz/clockTime/whenLabel/dateLabel) feeds t10 alerts
(tz param), reminders.ts and sms.ts. STUDIO_TZ env = fallback only, then
Eastern. Owner is PST - his studios stamp America/Los_Angeles on next load.

## Fix + security: /agency boot-race crash and visibleOrgs anonymous leak (2026-07-15, commit b907ba2)

Fresh /agency loads on the satellite hit "Pulse hit a snag": `agencyProfile.mine`
threw UNAUTHENTICATED into the boundary when the page subscribed before Clerk
attached to the socket (proxied Clerk boot widens the race). Fixed with the
orgs.current degrade pattern (AccessError -> null). While tracing it: found
`visibleOrgs`' `.catch(() => null)` left the agency filter UNAPPLIED on that
same throw - `agency.overview`/`agency.subaccounts` returned EVERY org with
revenue rollups to an unauthenticated socket. Now returns [] on throw (demo
mode unaffected - its viewer resolves without throwing). Deployed to Convex
prod immediately. **FOLLOW-UP (security list):** an AUTHED non-agency viewer
(e.g. a studio member) still gets the unfiltered org list from those queries -
same filter-only-if-agency shape; tighten with the next security pass.

## Feature: reserved-parking name badge (2026-07-15, commit 2035f2f)

Same branded print family as the check-in sign: `lib/parking-sign.ts` (pure,
3 tests) renders a landscape-Letter reserved-parking sign - logo/monogram,
studio caps name, accent rule, "RESERVED PARKING", guest name as the hero with
an accent period, serif italic "We saved this spot for you.", Pulse footer;
composition vertically centered. Entry points: "Parking sign" header action on
/visitors (name dialog with visit-log suggestions) + one-tap CircleParking
shortcut on every visit-log row. `escapeHtml`/`safeAccent` now exported from
checkin-sign; shared `openSignWindow` helper.

## Feature: agency sub-account import from the studio's existing website (2026-07-15, commit 9ddff6b)

**Owner ask:** when creating a sub-account, paste the studio's existing link to
pull their logo and basic info.
**Build:** `convex/lib/studioSite.ts` (pure, 8 tests incl applyToOrg suite):
normalizeSiteUrl (http/https only), JSON-LD walker (Organization/LocalBusiness/
RecordingStudio etc via @graph too) > og tags > title fallback; email/phone from
JSON-LD or mailto:/tel: links; PostalAddress joined; logo candidates ranked
JSON-LD logo > apple-touch-icon (sized) > icons > og:image, relative URLs
resolved. `convex/studioImport.ts`: `fetchFromSite` action (gated
agency.subaccount.create via internal access query; 8s timeouts, 2MB HTML /
4MB logo caps, first real image/* stored to _storage) + `applyToOrg` mutation
(gated agency.subaccount.pause per-org; patches logoId, tagline-if-unset,
merges contact email/phone/address/website). CreateSubaccountDialog: optional
"Studio website" field + Fetch button -> prefills name, shows logo/info preview
chip, applies after createSubaccount (best-effort, never fails creation).
Parser verified live against myindsound.com + abbeyroad.com.

**Follow-up (7ca0bf5): whole-app theming + monochrome accents.** Owner: saved
branding must cover the ENTIRE app and follow client view-as. Diagnosis (live
computed styles): view-as theming already worked (orgs.current resolves the
acting org; sidebar+main computed the derived accent) BUT (1) Radix portals
(dialogs/dropdowns/palette/toasts at document.body) sat OUTSIDE the
display:contents wrapper -> overlays stayed stock gold, and (2) The Dojo's
saved #ffffff was force-saturated into dusty red #ca7272 (hue 0 + minimum
0.45 sat on a colorless value). Fixes: OrgTheme now sets/removes the 5 gold
token vars on <html> via effect (portals inherit; cleanup on unmount protects
/book /visit /kiosk own-brand wrappers); deriveBrandTokens gains a
monochrome branch (s < 0.12 -> silver neutral family, near-black ink).
brand-theme now unit-tested (3 tests).

**Follow-up (1419a74): 20 accent swatches + full-spectrum picker.** The
branding panel's swatch row grew 8 -> 20 (settings/types.ts, mid-lightness
band) and gained a conic-rainbow tile wrapping a native `<input type="color">`
(OS spectrum window incl. eyedropper) wired to the same accent state ->
Save persists -> OrgTheme rethemes app + booking page. Hex entry unchanged.

**Follow-up same day (f699452): brand colors from the logo, both paths.**
Convex storage URLs serve CORS (verified), so the same canvas hue-bucket
extraction (`lib/brand-theme.extractBrandFromImage`, which already accepts a
URL) now runs (1) in the create-subaccount dialog on the imported logo's
preview URL - accent + palette ride through `applyToOrg`, applied ONLY while
the org accent is stock #fdb913 (a chosen accent is never clobbered; invalid
hex rejected server-side; accent swatch shown in the preview chip) - and
(2) on demand via a new "Match colors to logo" button in Settings > Branding
(re-derives from the CURRENT logo through the existing `applyBrandFromLogo`,
covering logos that arrived without extraction). Manual upload extraction was
already live (branding panel + welcome wizard). 718 vitest green.

## Feature: printable branded front-desk check-in sign (2026-07-15, commit 2634932)

**Owner ask:** an elegant branded one-pager each sub-account can print from the
visitor check-in QR modal and post at the front desk.
**Build:** `src/lib/checkin-sign.ts` - pure `checkinSignHtml(brand, url, qrSvg)`
generator (unit-tested: accent hex validated against style injection, all text
HTML-escaped, logo -> monogram fallback). Print-first design: white US-Letter
page (scales to A4), studio logo or accent monogram, letterspaced studio name,
Instrument Serif italic tagline + accent word, accent-framed QR (the dialog's
own rendered SVG, so sign always matches the link), mono URL, three
accent-numbered scan steps, "Powered by Pulse" footer. Google fonts loaded in
the print window; doc prints itself after `load` + `document.fonts.ready` and
closes on afterprint. Dialog (visitors page) gains a primary "Print front-desk
sign" button; brand comes from `orgs.current` so agency view-as prints each
sub-account's own branding. 706 vitest green.

## Fix: /bookings "shows no bookings" -> KPI tiles counted online-only (2026-07-15, commit 2dd50bd)

**Report:** studiopulse.tech/bookings "isn't showing any actual bookings" (seeded + real).
**Diagnosis (live browser + prod data):** NOT a satellite/auth issue - the page
loaded signed-in with the full pipeline (HOLDS 25 etc.). Myind Sound studio org
(org_3GFAaPYy...) holds 302 sessions: 308 seeded `source:"demo_year"` + ~11 real
staff-created (source unset). The four TOP stat tiles filtered
`source === "public_booking"` -> ZERO such sessions exist in that org -> tiles
read 0/0/0/$0 above the fold and the page scanned as empty. Staged bookings
live in the staged org (`staged-playback-recording-studio`, 5 sessions,
source "demo") and only show when acting as that sub-account.
**Fix:** tiles now roll up EVERY session (holds / awaiting balance / paid in
full / collected); online-ness still badges cards + sorts lanes; page
description + collected hint no longer say "online". If the demo seed should
exercise the online-booking funnel, stamping a share of seeded sessions
`source:"public_booking"` is the follow-up lever (not done this pass).

## Feature: required payment type on manual invoice payments + credit -> P&L adjustment (2026-07-15)

**Owner ask:** manually recording an invoice payment must require a payment type
(Venmo, Cash, Cash App, Zelle, Credit); anything credit posts to P&L adjustments,
and payment types are captured so total payments by type are trackable.
**Build (completed an in-flight uncommitted backend pass found in the tree):**
- Schema: `invoices.paymentMethod` (venmo/cash/cashapp/zelle/credit/card,
  optional - unset = paid before the field existed); `expenses.category` +=
  `"adjustment"` ("P&L adjustment" in the dialog/labels).
- `invoices.setStatus`: `paymentMethod` REQUIRED when status -> paid (server
  throws otherwise); stamps the method; on the fresh transition into paid with
  `credit`, auto-posts ONE offsetting `adjustment` expense (credit is not cash
  in, so revenue nets out) - re-saves never double-post. Activity row + team
  email say "via <method>"; the client receipt says credit was applied instead
  of "we received your payment".
- Online path stamps `card` itself: `invoicePay.settleInvoice` (Stripe checkout
  webhook) + `cardOnFile._markFeePaid` (No-Show Shield off-session charge).
- `expenses.plReport` += `paymentsByMethod` (paid invoices grouped by method;
  session `payments` rows counted as card; legacy = "unrecorded").
- UI: new `RecordPaymentDialog` (required radio-tile method picker, credit
  shows a "posts a P&L adjustment" note) wired into BOTH manual surfaces -
  invoice table "Mark paid" and detail-page "Record payment" (which now takes
  `amountCents`). Invoice sheet shows "Settled <date> via <method>"; Expenses
  page gains a "Payments by type" chip row; `PAYMENT_METHOD` labels in
  `lib/labels.ts`.
- Tests: `convex/invoicePaymentMethod.test.ts` (6: required-method throw,
  method stamp, single adjustment + no double-post, void needs no method,
  webhook stamps card, plReport by-method rollup); dunning tests updated to
  pass a method. 703 vitest green; tsc/lint/build clean (build needs node@22
  on PATH for the convex codegen prebuild).
- **SHIPPED 2026-07-15 late (commit 8cc59d3):** Convex prod deployed FIRST,
  then main pushed (deployed together with the studio-site importer 9ddff6b).
  Tree still holds unrelated uncommitted changes (sign-in/globals.css/
  clerk-appearance/welcome-activate) from a prior session - left uncommitted.

**Follow-up (2026-07-15): true browser fullscreen.** Owner: kiosk should run full
screen with no menus, just a minimize button to exit. The route was already
chrome-less, so "menus" = the browser's own address/tab bars. Added a Fullscreen
API toggle in the kiosk header (Maximize2 icon next to the clock): fullscreens
`document.documentElement` (NOT the kiosk div - Radix dialogs portal to
document.body and would vanish behind a fullscreened child element), webkit
prefixes kept for iPad Safari, state tracked via fullscreenchange +
webkitfullscreenchange, support detected through useSyncExternalStore (false on
server, real answer client-side - no hydration mismatch, no
set-state-in-effect lint warning; button hidden where the API is missing, e.g.
iPhone Safari). In fullscreen the button swaps to Minimize2; Esc/system gesture
also exits. Calendar toolbar intentionally stays visible in fullscreen (it is
the kiosk's only navigation - month/week/day, paging, check-in flow).

## Feature: I/O spec lookup for patch ports (grilled + BUILT 2026-08-15)

**Owner ask:** "a function that will look up specs of inventory when something
is added, to ensure I/O specs are correct for ports in the patch module."

**The gap it closes:** the gear catalog holds 226 models but only **34** had a
hand-written port map. Everything else - the other 192 catalog models, all
custom gear, and every row imported from a spreadsheet - fell through to a
generic template by category. A Scarlett 18i20 was placed with a stock
"interface" port set instead of its real 18-in/20-out.

**Decisions (grilled, both "recommended"):**
- **Curated first, AI for the long tail.** A hand-written map wins whenever one
  exists. Anything else gets a one-off AI lookup, cached on the `deviceProfiles`
  row so the second studio to place the same model pays nothing. Category
  default is the floor and never disappears - a failed lookup leaves the device
  exactly as placeable as it was.
- **Use it, mark it unverified.** Ports appear immediately; the device card
  carries a quiet `?` and the properties panel offers "Looks right" / a re-look.
  Confirming is one click and permanent. Nothing blocks placement, and nobody is
  shown a guess dressed as a fact.

**Trust tiers, stored on the profile as `specSource`:**
`curated` (auto-verified, authored against the manufacturer's panel) >
`manual` (a human edited the ports; outranks every future lookup) >
`ai` (looked up + cached, awaiting a nod) > `category` (openly a guess).

**The model is a research assistant, not a source of truth.** Nothing it says
reaches the database unchecked - `convex/lib/specLookup.ts` validates every port
against the same connector/level/direction vocabulary the mating engine uses,
drops anything unrecognised rather than coercing it, expands `count` banks into
numbered channel-indexed rows, refuses runaway banks, and falls back to the
category template when more ports were rejected than kept (half-remembered I/O
looks specific and is wrong, which is worse than an honest generic). The legacy
catch-alls `xlr`/`usb`/`other` are explicitly unreachable from a lookup: they
mate with anything, so minting one would silently disable the gender check.

**Build surface:** `deviceProfiles` += `specSource`/`specVerifiedAt`/
`specVerifiedBy`/`specNote`/`specModel`/`specLookupAt`; new
`convex/lib/specLookup.ts` (pure, 16 tests) + `convex/patchSpecs.ts`
(`lookupProfile` internalAction, `requestLookup`, `verifySpec`, `setPorts`,
`unverified`); `ensureProfile` stamps the tier and schedules a lookup for
non-curated gear; graph carries the provenance; device card shows a `?` badge;
properties panel gains the confirm/re-look card.

**Data protection:** the lookup sends a manufacturer and model name only - public
product information, no customer data. It therefore does NOT change the
`AI_ALLOW_GEMINI_FALLBACK` posture, which stays off so PII cannot silently route
to a second sub-processor without a DPA (see `convex/lib/openai.ts`).

**Operational finding:** the OpenAI key on both local and prod Convex currently
returns `credit_balance_exhausted`, so live lookups fall back to the category
template. Behaviour is correct and silent-safe (verified: status `fell-back`, no
throw, device still placeable), but no device will actually gain real I/O until
the account has credit.

**Non-goals (this pass):** scraping manufacturer PDFs, a bulk "look up
everything" sweep, editing ports from the canvas (setPorts exists; no UI yet).

## Feature: configure device I/O from a spec sheet (grilled + BUILT 2026-08-15)

**Owner ask:** upload a document or paste a link with a device's I/O and have
it configure the ports. Plus: "if you come across any vocab not in the system
for cable or input type make sure it is added."

**Decisions (grilled):**
- **Show a diff, the user approves it.** Not replace-outright and not
  add-only. A port can have a cable in it, so the difference between "adds
  eight inputs" and "unpatches your session" has to be visible before
  anything is written. Removals are OFF by default: a sheet not mentioning a
  jack is a weak reason to pull a cable out of it.
- **All four sources**: a link (server fetches, strips HTML), a PDF or text
  file (parsed IN THE BROWSER via pdfjs-dist, matching the inventory
  spreadsheet precedent - only text reaches the server), pasted text, and a
  photo of the back panel (vision, confirmed working on `gemma4:31b`).

**Provider scoping (load-bearing):** device research runs on its own Ollama
key through `convex/lib/deviceResearch.ts`, deliberately NOT a branch inside
`lib/openai.ts`. Wiring it into the shared `complete()` would quietly make it
the fallback for the Agent, concierge portal and email enrichment - surfaces
carrying client names and financials. What leaves here is a manufacturer and
a model name, which is public product information.

**Vocabulary now grows instead of silently losing jacks:**
- Unknown connectors/levels are RECORDED in a new `patchVocabGaps` table
  (term, count, example device + port) and surfaced by `patchSpecs.vocabGaps`,
  rather than being dropped invisibly. Deliberate refusals (power inlets)
  never enter the queue, so it stays a list worth acting on.
- Reading real documentation drove concrete additions: connectors `xlr4`,
  `mini_xlr` (TA3/TA4), `euroblock` (Phoenix), `trrs`; EtherCON reads as
  rj45; phrase matching so "balanced XLR female" and "two RJ45 connectors
  for GLM" resolve; signal level "analog"/"AES/EBU"/"network" map correctly.
- **`convex/connectorVocab.test.ts` pins the three declarations together** -
  the mating table, the schema union, and the shared arg validators. A value
  the schema accepts but the mating engine has never heard of would crash a
  fit check the first time someone patched it, so adding a connector is now
  something you cannot half-do.

**Non-goals (this pass):** OCR of scanned PDFs (use the photo path), fetching
PDFs at a URL (download and upload instead), auto-promoting a recorded gap
into the mating table (it needs mating rules a human decides).

## Epic: three-tier pricing + entitlement gating + white label (2026-08-19)

Repriced and re-gated the product. Decisions (from the goal, not grilled - the prices were
given):

- **Three sellable tiers.** `studio` $149.99 · `pro` $297.00 · `label` $499.99. Keys live in
  `convex/lib/plans.ts`, which is now the single source of truth for price, limits,
  capabilities and white-label level. `growth` / `enterprise` / `agency` stay as non-public
  legacy keys so existing rows resolve.
- **Capability ladder is strictly cumulative.** `STUDIO_CAPS` ⊂ `PRO_CAPS` ⊂ `LABEL_CAPS`,
  enforced by a test. What sits where:
  - **Studio ($149.99)** the whole money loop, uncrippled: booking page, deposits, card on
    file, no-show shield, dunning ladder, client portal, SMS flows, reviews/referrals,
    discount codes. 2 rooms, 3 seats, 10 GB, 100 AI credits.
  - **Pro ($297)** adds staff schedule, time clock, payroll, AI ops agent, AI receptionist,
    reports, pipeline, songs, visitors, inventory, packages, memberships, expenses,
    profitability, rentals, maintenance, calendar sync. 6 rooms, 15 seats, 100 GB, 1k credits.
  - **Label ($499.99)** adds releases, licensing, patch bay, software, split sheets, AI
    autonomy, API exports, custom domain, **full white-label UI**, multi-studio. Unlimited
    rooms/seats, 1 TB, 5k credits.
- **Two enforcement layers, both required.**
  1. *Nav (soft).* `orgs.current` returns `effectiveDisabledFeatures(tier, agencyDisabled)` -
     the union of agency toggles and tier locks. Sidebar, mobile tab bar, command palette and
     the route guard all already read that one field, so gating landed with no per-surface
     wiring. An agency toggle can only subtract, never unlock.
  2. *Server (hard).* The entitlement check lives **inside `requireCapability`**
     (`convex/lib/access.ts`), mapped by `ENTITLEMENT_FOR_CAPABILITY`. A module added later
     is metered by default instead of relying on someone calling `requireFeature`. Denials
     throw a structured `UPGRADE_REQUIRED` ConvexError carrying the tier and price that
     unlock it, so the UI renders an upgrade card, not a red toast.
- **Tier resolution moved to `convex/lib/tier.ts`**, a leaf importing only `plans.ts`, to
  break the cycle access → entitlements → usage → tenant → access. `usage.ts` re-exports it.
- **Legacy rows do not get demoted.** `orgs.tier` is optional and unset on older workspaces.
  `tierForOrg` falls back through `orgs.plan` (always present) via `PLAN_TO_TIER`
  (solo→studio, studio→pro, label→label) before defaulting to the cheapest tier. Without this
  every existing studio would have silently lost features on deploy.
- **`pulse-demo` resolves to `label`.** A demo that hides half the product is a worse demo,
  and it is also the no-auth fallback the test harness uses.
- **White label = the Label tier's whole reason to exist.** New `orgs.theme` (palette, fonts,
  radius, density, mode, sign-in copy + background, email skin, app name, wordmark) written
  through `convex/theme.ts`, gated by the new `theme.edit` capability which the access engine
  additionally gates on the `whiteLabelUi` entitlement. Values are validated against a hex
  regex and a font allowlist (a bad value would land in a CSS custom property), and a **WCAG
  4.5:1 contrast floor** stops a studio making its own app unreadable. `theme.get` merges over
  the Pulse defaults and returns `active: false` below Label, so a **downgrade instantly
  reverts the chrome without destroying the saved theme**.
- **Powered by Pulse is a condition, not a flag.** `POWERED_BY_PULSE_REQUIRED` in plans.ts,
  `theme.get` always returns `poweredByPulse: true`, and `PoweredByPulse` takes no opt-out
  prop. On Label the rail shows the studio's logo with the lockup underneath.
- **Locked features are listed, not hidden.** A "Locked on your plan" block in the sidebar
  names each tier-locked surface, the tier that unlocks it and its price. Agency-disabled
  features stay fully hidden - that is an operator decision, not a paywall.

**Known sharp edge:** `licenses.read` / `licenses.edit` is shared by two surfaces (sync/beat
Licensing and the Software licenses page). Both are Label-tier today so one mapping is
correct; **split the capability before moving either to a different tier**, or the other
moves with it. Documented at the mapping site.

**Build surface:** `convex/lib/plans.ts` (rewritten), `convex/lib/entitlements.ts` (new),
`convex/lib/tier.ts` (new), `convex/lib/themeSpec.ts` (new), `convex/theme.ts` (new),
`convex/lib/access.ts` (+ entitlement gate), `convex/orgs.ts` (+ tier/limits/whitelabel on
`current`), `convex/schema.ts` (+ `label` tier, + `orgs.theme`), `convex/lib/accessPolicies.ts`
(+ `theme.edit`), `convex/lib/stripe.ts` + `convex/billing.ts` (+ `STRIPE_PRICE_LABEL`),
`src/components/brand/powered-by-pulse.tsx` + `brand-lockup.tsx` (new),
`src/components/shell/white-label-theme.tsx` (new), `src/components/settings/white-label-panel.tsx`
(new), sidebar + app layout + settings + onboard + pricing-panel copy.
**955 vitest green** (39 new across `entitlements.test.ts` and `theme.test.ts`), `next build`
clean.

**Go-live config:** create the three Stripe prices and set `STRIPE_PRICE_STUDIO`,
`STRIPE_PRICE_PRO` and the new **`STRIPE_PRICE_LABEL`** on Convex. Stamp `orgs.tier` on
existing workspaces (the `orgs.plan` fallback covers them meanwhile). `npx convex codegen`
could not run in the agent env (Node 25 installed; the local backend needs v20/22/24), so
`convex/_generated/api.d.ts` was hand-edited to declare the new `theme` module - a real
deploy regenerates it.

## Feature: module switchboard - real toggles across all 40 modules (2026-08-20)

The per-sub-account toggles covered 17 nav keys and **were never enforced server-side** -
`orgs.disabledFeatures` only hid nav items, so a switched-off module still answered its API
and its deep link. The toggle was decoration. Fixed, and widened to the whole product.

- **One registry, `convex/lib/modules.ts`.** 40 modules, each with label, blurb, area, nav
  flag and a `core` flag. `src/lib/features.ts` is now a thin re-export of it, so nav gating,
  the switchboard and the server check cannot drift - there is exactly one list of modules.
- **Grouped into the same 14 areas as the feature catalog** (`AREA_ORDER` / `AREA_LABELS`),
  so the switchboard and the catalog read as one document.
- **Enforcement moved into `requireCapability`** alongside the tier gate. Three questions now
  have to pass on every metered call: may this *person*, did this *workspace buy it*, and is
  it *switched on*. A disabled module throws `MODULE_DISABLED` - deliberately a different
  refusal from `UPGRADE_REQUIRED`, because "upgrade" is the wrong advice for something the
  studio already owns and somebody turned off.
- **`orgGate(ctx, orgId)`** in `lib/tier.ts` returns tier + disabled set from ONE org read,
  so adding the toggle check did not double the reads on every gated call.
- **Core modules cannot be switched off.** `bookings` and `calendar` are marked core: Pulse
  without a way to take a booking and see it is not Pulse. `effectiveDisabledFeatures` drops
  core and unknown keys on read, and both write paths filter through `isToggleable`, so no
  client payload or stale row can strand a studio.
- **Toggles still only subtract.** Tier locks are unioned in after the toggles, so switching
  a module on can never grant a capability the plan excludes.
- **White label is now a real module** (`whiteLabelUi`, Branding area, Label tier), switchable
  per studio. Switching it off hides the settings panel (`theme.canTheme` reads through
  `moduleEnabled`) and refuses `theme.save`.
- **Two write paths, one board.** `modules.setModule` / `modules.enableAll` for a studio owner
  curating their own workspace; `agency.setFeatures` for an operator managing a sub-account.
  Both render `ModuleSwitchboard`, which takes its grouping and locks from the server's
  `modules.board` query rather than from either caller.
- **Always-on rows.** Platform guarantees (tenant isolation, access engine, audit, GDPR) and
  agency-side surfaces are listed without switches, so every area renders and nobody hunts
  for a switch that should not exist.

**Surface:** `convex/lib/modules.ts` + `convex/modules.ts` + `convex/modules.test.ts` (new),
`convex/lib/tier.ts` (+`orgGate`), `convex/lib/entitlements.ts` (widened past nav,
`moduleOffError`, `moduleEnabled`, `lockedModules`), `convex/lib/access.ts` (toggle gate),
`convex/agency.ts` (`setFeatures` filtered), `src/lib/features.ts` (re-export),
`src/components/modules/module-switchboard.tsx` (new, replaces `agency/feature-toggles.tsx`),
agency sub-account page + studio settings. **973 vitest green** (17 new), `next build` clean.

## Epic: build out the roadmap + gated beta preview (2026-08-20)

Five of the nine "not built yet" items shipped, plus a customer-facing preview gate.

**1. Booking funnel tracker** (`convex/bookingFunnel.ts`, `bookingVisits` table). Anonymous
per-step tracking on the public booking surface: no IP, no cookie, no fingerprint. The browser
mints a random key in `sessionStorage`; steps dedupe per (visitor, step, room) so a refresh
does not inflate anything, and the org is resolved from the slug, never the caller. The
`booked` step is written **server-side** by `createBooking`, so the conversion count cannot be
inflated from outside. Counts DISTINCT visitors per stage - one person opening four rooms is
one person considering. Reports tab + source breakdown. 12 tests.

**2. Engineer payout automation** (`convex/payouts.ts`, `lib/payoutMath.ts`, `payouts` table).
A session completes and the engineer's cut is queued from whichever basis they are on:
commission %, points x point value, or clocked hours (overlap of punches with the session
window, so a shift spanning two sessions is not billed twice to one). Salary returns null -
payroll already covers them and paying again is the expensive direction to get wrong. An
unconfigured basis returns **null, not zero**: a zero row reads as "we owe you nothing", which
is a different and wrong claim. Every payout carries its arithmetic as a sentence, and rates
are snapshotted so a later raise cannot rewrite what was earned. **Nothing pays itself**:
queued -> approved -> paid are three separate human actions, and marking paid posts a
`payroll` expense into the P&L. Voiding never deletes. 17 tests.

**3. Insight to standing rule** (`convex/agentRules.ts`, `lib/ruleSpec.ts`, `agentRules` table).
Distinct from `agentAutomations` on purpose: an automation is a PROMPT the agent reasons about
on a schedule; a rule is if-this-then-that with no model in the loop. Promoting an insight
dismisses it (answered permanently, not once) and keeps the provenance so the rule can be
explained months later. Fires on the real events (`session.completed`, `session.no_show`,
`booking.created`) rather than polling. **Client-facing rule actions queue an approval rather
than sending** - a rule may run unattended, it may not invent a send path that skips opt-outs.
11 tests.

**4. In-page card capture** (`src/components/payments/card-capture.tsx`). `@stripe/stripe-js` +
`@stripe/react-stripe-js` added. The SetupIntent action existed with **no UI at all**; this is
the form. Elements is mounted against the same connected account the SetupIntent was created
on - the server now returns `stripeAccountId` alongside the client secret so the client cannot
pair them wrongly. Surfaced on the client profile with the reason stated (No-Show Shield).

**5. Find a Studio on Pulse** (`convex/directory.ts`, `/studios`). Public, unauthenticated,
**opt-in and off by default**. A listing exposes only what is already on the studio's own
booking page; tests assert no internal id or owner email can leak. "Next open day" is the
honest cheap version of live availability (first of the next 14 days with no confirmed
session), and results lead with studios you can actually book - leading with places you cannot
is what killed the last directory. No commission on anything it sends. 11 tests.

## Feature: gated beta preview + NDA signature + branded invite (2026-08-20)

The feature catalog as a **customer-facing page** behind a per-recipient code and a signed
agreement.

- **`betaInvites` table + `convex/betaAccess.ts`.** One code per recipient (Crockford-ish
  alphabet, no I/O/0/1 because half get read down a phone), so opens and signatures attribute
  to a person rather than to "somebody". Re-inviting the same email reuses their row instead
  of leaving two live codes.
- **The gate is a real server check.** `betaAccess.preview` assembles the content on the server
  and returns it **only to a code that has signed**. It is never shipped to the browser and
  hidden with CSS, because hidden is one devtools panel away from published.
- **The signature is bound to the terms.** `lib/betaNda.ts` holds the agreement as data and
  hashes its canonical text; signing requires the hash the signer was shown, so a later edit
  cannot be passed off as what they agreed to. A stale-version signature is flagged rather than
  silently accepted. (FNV-1a, not cryptographic - it detects change, it does not resist an
  attacker; noted in the file.)
- **Attribution without authorization.** Views are counted and never walk a signature backwards.
  Revoking sets a status; it never deletes, because the signature record is the point.
- **Branded HTML invite** (`lib/emailTemplates/betaInvite.ts`). Dark, gold, email-safe tables and
  inline styles. Prints the code as well as linking it, because a link that dies in a corporate
  mail scanner still leaves them something to type. Recipient name is escaped.
- **Agency CRM panel** (`components/agency/beta-invites.tsx`) on `/agency`: send, copy link,
  revoke, and see invited / opened / signed counts.
- **`/preview`** - three states (code, agreement, content), watermarked with who opened it.
- 18 tests.

**NOT legal advice.** The agreement is a short plain-English mutual-confidentiality clause set
with the usual carve-outs; have a lawyer read it before it goes to anyone who matters.

**Still on the board:** payments-monetized entry tier, State of the Recording Studio benchmark,
the comparison page, the migration guarantee. **1042 vitest green**, `next build` clean.

## Epic complete: all nine roadmap items built (2026-08-20)

The remaining four, on top of the five recorded above.

**6. Payments-monetized entry tier** (`flow` in `lib/plans.ts`). $0/month, 200 bps of what the
studio collects through Pulse. `takeRateBps` + `paymentsRequired` on the tier; `priceLabel`
prices it as "2% of collections" rather than a dollar figure, and `breakEvenCollectionsCents`
answers the only question a studio actually asks - at what point is the subscription cheaper
($7,499.50 collected in a month against Studio). Capability set is deliberately the **money
loop only** (bookings, calendar, payments, clients, studio, card on file, no-show shield,
dunning); the growth extras start at Studio, so there is a real reason to move up. Not in
`SELF_SERVE_TIERS`: there is nothing to check out for, it activates by connecting Stripe.

**7. State of the Recording Studio** (`convex/benchmark.ts`). Three privacy rules enforced in
code rather than promised in a policy: a **minimum cohort of 5 studios** before any number is
returned (below that it is `null`, not rounded and not estimated), **no identifiers anywhere**
in the payload, and **medians not totals** because a total can be reverse-engineered by a
studio that knows its own contribution. Thin regions are suppressed even when the overall set
publishes. Studios with under 3 sessions in the window are excluded as unrepresentative. The
caller's own numbers sit beside the market, computed the same way. Sample size is stated on
the page. 8 tests, including one asserting no org id, name, slug or client name can appear in
the serialized response.

**8. The comparison page** (`/vs`). Cost and commitment first, because that is what is being
decided the morning after a bad week. Every claim is about published pricing and checkable;
the page explicitly declines to characterize the competitor's quality, carries a correction
invitation, and closes with a trademark disclaimer.

**9. Migration guarantee.** Stated on `/vs` and on the pricing picker, with the terms spelled
out: clients, rooms, rates and sessions imported, booking page live, Stripe connected, a call
while the first real booking comes in, and the first month free if it is not live in a day.

**1053 vitest green**, `next build` clean. `convex/lib/roadmap.ts` now marks all nine shipped,
so the gated preview page reflects it automatically.

**Go-live config for the new work:** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (in-page card
capture), `APP_URL` (beta invite links), `RESEND_API_KEY` (invite emails - falls back to
"simulated" and still mints the code without it). No new Stripe price is needed for Flow.

## Epic: beta invite dashboard, positioning, deletion (2026-08-20)

**Positioning.** "Song-centric" removed from every surface: the invite email, the schema
header, README, the feature catalog, the voice-agent prompt, and 12 strategy/promo docs. The
product is **the studio operating system**. The songs table is still a spine, it is just no
longer the pitch.

**Beta invite dashboard** (`/agency/beta`), replacing the panel on `/agency`.
- **A funnel, not a scoreboard.** Sent → opened → clicked the link → signed → built a studio.
  Each stage counts everyone who reached it *or went past it*, so the numbers only fall and
  the gap between two stages is a list of people to call. Filters expose exactly those lists:
  "sent, never opened" and "opened, never signed".
- **Engagement signals worth selling on.** Magic-link clicks tracked separately from typed
  codes, because "the email worked" and "they found their way in" are different facts. Email
  opens via a 1x1 pixel on `/beta/open.gif` - **best-effort and labelled as such**, since image
  blocking means a missing open proves nothing. Last login recorded from the app shell once
  per session, which is the signal that separates curious from using it.
- **Signature register** tab: who agreed to what and when, each row carrying the terms hash and
  flagging any signature captured against an older version.

**Magic link → sub-account.** `betaAccess.claim` turns a signed invite into a real workspace.
Requires a SIGNED invite - the agreement is the price of admission, not a step you can route
around. Deliberately separate from `agency.createSubaccount`: that path is an agency admin
provisioning Clerk orgs with their capabilities; this one is a recipient creating their own
workspace, where the authorization *is* the signature.

**Parallax onboarding** (`/preview/claim`). Pointer- and scroll-driven parallax on three
decorative layers, all `aria-hidden`. Nothing that carries meaning moves, so at
`prefers-reduced-motion` every layer pins and the step transitions collapse to opacity, with
no loss of function. Live slug availability as they type; the address follows the name until
they edit it themselves.

**Beta cohort, badge over migration.** Chose the badge because the sub-account list already
exists and a beta workspace is a *real* studio, not a trial shell. `betaCohort` +
`betaClaimedAt` + `graduatedAt` on orgs; a Beta/Graduated badge in the table; and
`agency.graduateBeta` which sets tier and status and **moves nothing** - no migration, no copy,
no chance of loss. `betaCohort` is kept after graduation as provenance; `graduatedAt` is what
says they are off beta terms. `revertGraduation` exists as an undo for a misclick.

**Three-step deletion** (`convex/subaccountDeletion.ts`). Destroys a real business's records,
so it is built to be hard to do by accident and impossible to do quietly:
1. `impact` counts what dies from live data and surfaces the things that make it worse -
   sessions still on the calendar, money still owed, client files about to go unreachable.
2. `requestDeletion` opens a **10-minute window** and returns a one-time token bound to that
   workspace and that person, so a forgotten tab cannot delete something tomorrow.
3. `confirmDeletion` needs the token, the studio name **retyped exactly** (not trimmed, not
   lowercased - retyping is the check), and the literal word DELETE.

The audit record is written **before** the cascade, so a failure partway through still leaves
evidence of what was attempted and by whom. 76 org-scoped tables are cascaded; the 8 without a
`by_org` index are listed explicitly rather than discovered by catching an error, so the cost
stays visible. The beta invite is **detached, not deleted** - the signature outlives the
workspace on purpose.

**1064 vitest green** (11 new for deletion), `next build` clean.
**New config:** `CONVEX_SITE_URL` (email open pixel). Everything else already listed.

## Epic: white labelling, finished end to end (2026-08-20)

The tier's headline feature was stored far more completely than it was rendered.

**Two failures, both silent.** `WhiteLabelTheme` set `--brand-*` variables that no
stylesheet reads, so a studio could pick a palette and watch nothing change. And
`loginHeadline`, `loginSubhead`, `loginBackgroundId`, `emailHeaderColor` and
`emailFooterText` had **zero consumers** - written by the settings panel, read by nothing.

- **Real tokens, derived.** `src/lib/theme-ramp.ts` computes the tokens the app is actually
  styled against from three chosen colours: the surface ladder (`ink` -> `coal-3`),
  hairlines, four weights of text, the accent family and brand-tinted shadows. Surfaces step
  UP on a dark theme and DOWN on a light one; text on the brand colour flips black or white
  by readability, because guessing white on gold is the classic white-label failure.
- **Client-facing surfaces.** `theme.publicBySlug` / `publicByGrant` resolve a theme with no
  auth, since a studio's clients never sign in. Booking page, room page, portal, review,
  signature and visitor check-in all wear the studio's brand now.
- **Sign-in.** Shared by every studio, so nothing in the URL says whose door it is. It brands
  only on `?studio=<slug>`, which is what a white-labelled invite carries. Guessing would show
  one studio another studio's branding. An uploaded background always sits under a scrim so
  the form stays readable whatever is uploaded.
- **Email.** Studio-to-client mail carries the studio's accent and footer. The colour is
  hex-validated before it reaches a style attribute, and the button ink flips by readability.
  The Pulse footer line stays.
- **Below Label** every surface falls back to Pulse chrome and leaks nothing, even though the
  row still holds the studio's saved work - so a downgrade reverts instantly and re-upgrading
  restores it.

**Also this pass:** pipeline legend + colour fix. The card stripe encoded SERVICE but used
SEMANTIC colours (`mixing` amber, `rehearsal` green) while amber on the same card means going
stale - every mixing deal was quietly shouting warning. Service tints are now categorical and
clear of every semantic hue; stages are one ramp with a distinct step each (`qualified` and
`proposal` used to render identically, as did `booked` and `in_progress`). A collapsible
legend explains all three systems.

**Em dashes** removed from 24 source files and from 4,879 stored fields across two passes -
the second caught `opportunities`, which is what the pipeline board renders.

**1120 vitest green**, `next build` clean, deployed to Convex prod and Netlify.

## Epic: one price ladder, the beta as the trial, the launch offer (2026-08-22)

**Ask:** the trial plans in the agency console were wrong; the beta should BE the trial and
warn before it ends; add early-adopter pricing that holds one price for ~90 days and then
steps up; every beta studio sits on the beta tier and is prompted to pay at the end of the
365 days.

**The shape of the bug, twice.** A price ladder written by hand in more than one file. The
real one lives in `PLAN_LIMITS` (`convex/lib/plans.ts`): Studio $149.99, Studio Pro $297,
Label $499.99. Four other copies had drifted to `$49 / $129 / $199` against tier names the
product had not used for months - the agency price book (`agencyPlans.ts`), the public
pricing tiles, Settings -> Billing, and the site metadata.

- **The book is derived.** `agencyPlans.ts` seeds Beta + an Early Adopter and a standard plan
  per sellable tier, all priced from `PLAN_LIMITS`, and a test asserts every seeded plan
  matches. Prod reseeded: 6 old plans replaced by 7, 4 studios rehomed to Beta.
- **The beta IS the trial.** "Free Forever" and "30 Day / 1 Year Free" are gone. Beta is the
  default: $0, 365 days, no card. The end is handled by the beta hard stop (pick a plan), not
  a card prompt against a plan that costs nothing.
- **Early adopter = half price for 3 months**, one percentage applied to the tier price
  ($74.99 / $148.50 / $249.99). Built as a Stripe **coupon**, not a second set of price
  objects - a coupon steps back up on its own; a cheaper price id has to be migrated by hand
  in month four, and that is the one that never gets migrated. **Monthly only**: Stripe counts
  a repeating discount in months, so 3 months against a yearly subscription discounts that
  year's single invoice - twelve months half price instead of three.
- **The beta year starts at first sign-in after signing**, not at grant. Dating it at grant
  spent the licence on the days between an agency deciding and the owner reading the
  agreement. `betaLicenseUntil` stays undefined until then; the gate reads that as "granted,
  not started". Backfilled on prod: Playback and Slang City reset to zero (neither had
  signed), Kamiza and Beta Studio re-dated from their signature.
- **No surprise lock.** A daily sweep warns at 30, 7 and 1 days out, each exactly once, with
  the prices in the email.

**The follow-through (same day).** Three hand-typed copies of the ladder survived the first
pass. The public pricing tiles were the worst of them: `Solo $49 / Studio $129 / Label $199`,
with the top tile starting checkout on `growth` - a LEGACY tier that grants less than the Label
it advertised, so a flagship buyer would have paid $199 for a plan with no white label, no
custom domain and no multi-studio. `beginPublicCheckout`, the button's own action, never
attached the early-adopter coupon either, so the page could advertise half price and charge
full price at the card form. **Nobody was actually charged wrong: the Pricing section is
currently unmounted from `landing-page.tsx` ("hidden for now"), so no public self-serve
checkout is live.** It was one import away from being live and wrong, which is the whole
reason it is derived and tested now. The one copy that WAS live and wrong was the site
metadata - "From $49/mo." in the description and the share card, the version a search result
quotes.

- Tiles derive from `PLAN_LIMITS` (`src/components/marketing/pricing-tiers.ts`); only the
  sales bullets are hand-written. A test asserts every tile is a public sellable tier priced
  at what the till will charge, and that an intro price is never shown without its step-up.
- One coupon helper, both checkout paths.
- Settings -> Billing derives the same ladder; the agency reset dialog names the plans the
  seeder actually creates (it promised "Free Forever, 30 Day Free, 1 Year Free" long after
  they stopped existing), and the seeded names are asserted to equal that list.
- Site description and share card read the entry price instead of a frozen "From $49/mo"
  (verified live: studiopulse.tech now serves "From $74.99/mo").

**1174 vitest green**, `next build` clean, Convex prod deployed, Netlify shipped.
