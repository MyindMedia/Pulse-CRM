# Gauntlet rematch: connected-accounts screen

Verdict being answered: Buffer won because a `needs_reconnect` token was quiet gray text with no fix, Remove was one click with no undo, and there was no plan-limit signal. Three gaps, three fixes below.

## Base and scope

`git rev-parse HEAD` was `f5e7dd3ab7199255d6118db90a1df83f3a3307aa` on branch `worktree-agent-a53467cc76d2f465e`, matching `origin/main` and `origin/feat/studio-marketing`. Did not touch `src/app/(app)/marketing/page.tsx` or `src/components/social/post-chip.tsx` (the concurrent calendar builder's files) - confirmed clean with `git status --porcelain` on those two paths before committing.

`origin/feat/studio-marketing` moved to `a71fd19` (the calendar builder's "Put channel identity and real filters on the marketing calendar") while this was in flight. Rebased on top of it; no conflicts, since that commit only touches the two files above.

## Preconditions

- `node_modules`: symlinked to the main checkout's (`ln -s ".../pulse/node_modules" node_modules`). Confirmed a focused run executes this worktree's files: `npx vitest run convex/marketing/accounts.test.ts` passed 6/6 before any edits, then 7/7 after adding a test.
- `.env.local` copied from the main checkout (`CONVEX_DEPLOYMENT=dev:fiery-cricket-350`) so `npx convex` CLI and the dev server point at the shared dev deployment.

## What I built

### 1. `needs_reconnect` is now actionable

- **`src/components/social/account-row.tsx`** - a broken account gets a `Badge tone="critical" dot` reading "Needs reconnect" next to its name, a critical-tinted border/background on the row (`border-critical/40 bg-critical/5` vs the normal `border-graphite/50 bg-coal-2`), and a `ReconnectAction` button when the viewer holds `marketing.approve`. Prop renamed `canRemove` -> `canManage` since it now gates two actions, not one.
- **`src/app/(app)/marketing/accounts/page.tsx`** - `sortAccounts()` puts `needs_reconnect` rows first with a stable sort (accounts within each group keep `list`'s original order), applied client-side so the `list` query's return shape stays untouched (it's also consumed by the calendar page and `composer.tsx`, both out of scope here).
- **`src/components/social/use-connect-flow.ts`** (new) - extracted `ConnectButton`'s GHL OAuth-popup/postMessage/attach plumbing into a `useConnectFlow(platform, reconnect)` hook so `ConnectButton` (fresh connect) and the new `ReconnectAction` (repair) share one implementation instead of two copies drifting apart.
- **`src/components/social/reconnect-action.tsx`** (new) - one-click "Reconnect" button. Calls `startConnect({ platform, reconnect: true })` - the first caller of `reconnect` anywhere in the codebase - which skips `assertWithinLimit` (the org already owns the slot) and starts the same GHL OAuth popup. On success, `insertInternal` finds the row by `ghlAccountId` and revives it to `connected`; the row updates itself through the reactive `list` query, no local reconciliation needed. Gated the same as Remove: `canManage` on the client (`marketing.approve`), and the server re-checks the same capability inside `startConnect` via `myOrgForConnect`.

### 2. Remove now confirms and uses the danger variant

- **`src/components/social/account-row.tsx`** - Remove is a `variant="danger"` button (was `variant="ghost"`) that opens `RemoveAccountDialog` (built on `@/components/ui/dialog`, mirroring the existing `RemoveMemberDialog` pattern in `src/components/studio/member-card.tsx`) instead of firing the mutation directly. The dialog names the account ("Remove @myindsound?"), states the immediate effect ("Pulse stops posting to this Instagram account right away"), and clarifies what it does not do ("does not revoke access on Instagram itself... will use a connected-account slot again" on reconnect). Confirm button is also `variant="danger"` with a `Trash2` icon and a "Removing..." busy state.
- `onRemove` changed from `() => void` to `() => Promise<void> | void` so the dialog can await it and only close after the mutation settles (page.tsx's `handleRemove` already swallows errors into a toast, so the dialog always closes, but the toast still tells the owner if it failed).

### 3. Plan-limit awareness

- **`convex/marketing/accounts.ts`** - new `limitStatus` query, gated on `marketing.read` like `list`. Returns `{ used, cap, tierLabel }` where `cap` is `null` for an unlimited tier (pro and above) rather than a meaningless "X of 999999". Left `list` and every other existing export untouched.
- **`src/app/(app)/marketing/accounts/page.tsx`** - `AccountLimitBadge` in the "Connected accounts" section's `trailing` slot: a plain "N connected" when uncapped, or "N of cap connected" plus a short segmented meter (reusing this product's existing step-marker visual language from `DeleteSubaccount`, not a literal Buffer-style percentage bar) that turns critical when at or over cap. When at cap, the "Add an account" section replaces the connect grid with a caution-toned message plus an "Upgrade to Studio Pro - $297.00/mo" button linking to `/settings`, following the exact pattern already used in `src/components/settings/white-label-panel.tsx` for the white-label upsell.
- A viewer without `marketing.approve` still sees the connected-count/limit badge (gated on `marketing.read`) and the existing "Ask a studio owner or manager..." message instead of the connect grid or the upgrade prompt - no unexplained empty area.

## Tests

Added to `convex/marketing/accounts.test.ts`: `limitStatus` reports `{used: 0, cap: 3, tierLabel: "Studio"}` for a fresh studio-tier org, `{used: 2, cap: 3, ...}` after connecting two accounts, and `cap: null` for a pro-tier org. All pre-existing tests untouched and still passing.

```
npm test          -> 166 test files, 1399 tests, all passed
npm run typecheck -> clean
npm run lint      -> 0 errors, 86 warnings (all pre-existing; none in any file this change touched)
```

## Manual QA: seeding `needs_reconnect`

Nothing writes `needs_reconnect` yet (separate, tracked gap - not this change's job). To exercise the UI against real data: added a temporary `internalMutation _devSetStatus` to `accounts.ts`, pushed it with `npx convex dev --once --codegen disable` (does not touch `convex/_generated`, per the "no codegen" constraint), flipped the demo org's `@myindsound` Instagram row (`vh75fbns00rewxswayjvqtk8e18d8nhn`) to `needs_reconnect` with `npx convex run marketing/accounts:_devSetStatus`, verified in the browser, then set it back to `connected`, deleted `_devSetStatus` from the source, and re-ran `npx convex dev --once --codegen disable` so the shared dev deployment no longer has a function the committed code doesn't. Confirmed removed via `npx convex function-spec`.

## What I actually saw in the browser

Dev server on port 3316 (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= PORT=3316 npx next dev --webpack`), demo org `pulse-demo`. Chrome MCP (`claude-in-chrome`) could not reach any localhost port from this environment (`ERR_CONNECTION_REFUSED` even on the already-running port 3311, confirmed it wasn't specific to my server) - used `agent-browser` (this repo's documented default browser-automation CLI) instead, which runs its own Chrome against the same sandbox network as the dev server.

- **`/marketing/accounts` with the seeded `needs_reconnect` row**: `@myindsound` (Instagram) sorted above the connected Facebook row, red-tinted card border, a red "NEEDS RECONNECT" dot-badge next to the name, and "Reconnect" + "Remove" buttons (Reconnect in a critical-outlined pill, Remove in the filled danger-red pill). Header showed "2 connected" (pulse-demo resolves to the top tier, so no cap - confirms the uncapped display path).
- **Clicked Reconnect**: fired `startConnect({platform:"instagram", reconnect:true})` for real; since this dev deployment has no GHL credentials configured, it correctly hit the `simulated: true` branch and showed "Social publishing is not configured on this server yet." inline under the button - no crash, no popup-blocked dead end, exactly the error path `ConnectButton` already used for a fresh connect.
- **Clicked Remove**: opened `RemoveAccountDialog` - "Remove @myindsound?" / "Pulse stops posting to this Instagram account right away." / body text explaining it does not revoke platform access and reconnecting reuses a slot / Cancel + red "Remove @myindsound" with a trash icon. Clicked Cancel - dialog closed, account still present, nothing removed.
- The studio-tier capped meter (segmented bar, "N of 3 connected", the at-limit upgrade card) is verified by the new `limitStatus` unit tests rather than a live screenshot: `tierForOrg` hardcodes the demo org to the top (unlimited) tier regardless of any `orgs.tier` value written to it, so there is no way to make `pulse-demo` render the capped path live without editing gate logic that is out of scope here.

## Files touched

- `convex/marketing/accounts.ts` - added `limitStatus`
- `convex/marketing/accounts.test.ts` - added `limitStatus` coverage
- `src/app/(app)/marketing/accounts/page.tsx` - sorting, limit badge, at-limit upgrade card, `canManage` rename
- `src/components/social/account-row.tsx` - badge/border, `ReconnectAction`, `RemoveAccountDialog`
- `src/components/social/connect-button.tsx` - refactored onto `useConnectFlow`
- `src/components/social/use-connect-flow.ts` (new) - shared OAuth-popup hook
- `src/components/social/reconnect-action.tsx` (new)
