# Task 7 Report: Posts Lifecycle and GHL Scheduling

## Summary

Implemented `convex/marketing/posts.ts` and `convex/marketing/posts.test.ts` per the brief, added `ghlAccountIdsForOrg` to `convex/marketing/accounts.ts`, hand-patched `convex/_generated/api.d.ts` to register the new module, and registered the `social-status-sync` cron in `convex/crons.ts`. All seven tests in the brief pass, the full suite is green, typecheck is clean.

## Implementation

### convex/marketing/posts.ts (implemented from the brief's Step 3 code block)

- `buildTrackedLink` (exported pure helper): builds `/book/<slug>[/<roomId>]?src=<postId>[&code=<code>]`.
- `postInput`: copied verbatim from the Interfaces section of the brief (the brief's code block deliberately elides it with a comment placeholder; I substituted the real validator object).
- `validateInput` (shared, not exported): enforces at least one account, a minimum 5-minute lead time, that every `accountId` resolves to a non-removed `socialAccounts` row belonging to the caller's org (throws `ConvexError({ code: "FOREIGN_ACCOUNT", ... })` with message matching `/not one of this studio/`, otherwise), that any `promoId` belongs to the org, and runs `validateForPlatform` per selected account's platform.
- `create` (mutation, capability `marketing.edit`): validates, strips em dashes from the caption, inserts as `status: "draft"`, then patches in the tracked link if `includeBookingLink`.
- `update` (mutation, capability `marketing.edit`): only for `draft`/`approved`/`failed` posts; re-validates and resets to `draft` (clearing `approvedBy`/`approvedAt`/`failure`).
- `approve` (mutation, capability `marketing.approve`): only from `draft`/`failed`; blocks `client_win` posts whose artist lacks `okToFeature`; meters `social_posts` via `assertWithinLimit` + `recordUsage`; patches to `approved`; schedules `internal.marketing.posts.schedule` via `ctx.scheduler.runAfter(0, ...)`.
- `payloadContext` (internalQuery): one read that assembles everything the `schedule` action needs (post, org + `ghl` override, live account list re-filtered by org/removed, media resolved to URLs from storage or the brand-card route, promo).
- `schedule` (internalAction): re-checks the account count against `payloadContext`'s org-filtered account list (the security invariant's second half: even if a foreign account somehow reached the post row, the count mismatch fails the post instead of sending it) before calling GHL; builds `GhlPostInput` (adding `gmbPostDetails` for Google + promo, `tiktokPostDetails` for TikTok platforms); on missing GHL env, marks `scheduled` with `ghlPostId: "simulated:<id>"`; on GHL error, marks `failed`; on success, stores the real `ghlPostId`.
- `markStatus` (internalMutation): patches status/fields and writes an `activity` row on `failed`/`published`.
- `cancel` (mutation, capability `marketing.approve`): blocks cancelling a `published` post; marks `cancelled`; schedules `deleteInGhl` for a real (non-simulated) scheduled post.
- `deleteInGhl` (internalAction): best-effort GHL delete.
- `list` (query, capability `marketing.read`): `by_org_scheduled` range query, filters out `cancelled`.
- `get` (query, capability `marketing.read`): org-scoped single read.
- `createInternal` (internalMutation): the AI-draft path, always `status: "draft"`, `submittedBy: "pulse-ai"`, skips platform validation (brief's stated design: accounts aren't picked yet).
- `scheduledDue` (internalQuery) and `syncStatusAll` (internalAction): the cron pair, detailed below.

### The `scheduledDue` / simulated-post handling (brief's trailing note)

The brief's Step 3 code block for `scheduledDue` returns a bare array of per-org groups, but the brief's closing note (right before Step 4) says: "Add to `scheduledDue` a second list of simulated posts past their time... return `simulated: due-like list...`, and at the top of `syncStatusAll` loop over them calling `markStatus`." A bare array has no room for a second named list, so I changed `scheduledDue`'s return shape to `{ groups, simulated }` (was: the array directly) and updated `syncStatusAll`'s destructuring to match. This is the one deliberate deviation from the literal code block, required to implement the note as described. Both are internal-only (never called from client code), so this is not a public API break.

