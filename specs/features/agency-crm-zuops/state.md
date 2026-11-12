# State: Agency CRM on Zuops

Branch `feat/agency-crm-zu` · worktree `~/Dev/pulse-wt-zucrm` · eval approved 2026-11-11 ("ok build it", scope widened to every Zuops function incl. social)

## Round 1: built, verified, reviewed
- Built: backend (`a892d96`, `ebd7335`, `9c1d599`), UI foundation + Leads + Pipeline (`84e1e51`), resources + Functions (`4915660`), Inbox + Calendar + Social (`93339f2`). Gates: 293 tests, tsc 0, eslint 0, registry matches the live spec (352).
- Verifier (local anonymous Convex, real key, writes off, Chromium): 38 PASS, 5 FAIL, 13 NOT RUN, 1 PENDING (`3ce4fac`).
- Reviewers: backend security (0 critical, 2 important, 9 minor), UI safety (0 critical, 11 important, 9 minor).

## Round 2: fix list (stable ids)
Backend
- F-B1 (class: allow-by-default confirm list) classify every non-GET op; completeness test; body rules for gbp post approve, scheduled message edits, optimizer apply, move DM leads, AI resume, booking reminders.
- F-B2 (class: unsigned header trusted) webhook de-dupe on body hash; event from signed body.
- F-B3 (class: guessed tenant) CRM requires pinned `PULSE_AGENCY_ID`.
- F-B4 tests for allowlist elevation, inactive member, demo mode with Clerk configured.
- F-B5 malformed `idem` refused, not replaced.
- F-B6 oversized answer on a write reported as success.
- F-B7 audit before the request and audit refusals.
- F-B8 (class: personal data in audit) mask path values in `resource`.
- F-B9 `workspace_id` server controlled; nested strip on strict bodies.
- F-B10 `signal` per kind via index.
- F-B11 body size precheck.
- F-B12 (class: secret in answer) server redaction of key prefix, secrets and tokens, except the one-time webhook secret.
- F-B13 mock mode for write-flow verification (`ZUOPS_CRM_MOCK_URL`, loopback only, never carries the real key).
UI
- F-U1 schedule falls through to immediate send. F-U2 text opt-out is not visible on a Zuops lead: say so, block on the fields that exist. F-U3 request budget per screen, global Retry-After. F-U4 hidden tab keeps refetching. F-U5 campaign confirm count not truthful. F-U6 actions that restart automatic sending without confirm. F-U7 Functions shows unredacted answers. F-U8 cache not cleared on sign-out, user change, forbidden. F-U9/F-U11 idempotency key rotation and reuse. F-U10 slot picker keeps the previous calendar's times. F-U12 to F-U20 minor (pipeline flicker, select writes on change, frozen now, same-lead jump, datetime field, held rows label, focus return, forbidden detection, long location).
- F-V1 (U-14) first column ignores its format. F-V2 (U-06) API key screen empty, AI calling campaigns and iMessage lines columns. F-V3 (U-10) focus not returned from the lead sheet. F-V4 (R-02) CRM link hidden in the nav at 834 px. F-V5 (U-09) inbox thread 6 px overflow, lead sheet targets under 44 px. F-V6 pipeline: partial leads have no column and no note. F-V7 composer header overlap and "a Instagram".
- Disputed PASS marks to re-run in round 2: X-05 (F-U2), P-02 and P-03 (F-U3, F-U4).

## Known facts that shape the build
- Key in 1Password is access level `write`: no `:admin` operations until a Full access key exists.
- `GET /v1/deals` and `/v1/pipelines` answer 403 and `/v1/activity` answered 500 on this account (2026-11-11). Screens must show the reason, not break.
- Staging and production share one Zuops sub-account: `ZUOPS_CRM_WRITES` stays unset on staging.
- `node_modules` in this worktree is a symlink to `~/Dev/pulse-wt-outreach/node_modules` (same dependency set).
- `convex/_generated/api.d.ts` is hand-edited for the new modules; codegen needs a deployment and is not run here.

## Not verifiable in this session
- X-10 live write round trip (needs the owner and production).
- R-05 pentest and U-12 cross-browser run against staging (need a deployed staging build).
