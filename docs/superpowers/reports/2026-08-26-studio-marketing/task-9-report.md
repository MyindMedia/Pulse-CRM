# Task 9 report: AI drafts through the approval inbox

## What was implemented

1. **`convex/marketing/posts.ts`**: extracted `approve`'s body into a shared
   exported `approvePost(ctx, orgId, id, actor)` function (draft/failed guard,
   `client_win` OK-to-feature check, once-per-period metering from Task 7,
   patch, schedule kick). `approve` now just resolves `orgId`/`actor` and
   calls it. Added `approveInternal` (internal mutation, same signature the
   brief specified) for symmetry with the interfaces list; it is not called
   anywhere in this diff (see Concerns).

2. **`convex/opsActions.ts`**:
   - Added `OPEN_ACTION_STATUSES` (`proposed`, `approved`, `snoozed`,
     `executing`) and a shared `hasOpenDedupe(ctx, orgId, dedupeKey)` helper,
     per Ruling 3 (the repo's real open-set from `opsBrain.ts:503`, not the
     brief's narrower proposed/snoozed).
   - Added `openDedupeExists` (internal query) so an AI drafter can check for
     an open row *before* creating the promo/post side effects it would
     otherwise orphan on a skip.
   - Added `insertInternal` (internal mutation): inserts one rule-sourced
     `opsActions` row, itself also re-checking `hasOpenDedupe` as a backstop.
   - `approve`: before the action's own `ctx.db.patch`, added
     `if (action.payload.kind === "social_post") await approvePost(ctx, action.orgId, action.payload.postId, actor);`
     called directly (not via `ctx.runMutation`, since `opsActions.approve`
     is itself a mutation and `approvePost` is a plain function, not an
     internal-mutation reference).
   - `finalize`: added an `else if (p.kind === "social_post")` branch setting
     `result = "Post approved and scheduled"`, no `notifications` row.

3. **`convex/aiActions.ts`** (`writeRateCutPromos`): after the existing
   `ensureDiscountCode` call, added the marketing block. Per Ruling 3, it
   first checks `internal.opsActions.openDedupeExists` for
   `social_post_draft:<roomId>:<discountCode>`; only when that comes back
   false does it create the Promo (`promos.createInternal`, 28-day window),
   the Draft post (`marketing.posts.createInternal`, `accountIds: []`,
   `scheduledFor: now + 26h`), and the inbox card
   (`opsActions.insertInternal`). This is the actual fix for the duplicate-
   promo/duplicate-post defect Ruling 3 describes: the brief's literal
   ordering (create promo+post unconditionally, dedupe only inside
   `insertInternal`) would still have created a second promo+post even when
   the resulting `opsActions` row was skipped as a duplicate.

4. **`src/app/(app)/inbox/page.tsx`**: `AGENT_META.social_post_draft` (label
   "Social Post", group "Marketing", order 12) and a
   `p.kind === "social_post"` branch rendering "open in composer" linking to
   `/marketing/compose?post=<id>`. Added `onClick={(e) => e.stopPropagation()}`
   on that link (deviation, see below) because the card's whole body is
   inside a `<button onClick={() => onOpen(action)}>`; without stopping
   propagation, clicking the link would also open the detail modal in the
   same tick as navigating away.

5. **`convex/opsBrain.ts`**: no change, confirmed the `promote_underused_room`
   block stays note-only per the brief.

## Tests and results

New file `convex/marketing/drafts.test.ts`, 3 tests (the brief's 2 plus one
I added to lock in Ruling 3's behavior):

1. Approving a `social_post_draft` action approves and schedules the post
   (uses `vi.useFakeTimers()` / `vi.runAllTimers` per Ruling 1, not the
   brief's inert `() => {}` callback).
2. The rate-cut sweep creates a promo and a draft post per recommendation.
3. **Added**: a second sweep does not duplicate an approved-but-unexecuted
   draft (directly exercises Ruling 3's stated scenario: patch one action to
   `status: "approved"`, re-run the sweep, assert action/promo/post counts
   are unchanged).

All three pass. Full suite: 154 files / 1313 tests, all green. `npm run
typecheck` clean.

### TDD evidence

**RED** (`npx vitest run convex/marketing/drafts.test.ts`, tests written and
implementation already in place, first run):

```
FAIL ... approving a social_post_draft action approves and schedules the post
ConvexError: {"code":"UPGRADE_REQUIRED","capability":"agent","currentTier":"studio","requiredTier":"pro", ...}
FAIL ... the rate-cut sweep creates a promo and a draft post for each recommendation
Error: Test timed out in 5000ms.
FAIL ... a second sweep does not duplicate an approved-but-unexecuted draft
Error: Test timed out in 5000ms.
```

This failure was for real, discoverable reasons rather than "no
implementation yet": (a) `opsActions.approve` gates on the `"agent"`
capability which is Pro-tier-only, so Ruling 2's `tier: "studio"` seed
legitimately fails it (see Concerns); (b) the sweep tests were making live
network calls to OpenAI (a real `OPENAI_API_KEY` is set in this shell) and
timing out against the shell's exhausted quota. Both were test-fixture bugs,
fixed below, not implementation bugs.

There was also a third, more serious RED: after fixing (a) and (b), the
approve test still failed with `expected 'draft' to be 'scheduled'` and
`finalize` still returned `result: "noted"` instead of the `social_post`
branch, even though the code on disk clearly had the new branches. Root
cause: this worktree's `node_modules` was a single symlink to the main
checkout, and `convex-test`'s `convexTest(schema)` computes its module glob
as `import.meta.glob("../../../convex/**/*.*s")` relative to its own
`dist/index.js`. Since Node resolves a symlinked package to its realpath,
that glob was silently resolving to the **main checkout's** `convex/`
directory, not this worktree's, so every test ran against pre-task-9 code.
This is exactly the failure mode Task 8's report already diagnosed and
fixed (`docs/superpowers/reports/2026-08-26-studio-marketing/task-8-report.md`).
Fixed with the same remedy: rebuilt `node_modules` as a real local directory
with a symlink per top-level package, except a real recursive copy of
`convex-test` so its glob resolves inside this worktree. `node_modules/` is
gitignored; confirmed via `git status` that nothing about this reaches the
commit.

**GREEN** (`npx vitest run convex/marketing/drafts.test.ts`, after fixing the
`node_modules`/`convex-test` resolution, the test tier, and stubbing
`OPENAI_API_KEY`):

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

**Step 7 command** (`npx vitest run convex/marketing convex/opsBrain.test.ts convex/aiDeliverability.test.ts && npm run typecheck`):

```
 Test Files  7 passed (7)
      Tests  60 passed (60)
> pulse@0.1.0 typecheck
> tsc --noEmit
```

**Full suite** (`npx vitest run`):

```
 Test Files  154 passed (154)
      Tests  1313 passed (1313)
```

## Files changed

- `convex/marketing/posts.ts` (modified: `approve` refactored into shared
  `approvePost` + new `approveInternal`)
- `convex/opsActions.ts` (modified: `hasOpenDedupe`, `openDedupeExists`,
  `insertInternal`, `approve`'s `social_post` branch, `finalize`'s
  `social_post` branch)
- `convex/aiActions.ts` (modified: `writeRateCutPromos`'s marketing block)
- `src/app/(app)/inbox/page.tsx` (modified: `AGENT_META` entry, composer link)
- `convex/marketing/drafts.test.ts` (new: 3 tests)

No changes to `convex/_generated/api.d.ts`: all four touched Convex modules
(`opsActions`, `aiActions`, `marketing/posts`, `promos`) were already
registered in `fullApi`'s `ApiFromModules<{...}>` map by earlier tasks, and
that map derives function-level types via `typeof <module>`, so a new export
inside an already-registered module needs no further hand-patching. Did not
run Convex codegen (Node 25 breaks it, per the plan's standing note).

## Self-review findings

- `approvePost` is now the single code path for both the composer's
  `posts.approve` and the inbox's `opsActions.approve`: same status guard,
  same `client_win` check, same once-per-period metering, same schedule
  kick. No duplicated logic between the two callers.
- Ruling 3's dedupe fix required restructuring the brief's literal Step 5
  code (pre-check via a new `openDedupeExists` query, not just a post-hoc
  skip inside `insertInternal`) to actually prevent the promo+post from
  being created before the skip decision. Documented as a deviation below;
  I judge this necessary rather than optional, since the brief's literal
  ordering does not achieve what Ruling 3 asks for.
- `approveInternal` (posts.ts) is unused in this diff. `opsActions.approve`
  is a `mutation`, and Convex mutations don't have `ctx.runMutation`, so it
  cannot call an internal mutation reference anyway; it must call the plain
  `approvePost` function directly, which is what Step 4's own code sample
  shows. I kept `approveInternal` because the brief's Step 3 explicitly asks
  for it (and the "Interfaces" section lists it as a produced interface),
  but it has no current caller. Flagging rather than removing it, since a
  future action-based caller may be exactly why it was specified.
- Added a third test beyond the brief's two, to directly verify Ruling 3's
  stated scenario (no duplicate promo/post/card on a second sweep after one
  draft was approved). The brief's two tests do not exercise this path at
  all.
- No em dashes in any new code, comment, or test string (verified by grep
  across every touched file).
- Test output is pristine: no console warnings, no unhandled rejections, no
  stray debug artifacts (a temporary `_debug1.test.ts` and a temporary
  `process.env.OPS_DEBUG` throw were used only to diagnose the `node_modules`
  issue above and were removed before the final runs).

## Issues or concerns

1. **Tier deviation from Ruling 2, for test 1 only.** Ruling 2 says to set
   `tier: "studio"` explicitly in both brief tests. I did that for test 2 and
   the dedupe test, but test 1 (approving via `api.opsActions.approve`)
   needs `tier: "pro"` instead. Reason: `opsActions.approve` calls
   `requireCapability(ctx, "ops.action.approve", ...)`, which maps to the
   `"agent"` entitlement (`convex/lib/entitlements.ts:218`). `"agent"` is in
   `PRO_ADDS` (`convex/lib/plans.ts`), not in `STUDIO_CAPS`. So a
   `tier: "studio"` org gets a real `UPGRADE_REQUIRED` from `opsActions.approve`,
   independent of anything this task builds; this is a pre-existing,
   deliberate gate (the unified Ops Autopilot inbox, tagged "AI ops" in the
   Pro tier's own pitch copy, is a Pro-tier surface). A Studio-tier owner
   still gets the same draft and can approve it directly through the
   marketing composer's `posts.approve` (capability `"marketing.approve"`,
   which **is** in `STUDIO_CAPS`) - that path is unaffected and untested
   here because it's exactly what `convex/marketing/posts.test.ts` already
   covers. Ruling 2's text ("neither test asserts on caps today") was
   reasoning about usage caps, not about this separate capability gate,
   which I don't think was in view when that ruling was written. I judged
   the fix to be "seed the tier the test is actually exercising" rather than
   "block on this and ask", since it's a data-driven, discoverable fact
   about the existing entitlements model, not a design choice on my part.
   Flagging clearly in case the controller wants a different resolution
   (e.g., special-casing the capability check by action type instead, which
   I did not do, since that would be a real behavior change to shared code
   well outside this task's brief).
2. **`node_modules` resolution bug, not part of the commit.** As described
   above under RED, this worktree needed the same local `node_modules/`
   remedy Task 8's report already flagged as a risk for "whoever picks up
   task 9 onward." Fixed locally (gitignored, doesn't touch the diff), but
   restating here since it will hit task 10 too if its worktree starts bare.
3. **`approveInternal` is currently dead code** (see self-review above) -
   built to the brief's exact spec but has no caller in this diff.
4. Minor deviation from the brief's literal Step 5 code shape: the dedupe
   check moved to before promo/post creation (Ruling 3 requirement, not
   optional per my reading), and I added a small `stopPropagation` to the
   inbox composer link (functional bug fix, not a design change).

No other deviations. `convex/opsActions.ts` and `convex/aiActions.ts` did not
fight me; both additions follow existing patterns in-file (`upsertProposed`'s
OPEN set and insert shape; `writeRateCutPromos`'s existing per-rec loop).