- `scheduledDue`: `due` = `status === "scheduled"`, past `scheduledFor`, has a non-simulated `ghlPostId` (unchanged from the brief). `simulated` = same due-time filter but `ghlPostId` DOES start with `"simulated:"`.
- `syncStatusAll`: loops `simulated` first, marking each `published` with `publishedAt: scheduledFor` directly (no GHL call, matching the brief's instruction), then proceeds through `groups` exactly as the brief specifies (per-org `ghlFromEnv`, `ghlAccountIdsForOrg`, `listPosts`, matching remote status to `published`/`failed`).

### convex/marketing/accounts.ts addition

Added `ghlAccountIdsForOrg` (internalQuery) verbatim from the brief: returns the `ghlAccountId` of every non-removed `socialAccounts` row for an org, via the `by_org` index. Used by `syncStatusAll` to build the `accountIds` filter for `listPosts`.

### convex/crons.ts

Added, immediately after the `rate-cut-sweep` registration (the brief said "after the rate-cut sweep"):
```ts
crons.interval("social-status-sync", { minutes: 30 }, internal.marketing.posts.syncStatusAll, {});
```

### convex/_generated/api.d.ts

Hand-patched (this repo's `_generated/api.d.ts` is tracked in git with no live Convex deployment to codegen against):
- `import type * as marketing_posts from "../marketing/posts.js";` (between `marketing_accounts` and `members`, alphabetical)
- `"marketing/posts": typeof marketing_posts;` in the `fullApi` map, same position

Note: the task's Context section said to patch it "exactly like the existing `marketing/accounts` and `marketing/rules` entries" but there is no `marketing/rules` entry in `api.d.ts` (`rules.ts` exports only pure functions, no Convex mutation/query/action, so it never needed registration). I registered `marketing/posts` following the one real precedent, `marketing/accounts`.

`convex/_generated/api.js` needs no change (`anyApi` is a runtime Proxy; the `.d.ts` patch is only for `tsc`).

## TDD Evidence

**RED** - `npx vitest run convex/marketing/posts.test.ts` (before `posts.ts` existed):
```
FAIL  convex/marketing/posts.test.ts [ convex/marketing/posts.test.ts ]
Error: Cannot find module './posts' imported from convex/marketing/posts.test.ts
Test Files  1 failed (1)
     Tests  no tests
```

**First implementation pass, 5/7 passed:**
```
❯ convex/marketing/posts.test.ts (7 tests | 2 failed) 15ms
Error: Validator error: Missing required field `type` in object
 ❯ convex/marketing/posts.test.ts:26:22 (artists insert)
```
Cause: the brief's `beforeEach` inserts the `artists` fixture as `{ orgId, name, tags, okToFeature } as never`. The `artists` table (pre-existing, not part of this task) also requires `type`, `genres`, `status`, `lifetimeValueCents`, `sessionCount`, `reliability`. The `as never` cast hides this from `tsc` but Convex's runtime schema validator still rejects the insert. Fixed by adding the missing required fields with neutral defaults (`type: "artist"`, `genres: []`, `status: "active"`, `lifetimeValueCents: 0`, `sessionCount: 0`, `reliability: "solid"`) to the fixture; no assertion in any test depends on these fields, so this is a fixture completion, not a test-behavior change.

**Second implementation pass, 5/7 passed (posts.ts logic all correct), 2 failed on scheduling:**
```
FAIL  ... approve meters the monthly cap and schedules through GHL in simulated mode
AssertionError: expected 'approved' to be 'scheduled'
FAIL  ... schedule sends only this org's GHL account ids and stores the GHL post id
TypeError: undefined is not iterable
```
Cause: the brief's test calls `t.finishAllScheduledFunctions(() => {})`. Per `convex-test`'s own type: `finishAllScheduledFunctions(advanceTimers)` calls `advanceTimers` in a loop and needs `vi.useFakeTimers()` active for a no-op `advanceTimers` to have any effect; without it, the scheduled `internal.marketing.posts.schedule` action set up by `approve`'s `ctx.scheduler.runAfter(0, ...)` never actually ran, so `approve`'s mutation-side patch to `status: "approved"` was the last state observed. This repo's own convention (`convex/opsActions.test.ts`, `convex/memberships.test.ts`) is `vi.useFakeTimers()` in `beforeEach` + `t.finishAllScheduledFunctions(vi.runAllTimers)`. Applied that: added `vi.useFakeTimers()` to `beforeEach`, `vi.useRealTimers()` to `afterEach`, and changed both `finishAllScheduledFunctions(() => {})` calls to `finishAllScheduledFunctions(vi.runAllTimers)`. **I used `vi.useFakeTimers()` + `vi.runAllTimers`**, not `finishInProgressScheduledFunctions()`, to match the existing repo convention.

**GREEN (final)** - `npx vitest run convex/marketing/posts.test.ts`:
```
Test Files  1 passed (1)
     Tests  7 passed (7)
```

**Full suite** - `npm test`:
```
Test Files  152 passed (152)
     Tests  1305 passed (1305)
```

**Typecheck** - `npm run typecheck`: no output, exit 0.

## Files Changed

```
5 files changed, 416 insertions(+)
convex/_generated/api.d.ts     2 insertions (hand-patched registration)
convex/crons.ts                 3 insertions (cron registration)
convex/marketing/accounts.ts   10 insertions (ghlAccountIdsForOrg)
convex/marketing/posts.test.ts 96 lines (new)
convex/marketing/posts.ts     305 lines (new)
```

## Self-Review

- **Security invariant (the task's stated owner responsibility) proven twice:**
  1. `posts.create` refuses another org's account before any GHL call: `validateInput` checks every `accountId`'s `orgId` against the caller's org and throws `FOREIGN_ACCOUNT` (`/not one of this studio/`) synchronously in the mutation, so the check happens before `ctx.scheduler.runAfter` is ever reached (which only fires from `approve`, a later step). Test: "a post can never reference another org's account."
  2. `posts.schedule` sends only this org's `ghlAccountId`s: `payloadContext` re-derives the account list by re-checking `a.orgId === post.orgId && a.status !== "removed"` at read time (not trusting the post row's cached `accountIds` alone), and `schedule` compares `c.accounts.length !== c.post.accountIds.length` before calling GHL, failing the post if a mismatch appears (e.g., an account removed/reassigned between approve and schedule). Test: "schedule sends only this org's GHL account ids and stores the GHL post id" directly asserts the `fetch` body's `accountIds` is `["acc_1"]` (the org's own account), never `acc_2` (the foreign account created in the fixture but never referenced by this post).
- **Cap enforcement:** `approve` calls `assertWithinLimit(ctx, orgId, "social_posts", 1)` before mutating status, then `recordUsage`. Test "approve meters the monthly cap..." confirms the `usageCounters` row for `social_posts` reads `1` after one approval. I did not write a test that exhausts the studio 20-post cap (the brief's seven listed tests don't include one, unlike Task 6's connected-accounts cap test); `assertWithinLimit`/`recordUsage` themselves are already covered by `convex/usage.ts`'s own test suite and by Task 6's cap tests on the same mechanism.
- **Platform validation ordering:** `validateInput` checks account ownership before calling `validateForPlatform`, so a foreign-account post fails with `FOREIGN_ACCOUNT` even if its media/caption would also fail platform rules; this is the safer order (tenant isolation before content rules) and matches what the brief's two tests expect independently.
- **`client_win` gate is enforced at approve time, not create time,** exactly as the brief specifies and as its test names ("at approve time"): a post can be drafted with an un-cleared artist, but not approved, letting the studio queue the draft while waiting on the artist's OK.
- **Simulated mode never crashes:** `schedule` checks `ghlFromEnv(c.org)` and degrades to `ghlPostId: "simulated:<id>"` with status `scheduled` when GHL env is absent, consistent with the `sms.ts` convention cited in Global Constraints. `syncStatusAll` extends this: simulated posts are marked `published` directly by the cron since GHL has no record of them to poll.
- **Deviation from the literal brief:** two changes, both explained above and both non-production-facing in the sense of not changing any public behavior contract: (1) `scheduledDue`'s return shape (`{groups, simulated}` instead of an implicit "second list" the brief describes in prose but the code block doesn't show), required to implement the brief's own trailing note; (2) the test fixture's `artists` insert and the `vi.useFakeTimers()` addition, both fixture-only.
- **`deleteInGhl` / `cancel` are implemented exactly per the brief but have no dedicated test in this task's seven** (the brief's test list doesn't include one). The code path reuses `ghlFromEnv` and `deletePost`, both already covered by Task 2's `ghl.test.ts`.

## Concerns

- `scheduledDue`'s return-shape change is a deliberate, documented deviation from the brief's literal code block (though not from its intent, which the trailing note states in prose). Anyone touching `syncStatusAll` later should read that note in the plan doc alongside this report before assuming the array-returning shape shown in the Step 3 code block is current.
- No test exercises the studio tier's actual 20-post monthly cap being reached and rejected (only that one approval records `1`). Same gap pattern flagged in Task 6's report for the accounts cap before its Fix Round 1 added a dedicated test; here the brief's own seven tests didn't ask for one, so I did not add one unprompted, but a coordinator review may want it for symmetry with Task 6.
- `posts.update`'s tests are not in the brief's seven and I did not add any beyond what's specified; the function is implemented and typechecks but is otherwise unexercised here.

## Commits

1. **abde56d** Marketing: post lifecycle, GHL scheduling and status sync
   - Pushed to `origin/feat/studio-marketing` (confirmed: `f5df77e..abde56d`, `HEAD -> feat/studio-marketing`).

---

## Fix Round 1

Written by the controller. The fix implementer pushed its code commit and then terminated before appending this section, so the evidence below was gathered by the controller from the pushed commit and a local test run.

**Finding addressed (1 Important, plan-mandated and real):** `approve` double-counts `social_posts` on a retry after a failure or a re-approve after an edit, so a studio burns cap it already paid for and hits its monthly limit early.

**Ruling carried into the fix:** stamp `socialPosts.meteredPeriod` and meter once per post per period.

**Fix commit:** `7b91ad9` "Marketing: meter a scheduled post once per period, not once per approve"

**What changed:**
- `convex/schema.ts`: added `meteredPeriod: v.optional(v.string())` to `socialPosts`, the usage period ("YYYY-MM") the post already consumed a scheduling slot in.
- `convex/marketing/posts.ts`: `approve` now computes `periodFor("social_posts")`, skips both `assertWithinLimit` and `recordUsage` when `post.meteredPeriod` already equals that period, and stamps `meteredPeriod` on the patch only on the metering pass. A post re-approved in a later period meters again, since it occupies a slot in that period.
- `convex/marketing/posts.test.ts`: 3 new tests covering re-approve inside the same period, re-approve in a later period, and the cap interaction.

**Covering tests:** `convex/marketing/posts.test.ts`

**Command run:** `npx vitest run convex/marketing/posts.test.ts`

**Output:**
```
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  465ms
```

7 tests before the fix, 10 after.
