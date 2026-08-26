# Task 2 report: Per-org GHL client

Branch: `feat/studio-marketing`. Commit: `35df8c0` "Per-org GHL Social Planner client with simulated mode". Pushed to `origin/feat/studio-marketing` (`40fb695..35df8c0`).

## What was implemented

Exactly the brief's Task 2 scope (`docs/superpowers/plans/2026-08-26-studio-marketing.md`, `### Task 2` section), verbatim, with zero deviations. Global Constraints applied: `Version` + `User-Agent: Pulse/1.0 (+https://pulse.myindsound.com)` headers on every GHL call, missing env resolves to simulated mode (`ghlFromEnv` returns `null`, never throws), the token is only ever read by env var name (`tokenRef`) and never stored or logged, no em dashes in code/comments/test strings, `npm test` and `npm run typecheck` both run and green before commit.

Created two new files, no existing files touched:

1. **`convex/lib/ghl.ts`** - pure fetch client, no Convex `ctx` import (confirmed by grep: zero occurrences of `convex` in the file). Exports:
   - `GhlCtx`, `Platform`, `PLATFORMS` - the resolved-context type and the 10-platform union (`google, facebook, instagram, linkedin, tiktok, tiktok-business, youtube, pinterest, threads, bluesky`).
   - `ghlFromEnv(org)` - resolves per-org (`org.ghl.locationId` + `process.env[org.ghl.tokenRef]`) or platform-default (`GHL_API_KEY` + `GHL_LOCATION_ID`), both requiring `GHL_SOCIAL_USER_ID`; returns `null` (simulated mode) if any piece is missing.
   - `ghlFetch<T>(g, path, init)` - wraps `fetch` against `https://services.leadconnectorhq.com`, sets `Authorization: Bearer <token>`, `Content-Type`, `Accept`, `Version` (default `2021-07-28`), `User-Agent`; returns a discriminated `{ ok: true; data } | { ok: false; status; message }`, catching both non-2xx responses and thrown network errors so it never throws.
   - `startOAuth`, `listOAuthAccounts`, `attachOAuthAccount`, `createScheduledPost`, `deletePost`, `listPosts`, `accountStats` - typed wrappers over the Social Planner endpoints, each degrading to an empty/null/error result on failure rather than throwing.

2. **`convex/lib/ghl.test.ts`** - the 7 tests from the brief, transcribed verbatim: default-env resolution, per-org resolution by env-var name, null on missing token, header correctness, OAuth-start query params, scheduled-post success shape, and error-message passthrough on a 401.

## Tests and results

