# Confirmation calls

Pulse places an automated Bland AI call to confirm a booked demo. Every rule lives in this repo. The feature ships OFF and in DRY RUN. Spec: `openspec/changes/confirmation-calls/`.

This is an automated AI call to a person (TCPA territory). It is a build-time guardrail, not legal advice. Run a dry run first, read the rows, and have counsel look at the consent wording on the Zuops form before going live.

## What it does

Every minute the cron `confirmation-calls` runs `outreachCalls.dispatchDueCalls`. For each upcoming booking of an agency that turned the feature on, it applies these rules in order. The first failure decides:

| Rule | Result |
|---|---|
| Booking cancelled | row `cancelled` |
| Booking not `confirmed` | skipped `not_confirmed` |
| Zuops lead not read yet | waits `awaiting_lead` |
| `consent.call` is not the boolean `true` | skipped `no_consent` |
| Booking row created before calls were enabled | skipped `predates_enable` |
| Phone or email on the do-not-call list, or email on the suppression list | skipped `opted_out` / `suppressed` |
| Name looks like a test (unless `allowTestBookings`) | skipped `test_booking` |
| Demo starts in less than delay + 5 minutes | skipped `too_close` |
| No phone yet | waits `no_phone` |
| Phone is not a valid US number | skipped `invalid_phone` |
| Delay after booking not elapsed | waits `not_due` |
| Outside the calling window in the callee's zone | waits `outside_window`, retried every minute until the demo is too close |
| Daily cap used up | waits `daily_cap` |

One row per booking, ever (`outreachCalls`). A real dial is claimed before the network call and is never retried automatically: a failed dial shows as `failed`. Right before a live dial, Pulse re-reads the Zuops lead and requires the call consent to still be `true`.

## Settings (Agency > Outreach > Settings > Confirmation calls)

Owner only (an owner or admin can hit the kill switch; only the owner lifts it). Defaults: enabled false, mode dry run, delay 5 minutes (1 to 120), window 09:00 to 20:00 every day in the callee's zone (booking timezone, else America/Los_Angeles), daily cap 5 (per calendar day in the default zone, counting every dialed call), longest call 5 minutes, from number +14086921713 (change it in Settings, it is not in code), kill switch off, test bookings not allowed. The Outreach "Pause" also stops calls.

## Enable it

1. Review `convex/outreach/callScript.ts`. Its persona, guardrails and voice are copied verbatim from `Pulse-Voice-Agent-Prompt-v2.md`, which is a cold-call prompt. The confirmation objective and first sentence are new text. When you are happy with all of it, set `CALL_SCRIPT_APPROVED = true` in a commit. Until then live calling is blocked with the reason `script_unapproved`.
2. Check a real Zuops lead carries a phone. The sync reads `phone`, `phone_number`, `mobile`, or `custom_fields.phone`. If yours is different, edit `leadPhone` in `convex/outreach/zuops.ts`.
3. Set the env vars on production Convex (`pastel-corgi-340`), never in code:
   - `npx convex env set BLAND_API_KEY <key> --prod`
   - `npx convex env set BLAND_WEBHOOK_SECRET <long random string> --prod` (for example `openssl rand -hex 32`)
   - `CONVEX_SITE_URL` is provided by Convex itself.
4. Bland needs no dashboard webhook setting: each call carries its own webhook, `https://pastel-corgi-340.convex.site/bland/events?secret=<BLAND_WEBHOOK_SECRET>`. You can test the endpoint by hand: no secret returns 401, a wrong one 401, and it returns 503 while `BLAND_WEBHOOK_SECRET` is unset.
5. In Settings turn Confirmation calls on. It is in dry run. Only bookings made after this moment are ever called.
6. Watch Agency > Outreach > Meetings > Confirmation calls for a few days. Each `dry run` row shows the exact body and the checks it passed. Nothing is dialed.
7. Go live: Settings > "Type CALL" > Go live. Dry run rows for demos still ahead become real calls on the next minute.

## Go-live checklist

- Script reviewed and `CALL_SCRIPT_APPROVED` set.
- The Zuops form's call consent wording is clear that an automated AI call will be placed at the number given.
- The old Zuops webhook is retired (next section) and the GHL Pulse Walkthrough path is not calling the same people (see below).
- One test: book yourself with consent, with `allowTestBookings` on, in live mode. Confirm the call, the result row, and say "stop calling me" on a second test to see the do-not-call row appear.

## Retire the old Zuops webhook

The old receiver is the Zuops webhook "Pulse OS native booking confirmation" (id `5412aeef-2f3c-49aa-98c2-226eef800cfd`). If it stays on while Pulse calls live, people get two calls.

1. Turn Pulse live (above) and confirm one real call worked.
2. In Zuops, open Webhooks, find that webhook, and disable it (do not delete yet).
3. Keep the other webhook that posts to `/zuops/events` (the signed booking sync): that one feeds Pulse and must stay.
4. After a week with no duplicate calls, delete the old webhook and the `pulse-zuops-bland-receiver` Netlify site.

Also: `convex/pulseWalkthrough` is a separate, older GHL-driven path that also calls Bland (`/pulse-walkthrough/bland`, `/pulse-walkthrough/booking`). It is off unless its own env vars are set. Do not enable it for the same audience.

## Do not call

When Bland reports `DO_NOT_CONTACT`, or the callee's own words match a stop phrase ("stop calling", "do not call", "take me off", ...), the phone and email go on the do-not-call list (`outreachCallOptOuts`) and no further call is placed to them. Matching errs toward opting out.

## Data

The phone is stored only on `outreachBookings.phone` and `outreachCalls.phone`, returned to the browser masked, and never written to the event log. Recordings are off. Transcripts are not stored: only a 600 character summary, the disposition, answered-by and call length.

## Known limits

- A dial that errors is not retried. A missed confirmation is better than a double call.
- Phones outside +1 North America are skipped.
- The booking's timezone is the booker's browser zone, a proxy for where they are.
- A booking that is rescheduled keeps its one call row.
