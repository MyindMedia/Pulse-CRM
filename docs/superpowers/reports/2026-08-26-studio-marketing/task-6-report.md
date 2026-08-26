# Task 6 Report: Connected Accounts (OAuth Start, Attach, List, Remove)

## Summary

Implemented `convex/marketing/accounts.ts` and `convex/marketing/accounts.test.ts` per the brief. Hand-patched `convex/_generated/api.d.ts` to register the new nested module (this repo's `_generated/api.d.ts` is tracked in git and has no live Convex deployment, so `npx convex codegen` cannot run). All four tests in the brief pass, full suite is green, typecheck is clean.

## Implementation

### Files Created

1. **convex/marketing/accounts.ts** (implemented verbatim from the brief's Step 3 code block)
   - `orgContext` (internalQuery): org doc plus `ghl` override, read by actions that have no `ctx.db`.
   - `startConnect` (action): `{ platform, reconnect? }` -> `{ url }` or `{ simulated: true }` when GHL env is unconfigured.
   - `myOrgForConnect` (query): resolves the caller's org via `currentOrgWithCapability(ctx, "marketing.approve")` and checks the `social_accounts` cap via `assertWithinLimit`; called from actions through `ctx.runQuery` since actions cannot call `currentOrgWithCapability` directly (it is typed for `QueryCtx | MutationCtx`).
   - `choices` (action): lists the GHL accounts/pages available to attach for a platform; returns a single simulated choice when GHL is unconfigured.
   - `attach` (action): attaches the chosen GHL account and inserts the `socialAccounts` row via `internal.marketing.accounts.insertInternal`.
   - `whoAmI` (query): thin wrapper over `currentActor` so the action can attribute `connectedBy`.
   - `insertInternal` (internalMutation): the security-critical function. Looks up any existing row for the `ghlAccountId` via the `by_ghl_account` index; throws `ConvexError({ code: "ACCOUNT_TAKEN", message: "That profile is already connected to another studio." })` if it belongs to a different org, reconnects (patches status/name/avatar) if it belongs to the same org, otherwise checks the `social_accounts` cap and inserts a new row, recording usage.
   - `list` (query): capability-gated by `marketing.read`, returns only the caller's org's non-removed accounts.
   - `remove` (mutation): capability-gated by `marketing.approve`, soft-deletes (`status: "removed"`) and decrements usage.

2. **convex/marketing/accounts.test.ts** (from the brief's Step 1 code block, one deliberate fixture fix)
   - Same four `it` blocks as the brief.
   - **Fixture change:** added `tier: "studio"` to both seeded orgs in `beforeEach`. Explanation under Self-Review below; without it the "studio tier caps connected accounts at 3" test fails for a reason unrelated to the accounts.ts implementation.

### convex/_generated/api.d.ts

Added, alphabetically, following the exact pattern already used for the one other nested Convex module in this repo (`convex/agents/generators.ts` -> `"agents/generators"`):
- `import type * as marketing_accounts from "../marketing/accounts.js";` (between `maintenance` and `members`)
- `"marketing/accounts": typeof marketing_accounts;` in the `fullApi` object (same position)

`convex/_generated/api.js` needs no change: `api`/`internal` are Proxy-backed `anyApi` objects that resolve any property path at runtime, so `api.marketing.accounts.list` already worked before the patch. The `.d.ts` patch was needed only so `tsc --noEmit` type-checks the new call sites.

### convex/usage.ts: no change needed

The brief's note says to add `"social_accounts"` to whatever list makes `periodFor` return `"all"` for it, "if it is not already there." Checked first: `periodFor` returns `"all"` for any metric NOT in `MONTHLY_METRICS` (`ai_credits, email, sms, exports, magic_links, social_posts`). `social_accounts` was never in that set, so it already resolves to `"all"` (confirmed by the passing `convex/lib/marketingEntitlement.test.ts` assertion `periodFor("social_accounts", ...) === "all"`, which was already green before this task). `capForMetric` already mapped `social_accounts -> limits.socialAccountCap` (Task 1). No edit made.

## TDD Evidence

**RED** - `npx vitest run convex/marketing/accounts.test.ts` (before `accounts.ts` existed):
```
FAIL  convex/marketing/accounts.test.ts > marketing accounts > insertInternal refuses a GHL account id already owned by another org
Error: Could not find module for: "marketing/accounts"
 ... (same for the other 3 tests)
Test Files  1 failed (1)
     Tests  4 failed (4)
```

**GREEN (first pass, 3/4)** - after writing `accounts.ts` and patching `api.d.ts`:
```
❯ convex/marketing/accounts.test.ts (4 tests | 1 failed) 53ms
     × studio tier caps connected accounts at 3

AssertionError: promise resolved "'000000000000010008socialAccounts'" instead of rejecting
- Expected: Error { "message": "rejected promise" }
+ Received: "000000000000010008socialAccounts"
     Tests  1 failed | 3 passed (4)
```

**Diagnosis:** `insertInternal` calls `assertWithinLimit` -> `tierForOrg(ctx, orgId)`. `tierForOrg` prefers `org.tier`; when absent it falls back to `PLAN_TO_TIER[org.plan]` (`convex/lib/tier.ts`). `PLAN_TO_TIER` maps the legacy `orgs.plan` literal `"studio"` to the new TierKey `"pro"` (comment: legacy plan naming and the new, finer-grained TierKey naming don't line up 1:1; legacy `"studio"` was the old mid-tier, which now corresponds to `"pro"`, not the new cheaper `"studio"` TierKey). The seeded org only set `plan: "studio"` and no `tier`, so it resolved to tier `"pro"`, whose `socialAccountCap` is unlimited (`convex/lib/plans.ts`), so the 4th insert never hit the cap. This is a pre-existing, repo-wide convention (81 other test files seed `plan: "studio"` purely as schema-required filler, not to assert a specific tier), not a bug introduced by this task. Fixed by seeding `tier: "studio"` explicitly on the two test orgs, which is the only way to exercise the actual "studio" TierKey's cap of 3 from `convex/lib/plans.ts`.

**GREEN (final)** - `npx vitest run convex/marketing/accounts.test.ts`:
```
Test Files  1 passed (1)
     Tests  4 passed (4)
```

**Full suite** - `npm test`:
```
Test Files  151 passed (151)
     Tests  1296 passed (1296)
```

**Typecheck** - `npm run typecheck`: no output, exit 0.

**Lint** - `npx eslint convex/marketing/accounts.ts convex/marketing/accounts.test.ts`: no output, exit 0.

## Files Changed

```
3 files changed, 183 insertions(+)
convex/_generated/api.d.ts        2 insertions (hand-patched registration)
convex/marketing/accounts.test.ts 63 lines (new)
convex/marketing/accounts.ts      118 lines (new)
```

## Self-Review

- **Security invariant proven:** `insertInternal`'s test 2 (`insertInternal refuses a GHL account id already owned by another org`) directly proves one `ghlAccountId` belongs to exactly one org forever: attaching `acc_1` to org2 after org1 already owns it throws `ACCOUNT_TAKEN` and does not silently reassign or duplicate the row. Re-attaching the same account to the *same* org (a genuine reconnect) is the one case the code allows to succeed, and that's intentional (status flips back to `connected`, name/avatar refresh) rather than a gap in the invariant.
- **Cap enforcement:** proven both by direct `insertInternal` calls (3 succeed, 4th throws `LIMIT_REACHED`) and by `usage` accounting (`recordUsage`/`assertWithinLimit`), matching the Global Constraint of 3 connected accounts on the studio tier.
- **Tenant isolation:** `list` filters by the caller's `orgId` via `currentOrgWithCapability` + the `by_org` index, and `remove` re-checks `row.orgId !== orgId` before patching, so neither leaks or mutates another org's row even with a guessed `Id`.
- **Simulated mode:** `startConnect`/`choices`/`attach` all degrade to non-crashing simulated behavior when `GHL_API_KEY` is empty, consistent with the `sms.ts` convention cited in Global Constraints. Only `startConnect`'s simulated path is directly asserted by the brief's tests; `choices`/`attach` simulated branches are implemented identically but not separately unit-tested in this task (Task 6 test list didn't include them, and the same `ghlFromEnv(org) === null` guard is already covered structurally by the Task 2 `ghl.test.ts` suite).
- **`api.d.ts` hand-patch:** limited to the minimum two lines needed (one import, one map entry), placed alphabetically, matching the one existing nested-module precedent (`agents/generators`) exactly. Did not touch `api.js` (correctly not needed, `anyApi` is a runtime proxy).
- **Deviation from the literal brief:** the two-line `tier: "studio"` fixture addition described above. No production code deviates from the brief's Step 3 listing.

## Concerns

- The `PLAN_TO_TIER` legacy-plan-to-new-tier mapping (`convex/lib/tier.ts`) is a landmine for any future test or seed script that sets `orgs.plan` expecting it to imply the same-named `orgs.tier`/TierKey: legacy `"studio"` silently resolves to the new `"pro"` (unlimited) tier unless `tier` is set explicitly. This bit this task's own brief-supplied test fixture. Worth a one-line comment or a lint rule if it recurs; not fixed here since it's pre-existing behavior outside Task 6's scope, and 81 other test files already depend on the current mapping.
- `choices` and `attach`'s simulated-mode branches (GHL unconfigured) are implemented but have no direct unit test in this task; only `startConnect`'s simulated branch is asserted. Low risk since the guard (`ghlFromEnv(org)` returning `null`) is the same function already covered by Task 2's `ghl.test.ts`.

## Commits (initial implementation)

1. **df585cb** Marketing: connect, attach, list and remove social accounts through GHL
   - Pushed to `origin/feat/studio-marketing`.
2. **33708ac** Task 6 report
3. **4c848b1** Remove em dashes from task 6 report

## Fix Round 1

Coordinator review found three real defects, all confirmed and fixed. The spec's cap constraint ("connected-account count is capped per tier") is the binding authority, so the code was fixed, not the constraint.

### Finding 1: cap bypass via remove-then-reattach

`insertInternal`'s revive branch (an existing `socialAccounts` row for the same `ghlAccountId`, same org) patched the row back to `connected` unconditionally, with no `recordUsage` call. `remove` always ran `recordUsage(-1)`. Sequence: attach 3 at the studio cap, remove 1 (counter drops to 2, row still exists with `status: "removed"`), reattach the same account (counter stays 2 but the row is live again), attach a 4th distinct account (passes because the counter reads 2, not 3). Result: 4 live rows against a cap of 3.

Fix in `convex/marketing/accounts.ts`, `insertInternal`: capture `wasRemoved = owned.status === "removed"` before patching. Only when `wasRemoved`: call `assertWithinLimit(ctx, args.orgId, "social_accounts", 1)` before the patch, and `recordUsage(ctx, args.orgId, "social_accounts", 1)` after it. Reviving a `needs_reconnect` or already-`connected` row (a slot that was never decremented) now touches neither the cap check nor the counter.

### Finding 2: reconnect wrongly blocked at cap

`myOrgForConnect` unconditionally called `assertWithinLimit(ctx, orgId, "social_accounts", 1)`, so re-authorizing an account the org already owns (a `reconnect: true` call) failed with `LIMIT_REACHED` whenever the org was already at its cap, even though a reconnect claims no new slot.

Fix: `myOrgForConnect` is now capability-only (`return await currentOrgWithCapability(ctx, "marketing.approve");`, nothing else). The cap assert moved into `startConnect`, gated on `!reconnect`, calling the existing `internal.usage.checkLimit` internal query (already present in `convex/usage.ts`, built for exactly this: action callers with no `ctx.db`). `choices` and `attach` no longer duplicate a cap check; `attach`'s fresh-insert path is still capped by `insertInternal` (Finding 1 made that path reconnect-aware), and its reconnect path is correctly uncapped.

### Finding 3: raw GHL failure from `choices`

`choices` returned `await listOAuthAccounts(...)` directly with no guard, unlike `startConnect`/`attach`, which both check their GHL client call's result and throw a `ConvexError` on failure. Wrapped the call in try/catch; a failure now throws `ConvexError({ code: "GHL_UNAVAILABLE", message: "Could not read the connected account. Reconnect and try again." })` instead of surfacing a raw error.

### Tests added (both in `convex/marketing/accounts.test.ts`)

1. `remove-then-reattach the same ghlAccountId at cap keeps the cap honest`: attaches 3 (cap), removes one, reattaches the same `ghlAccountId`, asserts a 4th distinct account is still refused with `LIMIT_REACHED`, asserts `list` returns exactly 3 live rows, and asserts the `usageCounters` row for `social_accounts` equals 3 (not 2, not 4).
2. `reviving a needs_reconnect row does not change the usage counter`: inserts one account (counter = 1), patches its status to `needs_reconnect` directly via `t.run`, reattaches the same `ghlAccountId`, asserts the counter is still 1.

Both orgs in `beforeEach` already carried `tier: "studio"` explicitly from the prior round's fixture fix, so no further fixture change was needed for these two tests.

One incidental typecheck fix along the way: the new test's `ids` array was inferred as `string[]`, which does not satisfy `Id<"socialAccounts">`. Typed it explicitly as `Id<"socialAccounts">[]` and added `import type { Id } from "../_generated/dataModel";` to the test file.

### Commands and output

**Targeted run** - `npx vitest run convex/marketing/accounts.test.ts`:
```
Test Files  1 passed (1)
     Tests  6 passed (6)
```

**Full suite** - `npm test`:
```
Test Files  151 passed (151)
     Tests  1298 passed (1298)
```

**Typecheck** - `npm run typecheck`: no output, exit 0.

**Lint** - `npx eslint convex/marketing/accounts.ts convex/marketing/accounts.test.ts`: no output, exit 0.

### Files changed (Fix Round 1)

```
2 files changed, 69 insertions(+), 5 deletions(-)
convex/marketing/accounts.ts      31 changed lines
convex/marketing/accounts.test.ts 43 insertions (2 new tests + Id import)
```

### Commit (Fix Round 1)

**3eb021d** Marketing: keep the connected-account cap honest across remove and reconnect
Pushed to `origin/feat/studio-marketing` (confirmed: `origin/feat/studio-marketing` is at `3eb021d` before this report commit).
