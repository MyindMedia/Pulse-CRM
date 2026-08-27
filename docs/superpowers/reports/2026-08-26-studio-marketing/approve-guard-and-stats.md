# Approve guard fix + GHL stats tooltip honesty

Branch: `feat/studio-marketing` (worktree tracked `5b8feb0` at start, this commit follows it).

## Fix 1: approve let a needs_reconnect account through

### Root cause

`socialAccounts.status` has three values: `connected`, `needs_reconnect`, `removed`.
Two guards on the approve/schedule path checked `=== "removed"` (or its
negation), which is a deny-list: anything not explicitly "removed" passed,
including "needs_reconnect". Until 2026-08-26 nothing ever wrote
`needs_reconnect`, so the hole was unreachable. The new hourly
`accountHealthSweep` (`convex/marketing/accounts.ts`) now writes exactly that
status when GHL reports a token expired, deleted, or missing, so the hole
became live.

### Changes

Both guards inverted from a deny-list ("not removed") to an allow-list
("must be connected"), in `convex/marketing/posts.ts`:

1. `approvePost` (line ~159): `account.status === "removed"` to
   `account.status !== "connected"`. This is the guard the critic
   reproduced directly: it now refuses to approve a post that selects a
   `needs_reconnect` account, with the existing copy unchanged ("One of the
   selected accounts is no longer connected. Reconnect it, or remove it
   from this post, before approving.").
2. `payloadContext` (line ~201): `a.status !== "removed"` to
   `a.status === "connected"`, so the account list built for `schedule`
   only ever includes truly-postable accounts. This matters even after fix
   1, because `schedule` runs asynchronously after `approve` (via
   `ctx.scheduler.runAfter(0, ...)`) and re-reads account rows from
   scratch; if an account flipped to `needs_reconnect` in that gap,
   `payloadContext`'s old filter would still have included it and
   `schedule` would have tried to post to a broken account instead of
   catching the length mismatch and marking the post `failed`.

### Where the same assumption did NOT get changed, on purpose

- `convex/marketing/accounts.ts` `insertInternal`'s `wasRemoved` check
  (`owned.status === "removed"`) is a *different* decision: whether a
  reconnect needs to re-claim a usage slot under the account cap. Reviving
  a `needs_reconnect` row correctly does not re-meter (it never freed its
  slot); only reviving a genuinely `removed` row does. Per the task's
  explicit instruction, this was left untouched.
- `convex/marketing/posts.ts` `validateInput` (line ~77, used by
  `create`/`update`, the compose/draft path) still checks
  `a.status === "removed"`, so a `needs_reconnect` account can still be
  attached to a new draft. This is outside the "approve or schedule path"
  the task scoped the check to, and it is not a live-scheduling bug: any
  post that ends up with a `needs_reconnect` account now gets caught at
  `approve` regardless of when it was attached. Flagging it here in case a
  future task wants create/update to warn earlier too.
- `convex/marketing/accounts.ts`'s other `!== "removed"` filters
  (`list`, `limitStatus`, `ghlAccountIdsForOrg`, `orgsForHealthCheck`) are
  correct as written: they intentionally include `needs_reconnect` rows
  (to show the reconnect UI, count them against the cap, and let the
  health sweep recover them), not "can we post to this account" decisions.

### Test

Added `convex/marketing/posts.test.ts`: "approve refuses a post whose
selected account needs reconnecting", parallel to the existing
removed-account test, patches an account to `needs_reconnect` and asserts
`approve` throws `/no longer connected/` and the post stays `draft`.

## Fix 2: GHL impressions/engagements tooltip promised something no code delivers

### Investigation

Grepped `convex/` for every write to `socialPosts.stats`: none exist. The
only writer of any GHL-sourced stats is `refreshStatsAll`
(`convex/marketing/results.ts`), a daily cron that calls `accountStats`
(`convex/lib/ghl.ts`, hits `POST /social-media-posting/statistics`) and
writes `followers`/`reach` onto `socialAccounts` via `writeStats`, keyed by
`v.id("socialAccounts")`. It never touches `socialPosts`.

Checked whether that same statistics endpoint could plausibly return a
per-post breakdown (the task's explicit "implement it" condition) by
pulling GoHighLevel's own API docs
(`marketplace.gohighlevel.com/docs/ghl/social-planner/get-statistics/`):
the response is aggregated by account/platform only (`totals`,
`postPerformance` daily series, `breakdowns`, `platformTotals`,
`demographics`), with no `postId` field or per-post array anywhere in the
documented schema. A separate "Get post" endpoint does carry a per-post
`insights.like/share/comment`, but that is a different endpoint from the
one this codebase already calls, has no `impressions` field at all, and
wiring it in would mean inventing a mapping (which counts count as
"engagements"?) the docs don't confirm and this task explicitly warned
against guessing at.

### Decision: told the truth, did not implement

Chose the honest-copy path. The endpoint this app already calls for GHL
stats cannot produce per-post impressions or engagements, so implementing
would mean guessing at an unconfirmed shape from a different endpoint,
exactly the mistake the task said a previous builder already made.

### Changes, in `src/app/(app)/marketing/results/page.tsx`

- Tooltip hints on both "GHL impressions" and "GHL engagements" column
  headers rewritten to state the current reality (GHL does not provide
  per-post counts through this app's connection; account-level reach and
  followers sync daily, on the Accounts page) instead of promising a sync
  "once available."
- Cell placeholder changed from "Not synced" (implies pending) to "Not
  available" (matches the "Not available" wording already used elsewhere
  in this codebase, e.g. `src/app/book/[slug]/[roomId]/page.tsx`).
- Rewrote the file's top docblock comment, which previously claimed
  impressions/engagements would populate "once the daily stats refresh has
  populated them," to document why the columns can never populate through
  the current integration and to warn against re-introducing a future-sync
  promise without first wiring a real per-post data source.

No schema, cron, or GHL client changes; `socialPosts.stats.impressions`/
`.engagements` fields stay in the schema unused, same as before.

## Verification

- `npx vitest run`: 169 files, 1437 tests, all passed (includes the new
  `needs_reconnect` approve test).
- `npx tsc --noEmit`: clean.
- `npx eslint`: 0 errors, 84 pre-existing warnings (none in the three
  touched files beyond one pre-existing unused-import warning in
  `posts.test.ts` that predates this change).
- No Convex codegen run.
