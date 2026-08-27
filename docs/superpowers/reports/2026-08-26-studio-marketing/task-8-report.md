# Task 8 Report: Results (attribution) query and account stats

## Summary

Implemented `convex/marketing/results.ts` from the brief's Step 3 code block verbatim (only doc-comment wording added, no logic changes), added `convex/marketing/results.test.ts` with the controller-mandated `redemptions: 1` fix, hand-patched `convex/_generated/api.d.ts` to register the new module, and added the `social-stats` daily cron in `convex/crons.ts` next to `social-status-sync`. The one test in the brief passes, the full suite (153 files, 1309 tests) is green, typecheck is clean.

## Controller ruling applied

Changed the test's expectation for post A from `redemptions: 2` to `redemptions: 1`, with a comment explaining why: post A gets two attributed bookings inside the window (one carrying `postId` with no code, a tracked-link click; one carrying `code: "A20"` with no `postId`, the actual redemption). Only the second matches `promoCode.get(target) === vRow.code.toUpperCase()` in the Step 3 loop, so `redemptions` is 1. The implementation was left exactly as the brief specifies; only the test expectation changed.

## Implementation (convex/marketing/results.ts)

- `perPost` (query, capability `marketing.read`): loads this org's `published` posts in `[from, to]` by `publishedAt` (falling back to `scheduledFor`), builds a `postId -> promo code` map and its inverse `code -> postId` map, then walks every `bookingVisits` row for the org once. A visit resolves to a target post by `postId` first, falling back to `code` only when no `postId` match exists (postId beats code). `"page"` steps count as clicks unconditionally; `"booked"` steps count as a booking + revenue only when `createdAt` falls within `[publishedAt, publishedAt + 7 days]`, and count as a redemption only when the visit's own code matches the target post's own promo code.
- `orgsWithAccounts` (internalQuery): groups every `connected` `socialAccounts` row by `orgId`.
- `writeStats` (internalMutation): patches one account's `stats` object.
- `refreshStatsAll` (internalAction, daily cron): iterates the org groups from `orgsWithAccounts`, resolves each org's GHL context via `internal.marketing.accounts.orgContext` + `ghlFromEnv`, skips orgs with no GHL config, calls `accountStats` once per org with only that org's `ghlAccountId`s, and writes back `followers`/`reach` per account.

### Multi-tenant scoping proof

- `perPost`: `orgId` comes only from `currentOrgWithCapability`, never from client args. Both `socialPosts` and `bookingVisits` queries filter with `.eq("orgId", orgId)` before any row is touched, so no other org's posts or visits ever enter the working set (nothing to leak, structurally).
- `refreshStatsAll`: `orgsWithAccounts` groups `socialAccounts` rows by their own `orgId` field first; each group's `accounts` array is built exclusively from rows where `r.orgId === orgId` for that group. The single `accountStats(ghl, g.accounts.map(a => a.ghlAccountId))` call per iteration therefore only ever carries that one org's `ghlAccountId`s, and `ghl` itself is resolved from that same org's `orgContext`. No cross-org `ghlAccountId` can reach another org's GHL call.

### convex/crons.ts

