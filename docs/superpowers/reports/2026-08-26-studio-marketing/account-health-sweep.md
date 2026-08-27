# Account health sweep: the write side of needs_reconnect

## The gap

A previous builder shipped the reactive half of broken-token handling: rows
with `status: "needs_reconnect"` sort to the top of the accounts list with a
critical badge and a tinted row, and a Reconnect control reopens OAuth with
`reconnect: true`. Nothing in `convex/` ever wrote `"needs_reconnect"`. Not a
webhook, not a poll, not a cron. The existing `social-status-sync` cron
(`internal.marketing.posts.syncStatusAll`) only touches `socialPosts`. So a
studio's social token expiring roughly every 60 days stayed invisible until
scheduled posts started failing, exactly the complaint this was supposed to
close.

## What was built

`convex/lib/ghl.ts` - added `listAccounts(g: GhlCtx)`, a wrapper around
`GET /social-media-posting/{locationId}/accounts` (already exercised, header
checks only, in `ghl.test.ts:31`). Returns `GhlAccountStatus[] | null`:
`null` means the call failed or came back in a shape that cannot be trusted
(non-2xx, network error, missing/malformed `results`); an array (possibly
empty) means the call succeeded and that is the real account roster.
Keeping these two cases distinct in the type is what makes fail-closed
possible downstream - if a failed call and an empty roster both mapped to
`[]`, a 401 across the whole location would look identical to "every
account is gone."

`convex/marketing/accounts.ts` - three additions, same file that already
owns `socialAccounts` writes (`insertInternal`, `remove`):

- `orgsForHealthCheck` (internalQuery) - every non-removed `socialAccounts`
  row (both `connected` and `needs_reconnect`, so a token that heals can be
  recovered, not just broken), grouped by org. Same shape as
  `results.orgsWithAccounts` and `posts.scheduledDue`.
- `applyAccountHealth` (internalMutation) - re-reads each row before
  patching (a row can be removed between the GHL call and the write) and
  never touches a row that is already `removed` or already at the target
  status.
- `accountHealthSweep` (internalAction) - the sweep itself.

`convex/crons.ts` - registered as `social-account-health`, hourly, next to
the other two marketing crons.

## Detection rule

An account is marked `needs_reconnect` when GHL's roster for that org's
location shows any of:

- `isExpired: true`
- `deleted: true`
- the account is absent from the list entirely (same signal as a studio
  revoking access from the platform side, or GHL retiring the id)

**Pre-expiry warning: decided against it.** The schema's `socialAccounts.status`
is a closed three-value union (`connected` | `needs_reconnect` | `removed`),
and the accounts UI (`account-row.tsx`) types `Account.status` against that
same union to decide the badge, the tint, and the sort order. A fourth
"expiring soon" state would need a new literal in both places plus a new
badge/sort bucket - real UI work, and this task was scoped as backend-only
("no UI"). `isExpired` is GHL's own "broken now" boundary; there is nothing
between connected and needs_reconnect for the schema to hold today. The
mitigation instead is cadence: hourly means a token that tips into
`isExpired` is caught and surfaced (via the badge that already ships) within
the hour, not after the 30-minute post-sync cron has already burned a failed
publish attempt or two. If a real pre-expiry warning becomes a requirement
later, the natural extension is an `expiresAt: v.optional(v.number())` field
on the row (this sweep already sees GHL's `expire` timestamp and could write
it) plus a new UI treatment - deliberately left for that follow-up rather
than half-building it here.

## Interval: hourly

The 30-minute `social-status-sync` cron polls for post-publish outcomes
because GHL has no post webhooks and a scheduled post can complete at any
minute. Token health is a different shape of problem: a token is good for
roughly 60 days, so polling for its breakage does not need sub-hour
resolution. Hourly keeps the external-API cost to one call per org per hour
(cheap, matches the existing `social-stats` cron's one-call-per-org-per-day
pattern at a tighter cadence because breakage matters more immediately than
follower counts), while still closing the "invisible until posts fail" gap
inside a single hour instead of leaving it open for a day.

## Failure handling (fail closed)

Grouped by org first, exactly like `refreshStatsAll` and `syncStatusAll`:
`orgsForHealthCheck` returns rows per org, `orgContext` + `ghlFromEnv`
resolve each org's own GHL context (respecting a per-org `locationId`/
`tokenRef` override), and `listAccounts` is called once per org through that
context. Three fail-closed paths, all resulting in zero writes for that org:

