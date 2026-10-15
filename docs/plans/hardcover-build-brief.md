# Build brief for every agent (hardcover-booking)

Read first: `docs/plans/hardcover-booking.md` (what and why), `AGENTS.md`, this file.

## Foundation already on `feat/hardcover-booking` (do not redo)
- Schema (`convex/schema.ts`, owned by the orchestrator: if you need a schema change, STOP and report it instead of editing):
  - `orgs.bookingFeatures` { hidePricing, requireApproval, roomBlocks, changeApproval } all off when unset
  - `orgs.googleCalendarId`, `googleCalendarName`, `googleSyncDirection` (two_way | push | pull | off, default two_way), `googleCalendarPushError(At)`, `brandPreset`
  - `sessions.createdByMemberId`, `requestStatus` (pending | approved | declined), `requestDecidedBy/At`, `declineReason`, `pricingHidden`, `googleChangedAt`
  - tables `roomBlocks`, `sessionChangeRequests`, `memberCalendars`, `memberBusyBlocks`
- `convex/lib/roomBusy.ts`: `roomBusyIntervals`, `roomConflict`, `conflictMessage`, `sessionHoldsSlot`, `memberBusyIntervals`, `memberIsFree`, `studioPullsGoogle`, `studioPushesGoogle`, `bookingFeatures(org)`. Public availability, createBooking and `assertNoBufferConflict` already use it.
- `convex/lib/bookingMessages.ts`: requestReceived, newRequestForStaff, requestApproved, requestDeclined, changeRequested, changeDecided (subject/body/sms). Send with `notify()` / `notifyTeam()` from `convex/lib/notify.ts`.
- `sessions.currentMemberId(ctx)`; internal create + pipeline bookings stamp `createdByMemberId`. `setStatus` now needs `sessions.cancel` to cancel, `sessions.edit` otherwise.

## Rules
- Every behavior is gated by its per-studio switch and is OFF by default. With the switch off, behavior must be byte-for-byte today's. Add a test proving the off path is unchanged.
- Server enforces everything; the UI only reflects it. Public endpoints never return prices when hidePricing is on, never return client names or Google titles.
- Permissions: use `currentOrgWithCapability` / `requireCapability` (`convex/lib/tenant.ts`, `convex/lib/access.ts`). Owners and managers approve.
- Mutations import `mutation` / `internalMutation` from `./functions` (triggers + changeLog). Keep any single mutation small (1s limit on prod).
- iOS mirrors `orgs`, `sessions`, `members`: only add optional fields (orchestrator does), never rename.
- UI: React + Tailwind v4 in `src/`; reuse existing components and patterns in the same folder; `@untitledui/icons` for new icons. Put new UI in NEW component files and mount them with a one or two line change in shared files (booking-sheet, session-sheet, inbox, settings) to keep merges clean.
- Copy: "Pulse, the studio OS", never CRM, no em dashes or en dashes, American spelling, plain words.
- Tests: vitest + convex-test, colocated `*.test.ts` like the existing ones. Run `npx tsc --noEmit -p .` and `npx vitest run <your tests>` with node 22 (`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`). Known pre-existing failures to ignore: `convex/marketing/results.test.ts`, `convex/lib/agentScope.test.ts`.
- Git: commit on your own branch in your own worktree with clear messages ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push, do NOT deploy, never touch prod or a CONVEX_DEPLOY_KEY, never call Stripe/Google/GHL/Twilio live.
- Final report: what's done, files changed, tests added, anything partial or blocked, anything the orchestrator must do (schema, env vars, console steps).
