# Connect flow without the blocked OAuth scope

## Problem

`accounts.choices` called `listOAuthAccounts`, hitting
`GET /social-media-posting/oauth/{locationId}/{platform}/accounts/{oauthId}`.
Proven live against production: the Private Integration Token is not
authorised for that scope (`401 The token is not authorized for this
scope.`). Fixing the scope needs a login to the GHL UI, which belongs to the
account owner, not Pulse.

`GET /social-media-posting/{locationId}/accounts` (the plain accounts
roster) returns `200` with everything the picker needs, and the token
already carries this scope (it is also used by the account-health sweep).

## What changed

**`convex/lib/ghl.ts`**
- Added `avatar?: string` to `GhlAccountStatus` so the roster's avatar field
  survives the client wrapper (the sweep never needed it; the connect flow
  does).
- `listOAuthAccounts` is left in place, unused by the connect flow now, with
  a comment explaining why: if the account owner ever grants the missing
  scope, it is ready to use again. `attachOAuthAccount` (the POST sibling on
  the same path) is still called as the fallback path below, so the oauth
  route is not fully dead either way.

**`convex/marketing/accounts.ts`**
- `choices` now calls `listAccounts` instead of `listOAuthAccounts`. It
  filters the roster to the requested platform, drops `deleted` accounts,
  then narrows to the oauthId the popup handed back (`ghlAccountId`) when
  something on the roster matches it. If nothing matches, it falls back to
  every non-deleted account on that platform instead of an empty array, so
  a stale or missing oauthId does not read as "nothing to connect."
  `listAccounts` returning `null` (GHL unreachable or an untrustworthy
  response) now throws the existing `GHL_UNAVAILABLE` ConvexError instead of
  collapsing into an empty list.
- `attach` re-fetches the roster and looks for the chosen account there
  first. When found (and not deleted), it binds directly through
  `insertInternal` using the roster's live `name`/`avatar`, skipping the
  401ing `attachOAuthAccount` call entirely - every roster account is
  already attached at the GHL end, so Pulse's only job left is binding it to
  the studio's org. When the account is not on the roster (a stale choice,
  or the roster call itself failed), it falls through to the previous
  `attachOAuthAccount` path unchanged, and simulated mode (no GHL env) is
  untouched. `insertInternal`'s `ACCOUNT_TAKEN` check runs on every path,
  roster bind included, since it is the single place enforcing "one GHL
  account belongs to exactly one org, forever" - nothing in this change
  goes around it.
- The `attach` action's `choice` argument gained an optional `avatar` field
  to match what `choices` now returns.

**`src/components/social/use-connect-flow.ts`**
- Client `Choice` type gained the same optional `avatar` field.

**`src/components/social/connect-button.tsx`**
- Updated a comment that described the old failure mode (`listOAuthAccounts`
  returning `[]` on error, making an empty picker ambiguous). That comment
  was describing the exact bug this change fixes and was now stale; it now
  describes the current behavior (`GHL_UNAVAILABLE` throws, so an empty
  picker means an actual empty platform).

## GHL failure vs. empty roster

Before: a GHL error and a genuinely empty account list were both `[]`,
indistinguishable, so a GHL outage silently read as "you have nothing to
connect."

After: `listAccounts` returns `null` on any non-2xx, network failure, or
untrustworthy response shape, never `[]` for a real failure. `choices`
checks for `null` explicitly and throws `GHL_UNAVAILABLE` before it ever
touches the platform filter, so:
- GHL down / bad response -> `ConvexError({ code: "GHL_UNAVAILABLE" })` ->
  surfaces to the owner as "Could not read the connected account. Reconnect
  and try again."
- GHL up, zero accounts on the requested platform -> `[]`, no error - the
  owner genuinely has nothing there.

## What was left in place, and why

- `listOAuthAccounts` and the GET-side of the oauth path stay in
  `convex/lib/ghl.ts`, unused, documented as blocked on a scope only the
  account owner can grant.
- `attachOAuthAccount` (POST) stays live as `attach`'s fallback for any
  chosen account that is not on the roster, so behavior for that edge case
  is unchanged from before this fix.
- The picker does not filter out accounts already bound to another org (or
  this one) at the GHL layer - `insertInternal` remains the single place
  that decides an account is taken, so the `ACCOUNT_TAKEN` message stays
  consistent regardless of entry point. This was scoped as a "nice touch"
  in the request and left undone to keep the diff focused on the actual
  blocker.

## Tests

Added to `convex/marketing/accounts.test.ts` (all in the existing
"marketing accounts" describe block, using the same `vi.stubEnv` /
`vi.stubGlobal("fetch", ...)` pattern as the account-health-sweep tests):

1. `choices` maps the roster to picker choices for the requested platform.
2. `choices` excludes deleted accounts.
3. `choices` returns empty for a platform with no accounts, not an error.
4. `choices` falls back to every non-deleted account on the platform when
   the oauthId does not match anything on the roster.
5. `choices` surfaces `GHL_UNAVAILABLE`, not an empty list, when the roster
   call fails.
6. `attach` binds a roster account directly (asserts the mocked `fetch` is
   called exactly once - the roster GET - and never hits an `/oauth/` URL).
7. `attach` still throws `ACCOUNT_TAKEN` when the chosen roster account
   already belongs to a different org.

`npm test` (1444 tests, 169 files), `npm run typecheck`, and `npm run lint`
are all green (lint: 0 errors, pre-existing unrelated warnings only, none in
the files this change touched).
