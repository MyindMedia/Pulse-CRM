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

## Round 2 and 3: fixed, re-verified
- Fix round 2: backend `8371696`, `abbd006`; UI `89c4436`. Verifier round 2 (mock Zuops with writes on, then real key read only): 43 PASS, 6 FAIL (`23fd77c`). Re-review of the fix diff: fix list held; 3 new important items.
- Fix round 3: backend `72c8b10`; UI `13c937a`. Verifier round 3: all ten re-run checks PASS, including U-10 (focus) and P-02 (first-open requests), which had failed twice (`3585ac6`).
- Small follow-ups `5a05ce4` (timeline order, focus back to the row, plural counts, aria on blocked fields): unit tested, NOT browser verified.
- Rounds used: 3 of 5. Final gates: 437 tests in the CRM and agency folders, tsc 0, eslint 0, registry matches the live spec (352), Outreach suite 293 and Zuops booking-sync 15 still pass.

## Round 4: Outreach prospects into Zuops (U-17, cloud run 2026-11-12)
- Built from `handoff-prospects-to-zuops.md`: backend `286fc9b` (shared `zuTarget`/`zuWritesOn` in `crm/zu.ts`, `crmProspectLinks`, `crmProspects.plan`, `push`, `syncStatuses` and its 15 minute cron), tests `492d8a0`, Prospects card `dd2ec6b`.
- Gates: vitest 480 (CRM, crmProspects, agency), 303 (outreach config), tsc 0 (root and `tsconfig.outreach.json`), eslint 0 on touched files, registry matches the live spec (352).
- Status tags: `bookedAt` set is booked; status `replied` or `repliedAt` set is replied; a follow-up sequence exists (Lawrence's first email was accepted) is email sent; anything else is not emailed. Opted out = status `suppressed`, `replyIntent.optedOut`, or any published address on the opt-out list. There is no "removed" status: a removed prospect is deleted, so it is never pushed and its link is left alone.
- NOT verified: no browser run; no real Zuops write (no key in the cloud; every request in tests is a mocked fetch).

## Eval status: 50 PASS (U-17 unit only), 8 NOT RUN, 0 FAIL
NOT RUN, with the reason:
- A-07, P-01, P-04: need a production build. Not run locally (the laptop was under heavy load); the staging build covers them. P-04 has static evidence only: the registry is reached solely through `import()` from `crm-functions.tsx`, enforced by `crm-guard.test.ts`.
- U-12: cross-browser run needs a deployed URL.
- R-03: full `npm run check`. The CRM, agency, Outreach and Zuops suites, tsc and eslint were run; the whole-repo vitest run was not repeated after round 1 (it had 3 failures on untouched develop: the two known ones in `docs/ENVIRONMENTS.md` plus a time-of-day assertion in `outreachCalls.test.ts`).
- R-04: `/security-review` skill not run. Two fresh-context security reviews of the backend were done (round 1 full, round 2 on the fix diff) and their findings fixed.
- R-05: pentest needs staging.
- X-10: live write round trip needs the owner and production.

## Accepted, on purpose
- Stage, tag and deal moves need no confirm even though a stage automation may text the lead: moving a lead is the core action and the automation is one the owner built. The Pipeline says so in one line.
- A webhook body with no event name falls back to the (unsigned) event header. Worst case is one pulse row of ids after the 7 day prune.
- When `ZUOPS_CRM_WORKSPACE_ID` is unset, a client-supplied workspace id in the two path-based operations is passed through. The key is locked to one sub-account, so Zuops ignores or 404s another.
- Zuops exposes no text opt-out or do-not-contact field on a lead. The composer says so and relies on Zuops refusing the send.

## Open, outside this feature
- `convex/lib/access.ts` legacy agency fast path (`orgType === "agency"`, about line 224) reads the member row without checking `status`. A suspended or invited agency member with that token claim is treated as a member by every agency feature that uses `resolveViewer`. The CRM re-checks on its own. Needs its own fix and review.
- `src/components/ui/dialog.tsx` and `sheet.tsx` close buttons are 24 px on phones (shared components, not changed here; the CRM enlarges its own).

## Before production (owner)
1. `PULSE_AGENCY_ID` must be set on the production Convex deployment (the CRM refuses without it).
2. `ZUOPS_CRM_API_KEY` on staging (reads only) and production; `ZUOPS_CRM_WRITES=on` on production only. The prospects push and its sync do nothing without it.
3. Full access key -> `ZUOPS_CRM_ADMIN_KEY`, then register the outbound webhook to `https://<convex site>/zu/events` and set `ZUOPS_CRM_WEBHOOK_SECRET` (the Webhooks screen shows the secret once).
4. Legal review flag stays on: High tier, adds a way to text and email leads.

## Known facts that shape the build
- Key in 1Password is access level `write`: no `:admin` operations until a Full access key exists.
- `GET /v1/deals` and `/v1/pipelines` answer 403 and `/v1/activity` answered 500 on this account (2026-11-11). Screens must show the reason, not break.
- Staging and production share one Zuops sub-account: `ZUOPS_CRM_WRITES` stays unset on staging.
- `node_modules` in this worktree is a symlink to `~/Dev/pulse-wt-outreach/node_modules` (same dependency set).
- `convex/_generated/api.d.ts` is hand-edited for the new modules; codegen needs a deployment and is not run here.

## Not verifiable in this session
- X-10 live write round trip (needs the owner and production).
- R-05 pentest and U-12 cross-browser run against staging (need a deployed staging build).
