Secure setup and remaining tests — not executed

Dashboard check: https://dashboard.convex.dev redirected to the official Convex sign-in page. No signed-in project inventory was available. Therefore pastel-corgi-340 is still an unverified source-code candidate; neither Pulse production ownership nor deployed backend version is confirmed. Smallest step: user signs into the existing Convex account in the kept-open official tab, then read-only project/deployment verification can resume. No account creation, OAuth grant, environment reveal, credential operation or function run was attempted.

After project identity is verified, enter configuration privately in that project's selected deployment: Settings → Environment Variables. Never send values in chat, commit .env files, paste them into logs, or use query-string secrets. Do not copy unrelated studio/global GHL credentials into this integration.

| Exact variable name | Purpose and narrow scope | Where entered |
|---|---|---|
| PULSE_WALKTHROUGH_GHL_KEY | Dedicated GHL location credential: only F0yle6iHmWc14SpOyijl; read appointment/calendar/contact/notes, create contact notes, send conversation SMS as supported. No contact create/upsert or unrelated studio scope. Audit exact supported permissions before provisioning. | Verified Convex deployment Environment Variables, user privately enters after approval. |
| PULSE_WALKTHROUGH_BLAND_KEY | Dedicated authorized Bland account API access for calls and call-detail GET. Existing opaque GHL Bland API cannot be exported by this package. | Same private Convex UI; new access requires approval/user handoff. |
| PULSE_WALKTHROUGH_BOOKING_SECRET | Private bearer shared secret authenticates GHL booking receiver. | Convex env plus private GHL stored credential/header in original booking workflow. User privately enters; workflow remains OFF. |
| PULSE_WALKTHROUGH_BLAND_SIGNING_SECRET | Verifies completed-call HMAC; obtain existing authorized secret or approve private creation separately. Replacing an account-level signing secret can affect other callbacks; never replace blindly. | Bland Account Settings → Keys by user if needed, then private Convex env. No secret revealed to agent/chat. |
| PULSE_WALKTHROUGH_CALLBACK_URL | Verified deployment's HTTPS .convex.site endpoint /pulse-walkthrough/bland. It must belong to the verified Pulse deployment. | Convex env; URL has no credential/token. |
| PULSE_WALKTHROUGH_BLAND_SIGNING_MODE | Audited serialization, raw or json, matching real signed fixture. | Convex env after fixture verification. |
| PULSE_WALKTHROUGH_CALL_MAX_CENTS | Approved conservative maximum cost of one5-minute-max direct task call, inclusive of relevant provider fees. No inferred value from balance or prior short-call cost. | Convex env after fee audit and explicit limit approval. |
| PULSE_WALKTHROUGH_NOTE_MAX_CENTS | Approved maximum per completed-call processing/note operation, including attributable provider reads where bounded. | Same. |
| PULSE_WALKTHROUGH_SMS_MAX_CENTS | Approved maximum of one OWNER SMS including segment/carrier fees. | Same. |
| PULSE_WALKTHROUGH_SCHEMA_AUDITED | Keep false/unset until exact GHL event/contact schemas, consent semantics, timezone and owner identity are verified. | Convex env; set true only after audit. |
| PULSE_WALKTHROUGH_ENABLED | Keep false/unset through deployment/private setup. Set true only after final bounded-test readiness approval. | Convex env last. This alone does not publish GHL workflow. |

Database budget is separate: internal pulseWalkthrough/state:budget accepts approved limitCents. No budget row means writes cannot claim. No function may be run until separately authorized. Claims reserve conservatively; ambiguous attempts retain reservations. Convex/platform consumption and provider read costs are not automatically capped by this row; audit them and include them in the overall test limit.

Fixed recipients: client-call live tests only existing consenting OWNER contact SlPAwHvJe4PRckad3NtK / +14084100931 if a NEW call authorization is granted. The original one-call authorization is consumed. Owner SMS fixed +14084100931, sender +12134445199, existing OWNER contact reused. No prospect/client enrollment or publication in the test phase.

Current spend authorization: parent relayed one synthetic callback sample and one read-only GET of existing call, within TOTAL $1 including prior spend. Known prior Bland call cost $0.143 leaves at most $0.857 before any other incurred costs; actual remaining amount must be reconciled. This does not authorize a new call or SMS. No paid operation is permitted unless actual maximum fees fit the remaining cap. Billing unknown means stop, not assume free.

Remaining actions, in order:
1. Read-only dashboard verification: existing Pulse project/deployment identity, production label, dashboard URL and deployed backend version. No secrets/data/function calls.
2. After private credential/access approval and price audit, authorized read-only existing call GET plus minimum owner appointment/contact reads to audit shape and IDs. No reads of unrelated contacts. These additional schema reads require explicit inclusion in test authorization if chargeable or beyond prior scope.
3. Local signed-fixture check against approved Bland secret handled privately; record authenticity result and serialization mode only. Never persist a real secret or sensitive payload in this repository. A synthetic callback cannot prove actual Bland signing behavior.
4. Review/approve backend-only deployment while ENABLED/SCHEMA_AUDITED remain false; no Netlify frontend redeploy. Verify disabled endpoints503. No production calling workflow publication.
5. Authorize one owner-only isolated test appointment for Pulse calendar; replay the authenticated booking once and completed callback twice. Verify exactly one registered call/one matching note and no duplicate contact. A new call requires fresh explicit authorization; max one, max_duration5, recording off, voicemail hangup. No arbitrary customer calls.
6. Authorize at most one OWNER SMS at15minutes before that active test demo. Verify exact destination/sender, brief appointment identity and one send. Validate cancel/reschedule/late/unknown cases using mocks; additional live SMS requires separate cap/authorization.
7. Read-only reconciliation verifies provider IDs/charges and checks ambiguous outbox states. No automatic retry. Any recovery write or new call/SMS must be specifically authorized.
8. Only after evidence passes and an ongoing spending policy is approved, review activation of the original booking workflow pointing to the dedicated bearer receiver. Remove its direct Bland POST before activation to avoid duplicate calls. Native notes/SMS alternatives remain OFF if Convex owns these writes.

Proposed final-test scope for parent's bundled approval: no more than one new OWNER call and one OWNER SMS, no prospect contact; an explicit total dollar ceiling must include prior0.143, read/note/webhook/SMS and platform charges. Preserve current cumulative$1 ceiling only if all audited maxima fit; otherwise request a concrete replacement limit before any paid action. No ceiling is currently approved for ongoing bookings.

Evidence: local commit bb8950b;20 mocked tests and focused strict tsc pass. Independent reviewer reran18tests+tsc, found no further concrete implementation defects after fixes; subsequent two enabled callback tests also passed. Full app build remains unverified because unrelated dependencies were unavailable. No push/deploy/config writes occurred.
