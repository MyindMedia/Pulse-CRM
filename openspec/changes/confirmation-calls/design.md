## Context

`outreachBookings` mirrors Zuops bookings (sync every minute plus signed webhook). It holds name, email, three consent answers, timezone, status. It did not hold a phone. Bland is called today by `convex/pulseWalkthrough` for the GHL path, with the key in a Convex env var.

## Decisions

1. **One row per booking, ever.** `outreachCalls` is unique on `(agencyId, bookingId)` by construction: the only inserter is the single `planDue` mutation, which checks the index first, and Convex mutations serialize. A real dial is claimed (`status: dialing`, `attempts: 1`, `dialedAt`) in that same mutation BEFORE any network call. A crash after the claim leaves `dialing`, which is never re-picked. There is no automatic retry of a dial: a double call to a person is worse than a missed confirmation. A dial that fails is `failed` and visible.

2. **Pure policy, thin I/O.** `callPolicy.evaluate()` takes plain values and returns `ok | wait | skip | cancel` plus a reason trail. No db, no clock, no fetch. `planDue` does the reads and writes, the action does the one fetch. Tests hit the policy as a matrix.

3. **Fail closed, in this order.** Terminal skips first (consent not native `true`, status not confirmed, booked before the feature was enabled, opted out or suppressed, test-looking name, too close to the start), then waits (no phone yet, not due, outside window, daily cap). Waits keep the row `queued` with the reason, and re-run each minute until the booking is too close, at which point it becomes a terminal `too_close` skip.
   - `consent.call` must be the boolean `true`. The string "true", 1, or missing is a skip.
   - Phone: normalized, then must match a North American number (`+1` NXX NXX XXXX). Anything else is `invalid_phone`. TCPA window logic below is US based.
   - Start must be at least `delayMinutes + 5` minutes away.
   - `predates_enable`: a booking row created (Convex `_creationTime`) before `enabledAt` is never called, so turning the feature on does not phone people booked days ago.

4. **Calling window** is evaluated in the callee's zone: the booking's `timezone` if it is a valid IANA zone, else the agency default (America/Los_Angeles). Default 09:00 to 20:00, all days, owner adjustable. This sits inside the federal 8am to 9pm local limit with margin. The booking timezone is the booker's browser zone, a proxy for where they are.

5. **Daily cap** counts every dialed call (status dialing, completed, failed with `dialedAt`) per calendar day in the agency default zone. In dry run the cap also counts that day's dry runs so a dry run shows what live would do.

6. **Dry run** records status `dry_run`, the exact Bland request body, and the reason trail, and never calls fetch. In live mode a `dry_run` row whose booking is still eligible is promoted and dialed, so flipping to live does not strand bookings made while testing. Real dials are still one per booking.

7. **Script approval gate.** The call script is `convex/outreach/callScript.ts`. Its persona, guardrails and voice sections are copied verbatim from the owner's prompt file. The confirmation objective and first sentence are new text. `CALL_SCRIPT_APPROVED` is `false` until the owner reviews it and flips it in a commit. Live mode with the flag false waits with reason `script_unapproved`.

8. **Consent re-check right before dialing (live only).** The action re-reads the Zuops lead and requires `pulse_automated_call_consent === true` still. If Zuops cannot be reached the call is released back to `queued` (not dialed). If consent is gone it is `skipped: consent_revoked`.

9. **Opt-out.** `outreachCallOptOuts` keyed by phone and by email. Checked with `outreachSuppressions` (the email suppression list) before every call. The result webhook marks the contact opted out when Bland's disposition is `DO_NOT_CONTACT` or the caller's lines in the transcript contain a stop phrase. Over-matching is accepted: a wrongly listed person loses a confirmation call, a missed opt-out is a violation.

10. **Webhook auth.** `POST /bland/events?secret=...` (or `x-pulse-secret` / `Authorization: Bearer`). Compared as SHA-256 digests in constant time. 503 when `BLAND_WEBHOOK_SECRET` is unset, 401 when wrong. Unknown `call_id` returns 200 so Bland does not retry forever and nothing leaks. Transcripts are never stored; only a 600 char summary, disposition, answered_by and length.

11. **Bland request** (per docs.bland.ai POST /v1/calls, read 2026-10-07): `authorization: <key>` bare header, `phone_number`, `task`, `first_sentence`, `from` (config), `voice` (config, optional), `max_duration` (minutes), `record: false`, `wait_for_greeting: true`, `voicemail: { action: "hangup" }`, `webhook` (our URL with secret), `webhook_events: []`, `dispositions`, `summary_prompt`, `external_id` (our call row id), `metadata` (agencyId, bookingId, callId). `answered_by` arrives on the post-call webhook.

12. **PII.** Phone lives only on `outreachBookings.phone` and `outreachCalls.phone`. Queries return it masked. It is never written to `outreachEvents` or logs. The dry run body holds the real number (it is the exact body); queries mask it before returning.

## Risks / Trade-offs

- A dial that errors after the claim is not retried. Chosen over double calling.
- Zuops lead field names for phone are assumed (`phone`, `phone_number`, `custom_fields.phone`). Verify against a real lead before enabling.
- Two Bland call paths exist (this one and the GHL Pulse Walkthrough). Retire one trigger or they can double call.