- `npx vitest run convex/lib/ghl.test.ts`: **7 passed / 7**.
- `npm test` (whole repo): **148 test files passed, 1273 tests passed** (up from Task 1's 147 files / 1266 tests - this file added 1 file / 7 tests, nothing else moved).
- `npm run typecheck` (`tsc --noEmit`): **exit 0, no output**.

## TDD evidence

**RED** - command: `npx vitest run convex/lib/ghl.test.ts` (run immediately after writing `convex/lib/ghl.test.ts`, before creating `ghl.ts`):

```
 RUN  v4.1.6 ...

 ❯ convex/lib/ghl.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  convex/lib/ghl.test.ts [ convex/lib/ghl.test.ts ]
Error: Cannot find module './ghl' imported from .../convex/lib/ghl.test.ts
 ❯ convex/lib/ghl.test.ts:2:1
      1| import { describe, it, expect, vi, beforeEach, afterEach } from "vites...
      2| import { ghlFromEnv, ghlFetch, startOAuth, createScheduledPost } from ...
       | ^

 Test Files  1 failed (1)
      Tests  no tests
```

Matches the brief's expected Step 2 outcome exactly ("FAIL, module `./ghl` not found").

**GREEN** - command: `npx vitest run convex/lib/ghl.test.ts` (after writing `convex/lib/ghl.ts` verbatim from the brief's Step 3 code block):

```
 RUN  v4.1.6 ...

 Test Files  1 passed (1)
      Tests  7 passed (7)
```

Matches the brief's expected Step 4 outcome exactly ("PASS (7 tests)").

**Full suite** - command: `npm test`:

```
 Test Files  148 passed (148)
      Tests  1273 passed (1273)
```

**Typecheck** - command: `npm run typecheck`: exit code 0, no output (clean).

## Files changed

- `convex/lib/ghl.ts` (new, 152 lines)
- `convex/lib/ghl.test.ts` (new, 66 lines)

2 files changed, 218 insertions(+). Matches the brief's Step 5 commit file list exactly (`git add convex/lib/ghl.ts convex/lib/ghl.test.ts`).

## Self-review findings

- Diffed the committed files against the brief's code blocks character-for-character (both the test file and the implementation) - no drift, no repo-forced edits were needed anywhere in this task, unlike Task 1 which had two file-location deviations.
- Confirmed `convex/lib/ghl.ts` has zero references to `convex`, `ctx`, `query`, `mutation`, or `action` - it is genuinely a plain TypeScript module with only `fetch`/`URLSearchParams`/env access, as the brief's "pure fetch code, no Convex ctx" instruction requires.
- Grepped both new files for the em-dash character (`—`) - none found, satisfying the Global Constraints no-em-dash rule.
- Verified the house style match against `convex/lib/sms.ts`'s existing `sendGhl`: same base host (`https://services.leadconnectorhq.com`), same `Authorization: Bearer`, same `Version` header pattern, same `User-Agent: Pulse/1.0 (+https://pulse.myindsound.com)` string, same "return a status/never throw" philosophy (there it's a `SmsStatus` string, here it's the `Ok<T> | Err` result type) - `ghl.ts` is a natural sibling to `sms.ts`'s GHL branch, not a competing convention.
- Ran `npx eslint convex/lib/ghl.ts convex/lib/ghl.test.ts` - clean, no warnings or errors.
- Confirmed the env var names used (`GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_SOCIAL_USER_ID`) match the Global Constraints block verbatim, and that `tokenRef` is only ever used as a *key* into `process.env` (`process.env[org.ghl.tokenRef]`), never interpolated into a URL, log, or error message - so a per-org token can never leak the wrong org's secret name even if `tokenRef` itself were attacker-controlled.
- Confirmed `ghlFetch` never throws: both the `fetch` call and the JSON parse are wrapped in `try/catch`, and a non-JSON or empty response body degrades to `json = null` rather than crashing.

## Vitest / edge-runtime note (as requested, even though nothing broke)

`vi.stubEnv` and `vi.stubGlobal("fetch", ...)` both worked exactly as expected under the `edge-runtime` environment (`vitest.config.ts`: `test.environment: "edge-runtime"`) - no workaround was needed. Specifically: `process.env.GHL_API_KEY` set via `vi.stubEnv` was visible to `ghlFromEnv`'s plain `process.env.GHL_API_KEY ?? ""` read in every test, including the "missing token" test where re-stubbing `GHL_API_KEY` to `""` correctly flipped `ghlFromEnv(null)` to `null`. `vi.stubGlobal("fetch", fetchMock)` correctly replaced the global `fetch` that `ghlFetch` calls unqualified (`await fetch(...)`, not `globalThis.fetch` or an import), and `vi.unstubAllEnvs()` / `vi.unstubAllGlobals()` in `afterEach` cleanly reset state between tests (no leakage observed across the 7 tests or across the full 1273-test suite run in the same process).

## Concerns

None. This task had a fully specified brief with an exact implementation given verbatim, matched the existing `sms.ts` house style with no adaptation needed, and the full test suite plus typecheck are green with nothing else in the repo touched or broken.

## Worktree note (not a code concern, flagging for the record)

This agent's assigned worktree (`.claude/worktrees/agent-a34d3efdbec055476`) was on an unrelated local scratch branch (`worktree-agent-a34d3efdbec055476`, based on old `feat/patch-zones-tie-lines`-era history), while the primary worktree at the repo root was already checked out on `feat/studio-marketing` at `40fb695`. Git refuses to check out a branch that is already checked out in another worktree of the same repository, so `git checkout feat/studio-marketing` here failed with "already used by worktree at .../pulse". Resolved by fetching `origin`, confirming `origin/feat/studio-marketing` matched the root worktree's `40fb695` exactly, then `git reset --hard origin/feat/studio-marketing` on this worktree's local scratch branch (its tree was already clean, so nothing was lost) and pushing with an explicit refspec (`git push origin HEAD:feat/studio-marketing`) rather than a bare `git push`, since the local branch name here is not literally `feat/studio-marketing`. This only updates this repo's `refs/remotes/origin/feat/studio-marketing`, not the root worktree's local `refs/heads/feat/studio-marketing`, so the other worktree's checkout was not disturbed. Confirmed after push: `origin/feat/studio-marketing` is at `35df8c0` (this task's commit) with `40fb695` as its parent, i.e. a clean fast-forward on top of Task 1.