Added right after `social-status-sync` (task 7's cron), without touching it:
```ts
crons.daily("social-stats", { hourUTC: 9, minuteUTC: 0 }, internal.marketing.results.refreshStatsAll, {});
```

### convex/_generated/api.d.ts

Hand-patched (no codegen, per repo convention: local Node is v25, codegen fails):
- `import type * as marketing_results from "../marketing/results.js";` (alphabetically after `marketing_posts`)
- `"marketing/results": typeof marketing_results;` in the `fullApi` map, same position

`convex/_generated/api.js` needed no change (`anyApi` is a runtime Proxy).

## Environment issue found and worked around (not part of the shipped diff)

This worktree's local `node_modules/` was essentially empty (only a `.vite` cache dir); every package, including `convex-test`, resolves via Node's upward directory search to the **shared main checkout's** `node_modules` (`pulse/node_modules`, a sibling git worktree also sitting on `feat/studio-marketing` at `9d925cf`). `convex-test`'s default `convexTest(schema)` computes its module glob relative to its own `dist/index.js` file location, so with `convex-test` resolving from the shared checkout, the glob targeted the shared checkout's `convex/` directory, not this worktree's. That directory doesn't have `marketing/results.ts` (only this worktree does, uncommitted), so the test failed with `Could not find module for: "marketing/results"` even after the implementation was written correctly.

I ruled out passing an explicit `modules` argument to `convexTest` in the test file: `import.meta.glob` computes each matched file's key as the shortest relative path from the *calling file's own directory*, so files in the same directory as `results.test.ts` (i.e. sibling files in `convex/marketing/`) get a `./`-prefixed key while everything else gets `../`-prefixed keys. That breaks `convex-test`'s single-common-prefix assumption for any glob call site living inside a subdirectory of the tree it globs, so no `import.meta.glob` pattern written inside `results.test.ts` could fix it. This is a general problem for any `convex/**/*.test.ts` file in this repo, not specific to my code.

Fix applied (local-only, not part of the commit): copied the small (128K, pure JS, no native deps) `convex-test` package from the shared checkout's `node_modules` into this worktree's own `node_modules/convex-test`, so Node resolves it locally and its internal glob (three directories up from its own `dist/index.js`) correctly lands on **this worktree's own** `convex/`. `node_modules/` is gitignored, confirmed via `git status` showing no changes there, so nothing about this workaround reaches the commit or the pushed branch. I flag it because the same issue will hit every subsequent task's worktree in this plan unless each one's `node_modules` is a real, independent install rather than resolving upward to a shared checkout.

## TDD Evidence

**RED** - `npx vitest run convex/marketing/results.test.ts` (before `results.ts` existed):
```
FAIL  convex/marketing/results.test.ts > marketing results > counts clicks, bookings and revenue per post inside the 7-day window, postId over code
Error: Could not find module for: "marketing/results"
```
Expected: the module doesn't exist yet.

**GREEN** - `npx vitest run convex/marketing/results.test.ts` (after implementation + the local `convex-test` fix above):
```
Test Files  1 passed (1)
     Tests  1 passed (1)
```

**Typecheck** - `npm run typecheck`: no output, exit clean.

**Full suite** - `npx vitest run`:
```
Test Files  153 passed (153)
     Tests  1309 passed (1309)
```

**Marketing module together** - `npx vitest run convex/marketing/`:
```
Test Files  4 passed (4)
     Tests  22 passed (22)
```

## Files changed

- `convex/marketing/results.ts` (new)
- `convex/marketing/results.test.ts` (new)
- `convex/crons.ts` (modified: added `social-stats` cron)
- `convex/_generated/api.d.ts` (modified: registered `marketing/results`)

## Self-review

- Removed a large decorative `/* ── ... ── */` header block comment from my first draft of `results.ts` after checking sibling files (`posts.ts`, `accounts.ts`, `rules.ts`) - none of them use that style; they use short `/** ... */` doc comments directly above each export. Rewrote to match: one doc comment on `perPost` explaining the attribution/window/redemption rules, one on `refreshStatsAll` explaining the per-org scoping invariant.
- Verified no em dashes in any new or modified file (checked via Unicode codepoint grep for U+2014).
- Verified the test's assertions exercise real behavior (attribution join logic across two posts, two attribution paths, a window boundary, and postId-over-code precedence), not a mock.
- Checked that `plan: "studio"` alone (no explicit `tier`) in the test fixture, as literally given in the brief, still resolves to a tier with `marketing.read` capability (`PLAN_TO_TIER["studio"] = "pro"`, and `"marketing"` module capability is in the base `STUDIO_CAPS` set that `PRO_CAPS` extends), so the fixture works as written; did not add an explicit `tier` field since this query has no cap-sensitive assertions to protect.
- No YAGNI additions: implemented exactly what the brief's Step 3 code specifies, nothing more.

## Issues or concerns

- The environment workaround above (local `convex-test` copy) is not part of the shipped diff and doesn't affect the committed/pushed code, but the underlying worktree `node_modules` gap is a real risk for whoever picks up task 9 onward in a similarly bare worktree - flagging it so it isn't rediscovered from scratch.
- My assigned worktree directory was, at task start, checked out on an unrelated branch (`worktree-agent-a5e900d733bce97e5`, a gear/room-publishing feature) rather than `feat/studio-marketing` at `9d925cf`. I created a new local branch `task8-results` from `9d925cf` inside the same worktree to get the correct base without touching the branch already checked out in the shared main checkout, then pushed `task8-results:feat/studio-marketing` to origin. Flagging this in case worktree provisioning for this plan needs a look.

## Fix Round 1

Two Important findings from review, addressed against `HEAD a8a3f87`.

### Finding 1: `perPost` scanned the org's entire `bookingVisits` history

`convex/marketing/results.ts` queried `bookingVisits` with `by_org_step` bound only on `orgId`, pulling every visit row the org has ever written. Fixed to bound by `by_org_day` instead, following the sibling `funnel` query's pattern in `convex/bookingFunnel.ts:150-158`:

```ts
const sinceDay = dayKey(from - WINDOW);
const untilDay = dayKey(to + WINDOW);
const visits = await ctx.db.query("bookingVisits")
  .withIndex("by_org_day", (q) => q.eq("orgId", orgId).gte("day", sinceDay).lte("day", untilDay))
  .collect();
```

`dayKey` is imported from `../bookingFunnel` (the existing exported helper, not a new formatter). The bound is a superset of every row the per-post logic can use: `booked` rows are only ever counted within `[publishedAt, publishedAt + WINDOW]` and `publishedAt` is already restricted to `[from, to]`, so `[from - WINDOW, to + WINDOW]` covers every in-scope `booked` row with a full week of slack on both sides, and `page` rows (clicks, uncounted by time in the existing logic) fall inside the same practical range since a tracked link can't be clicked before the post that carries its `postId` exists. Counting semantics in the loop are untouched: `postId` still beats `code`, `page` steps still count as clicks unconditionally, `booked` steps are still filtered to `[publishedAt, publishedAt + 7 days]` per post.

### Finding 2: no test for the per-org GHL grouping

Added a second test to `convex/marketing/results.test.ts` that inserts two orgs' `socialAccounts` (org1: two `connected` plus one `removed`; org2: one `connected`), calls `t.query(internal.marketing.results.orgsWithAccounts, {})`, and asserts:
- exactly 2 groups,
- org1's group contains only `["acc_1a", "acc_1b"]` (the removed account's `ghlAccountId` is excluded),
- org2's group contains only `["acc_2"]`,
- neither group's account list contains the other org's `ghlAccountId`.

