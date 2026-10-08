## Why

Demo bookings arrive from the Zuops form (studiopulse.tech/demo) into Pulse every minute. An external Netlify receiver ("pulse-zuops-bland-receiver", source unavailable) used to place an automated Bland AI confirmation call. It never fires reliably, and its rules (who gets called, when, how often) are hard-coded and invisible. The owner decided on 2026-10-07 to rebuild the call step inside Pulse so every rule lives in the repo and is visible in the Agency console.

This is an automated AI call to a private person. That is TCPA territory (prior express consent for artificial or prerecorded voice, calling-time limits, opt-out honored immediately, recordkeeping). The design therefore treats every rule as a gate that fails closed, and ships OFF and in dry run.

## What Changes

- New tables `outreachCalls` (one row per booking, ever), `outreachCallSettings` (one row per agency), `outreachCallOptOuts` (phone and email do-not-call list).
- The Zuops sync also keeps the lead's phone on `outreachBookings` (only there, never logged, never returned to the browser unmasked).
- A cron every minute runs `dispatchDueCalls`. For each agency whose settings say `enabled` and not `killSwitch`, it evaluates every upcoming booking against a pure eligibility function and either records a skip with a reason, waits, records a dry run (exact request body, no network), or claims the call and POSTs to Bland.
- A Bland client (`convex/lib/bland.ts`) and a verbatim-sourced call script (`convex/outreach/callScript.ts`).
- `POST /bland/events` result webhook guarded by `BLAND_WEBHOOK_SECRET` (503 unset, 401 wrong). A do-not-call request on the call marks the contact `callOptOut`.
- Agency > Outreach > Settings gets a "Confirmation calls" controls card. Agency > Outreach > Meetings gets a "Confirmation calls" list.
- `docs/CONFIRMATION-CALLS.md`: enable, go live, retire the old Zuops webhook.

## Capabilities

### New Capabilities
- `agency/confirmation-calls`: settings, eligibility, dispatch, Bland client, result webhook, opt-out, console UI.

### Modified Capabilities
- `outreach/zuops-sync`: now also stores the lead phone on the booking row.

## Impact

- Convex: `convex/outreach/callTables.ts`, `convex/outreach/callPolicy.ts`, `convex/outreach/callScript.ts`, `convex/outreach/blandWebhook.ts`, `convex/lib/bland.ts`, `convex/outreachCalls.ts`; edits to `convex/outreach/tables.ts`, `convex/outreach/zuops.ts`, `convex/outreachZuops.ts`, `convex/crons.ts`, `convex/http.ts`.
- Web: `src/components/agency/outreach-calls.tsx`, small edits to `outreach-panels.tsx`.
- Env (set by the owner, never in code): `BLAND_API_KEY`, `BLAND_WEBHOOK_SECRET`.
- Risk: a real person is phoned by an AI. Mitigated by default-off, default-dry-run, a script-approval gate in code, consent re-check against Zuops right before dialing, calling window, daily cap, kill switch, and no automatic retry of a dial.
- Overlap to resolve before going live: the old Zuops webhook "Pulse OS native booking confirmation" (id 5412aeef-2f3c-49aa-98c2-226eef800cfd) and the separate GHL-driven Pulse Walkthrough Bland path (`convex/pulseWalkthrough`) must not call the same person.
