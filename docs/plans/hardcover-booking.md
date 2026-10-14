# Booking requests, room blocks, change approvals, Google sync, brand theming

Plan for the features first asked for by Hardcover, built for every studio. Status: PLAN, awaiting Lawrence's go.
Source brief: `hardcover-booking-orchestrated-prompt.md`. Branch `feat/hardcover-booking` off `develop`.

## Rules for the whole build

- Every behavior is a per-studio setting, **off by default**, so no live studio changes until someone turns it on.
- The agency can turn each setting on for one studio or many from the agency console (new bulk control).
- Flow: `develop` → staging (studiopulse-staging.netlify.app + Convex `fiery-cricket-350`) → Lawrence tests → "ship it" → `main` + prod Convex deploy. No direct prod deploys.
- The iOS app mirrors `orgs` and `sessions`: new fields are optional only, never renamed (see the 1.2.1 hotfix lesson).
- Copy: "Pulse, the studio OS", never CRM, no em dashes, American spelling.

## What already exists (survey 2026-10-14)

| Feature | Today | Gap |
|---|---|---|
| Booking without prices | Public pages `/book/[slug]`, `[roomId]`, `s/[serviceId]`, `checkout/`. Price = rate × hours + add-ons, deposit %, Stripe direct charge. Engineer + gear add-ons exist. | No hide-prices setting. Unpaid holds auto-cancel after 60 min (`automation.tick`). Directory also shows rates. |
| Approval | Public bookings land `tentative` and hold the slot. Only payment or the engineer accepting confirms them. `opsActions` inbox already executes `session_status`. | No "request" state, no approve/decline for owners/managers, no "request received / confirmed / declined" email or text. |
| Room blocks | Only workaround: a `custom` session with a label. | No blocks table; availability checks only look at sessions. |
| Edit permissions | `reschedule`/`extend` need `sessions.edit`. `setStatus` and `create` check nothing. | Sessions don't record who created them. No change-request flow. Interns can cancel bookings today (bug). |
| Google sync | OAuth, 10-min pull, push trigger on every session change, sync status card. All in prod. | 0 of 7 studios connected. Google OAuth app is in **Testing** mode, so connecting is blocked and tokens die in 7 days. Callback sits on `convex.site`, which Google will never verify. Push errors are invisible. |
| Brand theming | Accent color recolors buttons at every tier; full theme on Max only; booking page uses logo + accent. | Animated background, tiles and booking-page wash are hard-coded gold. No presets. |
| Second Stripe per member | Studio has one Connect account. Payouts to staff are manual. | Design note only. |

## Order of work

### Phase 0. Foundation (orchestrator, about 3 hours)
1. `orgs.booking` settings object: `requestMode` (hide prices + no payment), `requireApproval`, `roomBlocks`, `changeApproval`. All default off.
2. `sessions.createdByMemberId` + `requestStatus` (pending / approved / declined) + `declineReason`. Optional fields.
3. One shared `isRoomBusy(roomId, start, end)` used by public availability, `createBooking`, internal create, reschedule and the directory. Sessions + room blocks feed it.
4. Booking message templates (request received, new request for staff, confirmed, declined, change requested, change approved) for email and SMS.
5. Close the permission gap: `setStatus` needs `sessions.edit` (cancel needs `sessions.cancel`).
6. Agency console: "Booking features" panel with per-studio switches and "apply to selected studios".

### Phase 1. Parallel (about 1 day wall time)
- **A. Requests + approval.** External link creates a pending request (slot held, no 60-min expiry). Booker gets email + text "request sent". Owners/managers get email + push + an Approve/Decline card in the inbox and on the booking. Approve → confirmation email + text with date, time, room, engineer, studio address. Decline → polite email + text.
- **B. Booking without prices.** With `requestMode` on, the public pages and directory never send prices to the browser (server strips them, same pattern as `showGearOnBooking`). Flow: room → room availability → time → engineer + gear request → submit. Price still computed and stored on the session for internal billing.
- **C. Room blocks.** Owners/managers block a room by day, week or month (start + end, label like client name or maintenance). Shows on the calendar, blocks the public link and internal booking, valued at the room's hourly rate for reports.
- **D. Google sync, two levels.**
  - **Studio (company) calendar:** the owner connects once and picks which Google calendar is the studio's shared one (not just "primary"). Every booking, request (tentative), approval (confirmed) and room block is pushed there. Busy time on it blocks the whole studio.
  - **Team member (personal) calendar:** each team member connects their own Google account from their profile. Their own sessions and shifts are pushed there. Their busy time blocks only them: they can't be requested or assigned as engineer then, and it shows as "Busy" (no titles, for privacy) on the schedule.
  - New `memberCalendars` connection per member (own token, own sync state); the existing org-level fields stay the studio calendar.
- **D (fixes).** Code: surface push errors, detect revoked tokens, specific callback errors, warn when no refresh token. Config (needs Lawrence): publish the OAuth app, move the callback to `studiopulse.tech`, start Google verification. Pending requests push as "tentative", approved as "confirmed", blocks as busy events.

### Phase 2 (about 1 day)
- **E. Change approvals.** Anyone can create a booking. Changing someone else's booking becomes a proposal: the creator (or owner) gets notified and approves or declines; history shows who asked and who approved.
- **F. Brand theming.** Animated background, tiles and booking-page wash read brand tokens, same motion. Four presets plus custom colors, contrast-checked to WCAG AA. Available to every tier.

### Phase 3
- **G. Second Stripe per member.** Design note only, behind a disabled flag.
- **iOS.** Approve/Decline and change approvals in the Pulse app (`pulse-native`), shipped through Xcode Cloud after the web version is proven.

## Done means
Each feature on staging with a demo studio that has it switched on and one that has it off (unchanged behavior), tests green (`tsc`, vitest), browser check on Chromium/Firefox/WebKit, pentest on the public booking request path before ship.

## Decisions (Lawrence, 2026-10-14)
1. Every plan (Core, Growth, Max) gets all of it.
2. "Require approval" and "hide prices" are two separate switches.
3. Google busy time BLOCKS bookings (public link and internal), replacing the soft-block design of 2026-06-01.
4. Google: publish the OAuth app and move the callback to `studiopulse.tech`; Claude builds the route and walks Lawrence through the console clicks.

5. Google Calendar at two levels: a shared studio calendar plus a personal calendar per team member (Lawrence, 2026-10-14).

## Still open
- Is Hardcover a new studio to create in Pulse, and on which plan?
