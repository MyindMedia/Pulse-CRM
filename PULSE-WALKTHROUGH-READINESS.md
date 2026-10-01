Pulse Walkthrough integration — local review package

Branch: pulse-walkthrough-integration
Base: 9dbf189a20544cecf10855babf9a1bee06c4d577 (verified origin/main at clone)
Status: disabled, unpushed, undeployed. Existing native GHL drafts remain OFF.

Dedicated Convex tables, internal functions and HTTP routes reuse the existing backend. No new hosting subscription is needed by design. The actual active Convex deployment/version is still unverified. Netlify frontend is unaffected; backend deployment is separate.

Fixed boundaries are in convex/pulseWalkthrough/policy.ts: Myind Sound location, Pulse Walkthrough calendar, existing OWNER contact and +14084100931 destination, +12134445199 sender. No contact upsert, no studio SMS driver, no studio cron modifications.

Flow:
1. /pulse-walkthrough/booking accepts a dedicated bearer credential in Authorization. Request body contains only appointment_id; every relevant fact is fetched through dedicated GHL credentials and validated. Unauthenticated requests cannot register appointments.
2. Transactional appointment/version state schedules one call and the owner SMS at appointment start minus15minutes. Identical booking notifications do not reschedule; changed versions invalidate older jobs. Late booking does not send an immediate SMS.
3. Atomic indexed outbox claims and conservative maximum-cent reservations precede external writes. Call key is appointment-specific. SMS key includes appointment/start/owner. Ambiguous writes become reconcile and are never automatically resent. Reservations are not automatically released on ambiguity.
4. Bland callback verifies HMAC-SHA256 in X-Webhook-Signature, with an explicitly audited raw/json serialization mode. Unknown registered call IDs return503 without provider requests. Only a locally registered call and immutable dispatch snapshot can correlate trusted authenticated Bland GET results. Call, location, calendar, contact, appointment and destination must match. Body-supplied summary/contact fields are ignored.
5. Matching contact notes are deduplicated by exact Call ID line before writes. Notes stay factual and disclose original booking time; no fabricated extraction fields. Late/cancelled/opt-out calls may still save notes. Appointment-specific summaries never use contact-latest storage.
6. Owner SMS re-fetches current appointment, rejects cancel/reschedule/timezone changes, and rechecks local version before sending. It verifies the fixed existing OWNER contact's phone and DND. Prospect call refusal/DND suppresses client contact independently of owner internal meeting notification. Missing brief is explicitly labeled.

Verification:
node node_modules/typescript/bin/tsc -p tsconfig.pulse-walkthrough.json --pretty false
node node_modules/vitest/vitest.mjs run --config vitest.pulse-walkthrough.config.ts
Focused strict typecheck PASS.20 mocked tests PASS: eligibility boundaries; duplicate/version scheduling; atomic budget/claims; cancellation; ambiguity/replay; disabled zero requests; fixed owner SMS; existing-note reconciliation; HMAC authenticity; missing brief; concurrent duplicate claims; cross-appointment briefs; client refusal vs owner; late notes; immutable dispatch snapshot; unknown callback; changed prospect phone; callback budget refusal; successful trusted GET-to-note callback/replay; mismatched trusted metadata rejection.
Existing local dependencies were symlinked for offline tests (Convex1.42.3, Vitest1.6.1); repository dependency manifest/lockfile unchanged. Full repository tsc was attempted and blocked by missing unrelated frontend/test dependencies in this isolated clone. Focused check is not a claim that the whole application build passes. No remote codegen or schema push occurred.

Launch blockers and exact private configuration seams:
- Verify the active Convex deployment belongs to this repository and confirm deployed version. Public fallback URL is only a candidate.
- Audited live GHL appointment/contact response required: exact event.id/contactId/locationId/calendarId/startTime/timezone/appointmentStatus and contact.customFields[].id/value, boolean dnd. Unknown schema fails closed. No inference of consent from missing/unknown values. Required Yes field remains McAqWQdi1d78BzlzfIp5. An explicit SCHEMA_AUDITED flag cannot substitute for the actual audit.
- Privately provision PULSE_WALKTHROUGH_GHL_KEY, BLAND_KEY, BOOKING_SECRET, BLAND_SIGNING_SECRET, CALLBACK_URL. Existing GHL opaque Bland API credential was not exported and does not automatically become a Convex credential. No values were read or created. New secret/access provisioning requires action-time approval or user handoff as applicable.
- PULSE_WALKTHROUGH_BLAND_SIGNING_MODE must be raw or json after a real signed fixture audit. Official Bland tutorial uses JSON.stringify(req.body) and X-Webhook-Signature: https://docs.bland.ai/tutorials/webhook-signing . No signing-secret replacement occurred.
- Set explicit approved CALL_MAX_CENTS, NOTE_MAX_CENTS, SMS_MAX_CENTS and initialize internal state:budget. These conservative write reservations are NOT a proven total dollar cap: provider reads, Convex usage and any account-specific fees/headroom must be audited. Duplicate authenticated booking webhooks still perform reads. Never enable based solely on an existing balance.
- PULSE_WALKTHROUGH_ENABLED and PULSE_WALKTHROUGH_SCHEMA_AUDITED both must equal true; absent/false blocks HTTP/actions. Keep both unset until final readiness.
- Configure original GHL booking workflow to this dedicated authenticated booking receiver only after verified backend deployment and safeguards. Do not run it alongside its current direct Bland POST; that would create duplicate calls. Original native notes/SMS drafts must stay off if Convex owns those writes.
- Review suppression outcome remains internal/evidenced because standard Bland callback has no reliable opt-out extraction. This does not block owner notification. No automatic client retries exist.

Practical limits:
External provider writes are not exactly-once. Claim-before-write plus no retry prevents intentional repeat attempts, but a crash after acceptance can leave reconcile/claimed. Provider and internal state need read-only reconciliation before a human-authorized recovery. There remains a small external cancellation/reschedule race between final GHL read and actual SMS acceptance. Convex scheduler execution is durable but not a promise of exact15-minute wall-clock delivery; this implementation exits beyond a60-second grace. Canceled appointments restored after cancellation remain conservatively client-suppressed until reviewed. Unknown callback registration must be retried by provider or recovered through approved reconciliation. No production delivery guarantee is claimed.

No push, deployment, credential change, paid webhook run, client enrollment, call or SMS test occurred. Prior local middleware and44offline tests are preserved separately; these20Convex tests add coverage, not production validation.

Independent reviewer verified18tests and focused typecheck, reviewed all fixes, and found no further concrete implementation bugs. Two additional enabled mocked callback tests subsequently passed (20 total). No live requests were used.