1. **Missing GHL env (simulated mode).** `ghlFromEnv` returns `null` and the
   org is skipped before any call is made. There is nothing to verify a
   simulated org's accounts against, so simulated accounts simply stay
   whatever status they already have - no crash, no write. Covered by "is a
   no-op in simulated mode instead of crashing" (also asserts `fetch` was
   never called).
2. **Non-2xx or a response shape `listAccounts` cannot trust.** Returns
   `null`, the action `continue`s past that org, nothing is written for any
   of its accounts. Covered by "changes nothing when the GHL call fails"
   (a 401), which asserts both a healthy row and an already-broken row are
   untouched in either direction.
3. **Network failure (`fetch` throws).** `ghlFetch`'s try/catch turns this
   into the same `{ ok: false }` shape as a non-2xx, so it collapses into
   path 2. Covered by its own test to make sure the throw itself does not
   propagate out of the sweep.

## Multi-tenant invariant

One GHL location hosts every studio's accounts. The sweep never sends one
org's account ids into another org's call (there is no such parameter on
this endpoint, since it returns a location's full roster, not a filtered
one) and, more importantly, never applies one org's GHL response to another
org's rows: `accountHealthSweep` only ever matches `g.accounts` (already
scoped to that org's own `socialAccounts` rows) against the roster fetched
through that same org's own `ghl` context. Test "never sends one org's
account ids into another org's GHL call" proves this end to end: org2 is
given a `ghl: { locationId: "loc_org2", tokenRef: "GHL_TOKEN_ORG2" }`
override, `fetch` is mocked to return different rosters per `locationId` in
the URL, and the test asserts (a) exactly two calls were made, one per
location, with the right `Authorization` header on each, and (b) org2's
account going missing from its own roster does not touch org1's account,
which stays `connected`.

## Tests

`convex/marketing/accounts.test.ts`, new `describe("account health sweep")`
block, 10 cases:

- expired account marked `needs_reconnect`
- deleted account marked `needs_reconnect`
- account absent from the roster marked `needs_reconnect`
- healthy account stays `connected`
- a `needs_reconnect` account that comes back healthy is restored to
  `connected`
- a GHL 401 across the whole location changes nothing (both a healthy and
  an already-broken row, in both directions)
- a network failure (`fetch` throws) changes nothing
- a `removed` row is never touched, even when absent from a returned roster
  that would otherwise mark it broken
- simulated mode (no `GHL_API_KEY`) is a no-op, `fetch` is never called
- two orgs' calls never cross (the multi-tenant invariant, detailed above)

`orgs` are inserted with `tier: "studio"` explicitly where the cap matters
elsewhere in this file; the health-sweep tests do not exercise
tier-dependent behaviour, so `tier` was left unset there and orgs default
through `plan: "studio"` - no `pulse-demo` org id is used anywhere in this
suite, so the `DEMO_ORG` unlimited-tier special case in `convex/lib/tier.ts`
never applies.

Ran `npm test` (166 files, 1409 tests, all passing), `npm run typecheck`
(clean), and `npm run lint` (0 errors, 86 pre-existing warnings in unrelated
React files, none in the four files this change touched).

## Files changed

- `convex/lib/ghl.ts` - `GhlAccountStatus` type, `listAccounts()`
- `convex/marketing/accounts.ts` - `orgsForHealthCheck`,
  `applyAccountHealth`, `accountHealthSweep`
- `convex/marketing/accounts.test.ts` - 10 new tests
- `convex/crons.ts` - `social-account-health`, hourly

No schema change, no UI change, no touch to any file the concurrent builder
owns (`composer.tsx`, `media-picker.tsx`, `rules-preview.ts`, the brand-card
route, `convex/marketing/posts.ts`).

## Worktree verification

Fast-forwarded this worktree's branch from `f5e7dd3` to `1861c7c`
(`feat/studio-marketing`'s HEAD) before starting - `git merge-base` against
`feat/studio-marketing` equaled this worktree's prior HEAD, so the
fast-forward was a strict no-op on history. Symlinked `node_modules` from
the main checkout, then ran `npx vitest run
convex/marketing/accounts.test.ts` and confirmed the `RUN` banner printed
this worktree's own path before making any change, then again after, to
confirm the focused run executed this worktree's files both times.