This is the regression net named in the finding: if `orgsWithAccounts` or `refreshStatsAll` ever flattened accounts across groups before calling `accountStats`, this test would fail.

### Comment added

A one-line-plus-context comment above `codeToPost` explaining that when two published posts in the window share one promo code, only the first is kept, so code-only bookings attribute to the earliest of them - inherent (a code-only booking cannot say which post drove it) rather than a defect.

### Not in scope (per instruction)

Did not touch: the duplicated per-org GHL context resolution between `posts.ts` and `results.ts`, the sequential promo lookups in the `perPost` loop, or the unindexed date filter on the published-posts query. Deferred to the final whole-branch review.

### Tests covering the amended code

- `convex/marketing/results.test.ts` - both tests (the original `perPost` attribution test, unchanged in assertions, still passes against the new day-bounded query; the new `orgsWithAccounts` cross-org grouping test)

**Command:**
```
npx vitest run convex/marketing/results.test.ts
```
**Output:**
```
Test Files  1 passed (1)
     Tests  2 passed (2)
```

**Typecheck:**
```
npm run typecheck
```
Output: no errors, exit clean.

### Environment note

Confirmed `git rev-parse HEAD` was `a8a3f87` before editing. The local `node_modules/convex-test` copy from the original task run (a real directory copy, not a symlink, gitignored) was still present in this worktree from the prior session and continued to correctly anchor `convexTest(schema)`'s default module glob to this worktree's own `convex/` tree, confirmed by both tests passing against the newly-written code rather than a stale sibling checkout.
