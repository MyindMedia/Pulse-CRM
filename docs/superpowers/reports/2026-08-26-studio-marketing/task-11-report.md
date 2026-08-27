# Task 11: Nav, route gate, and Accounts page

## Base and worktree correction

The worktree came up on `worktree-agent-af09327c1d19763be` at `3de7019` (main tip), not
`b921d83` on `feat/studio-marketing`. `feat/studio-marketing` was checked out in the main
Pulse checkout, so this worktree could not check that branch name out a second time.
Fixed with `git reset --hard b921d83` on the existing local branch (working tree was clean,
nothing to lose), confirmed `git rev-parse HEAD` = `b921d8388d9a12fc088468986e9b9a49b65da4fa`
before writing any code. `node_modules` was symlinked from the main checkout
(`ln -s .../pulse/node_modules .../worktrees/agent-af09327c1d19763be/node_modules`).

## What I implemented

- `src/components/social/platforms.ts` - `PLATFORM_META: Record<Platform, {label, icon, hint}>`
  per ruling 2 (not `color`), and `PLATFORM_ORDER`. Icons per ruling 1's mapping, with one
  substitution beyond what the ruling listed:
  - **Icon substitution beyond the ruling:** the ruling names `PlaySquare` for YouTube, but
    that symbol is also absent from this repo's lucide-react 1.16.0
    (`node_modules/lucide-react/dist/lucide-react.d.ts` has no `declare const PlaySquare`).
    Verified by grep before writing any import. Used `SquarePlay` instead - the same glyph
    under lucide's newer name (confirmed present via grep) - so YouTube keeps a play-button
    icon rather than falling back to something unrelated.
- `src/components/social/account-row.tsx` - `AccountRow` component plus the exported `Account`
  type (mirroring `api.marketing.accounts.list`'s return shape, matching the
  `src/components/releases/types.ts` convention of hand-written types documented as "as
  returned by api.X"). Renders platform icon, name, follower count, and a `needs_reconnect`
  suffix inline. Extracted into its own file per the brief's file list even though the brief's
  own accounts/page.tsx snippet inlined this JSX - matches "one clear responsibility per file"
  and gives tasks 12/13 a row-component precedent to copy.
- `src/components/social/connect-button.tsx` - popup + postMessage OAuth flow. Deviates from
  the brief's literal code in ways the brief's own code would not have compiled or would have
  produced poor UX (all found by reading the real files, not guessed):
  - **Design tokens don't exist:** the brief's `var(--surface-container-low)` and `var(--error)`
    are not real CSS variables in this codebase (checked `src/app/globals.css` - this is a
    dark "Liquid Glass Studio" theme with `--color-coal-2/3`, `--color-critical`, etc., not
    Material tokens). Used `bg-coal-2`/`bg-coal-3`/`border-graphite/50` and `text-critical`,
    matching the exact pattern already used for inline errors elsewhere
    (`src/app/(app)/visitors/page.tsx:450`).
  - **Error messages:** the brief's `err instanceof Error ? err.message : "..."` does not
    unwrap a `ConvexError`'s structured `data.message` - it would show `LIMIT_REACHED`'s raw
    JSON blob (the exact "Studio tier caps 3 connected accounts" error named in the task's
    global constraints) as a wall of text. Used the repo's existing `errorMessage()` helper
    (`src/lib/errors.ts`, already used in 13 other files) instead.
  - **Parked finding from Task 6 (empty picker):** `listOAuthAccounts` (`convex/lib/ghl.ts:81`)
    returns `[]` on a GHL failure rather than throwing, so `choices`'s own try/catch never
    fires. Added an explicit `list.length === 0` branch that reads "Could not find any {label}
    pages or profiles on that account. Reconnect and try again." instead of silently rendering
    an empty `<ul>` that would look like "this account has nothing to offer."
  - **Ruling 2 (hint as caption):** `meta.hint` renders as a `<p>` under each Connect button in
    the "Add an account" grid.
  - **`finish()` had no error handling in the brief** (its per-choice `onClick` called it with
    no try/catch, and its single-choice auto-attach path relied on the outer catch, which does
    not cover the manual multi-choice click). `finish` now owns its own try/catch/finally via
    `useCallback`, so a `LIMIT_REACHED` or `ACCOUNT_TAKEN` thrown from `attach` always surfaces
    as a message, never an unhandled promise rejection, from either call site.
  - **Stuck-busy fix (my own addition, not in the brief):** if the owner closes the popup
    without GHL ever posting a message back, `busy` had no way to clear and the button stayed
    disabled forever. Added a `popup.closed` poll that resets `busy`, guarded by a `handling`
    ref so it cannot race the in-flight `choices`/`attach` call after a real message arrives
    (verified the race by tracing the timing: `.close()` + `popup.current = null` on message
    receipt means the watcher's stale-reference check can never fire mid-flow).
- `src/app/(app)/marketing/layout.tsx` - `PageHeader` plus a small `Link`-based tab strip
  (Calendar/Compose/Accounts/Promos/Results), styled to match `src/components/ui/tabs.tsx`'s
  `TabsList`/`TabsTrigger` classes even though it's route-navigation rather than Radix's
  content-switching `Tabs` (no existing precedent in this repo for a route-linked tab strip;
  `src/app/(app)/patch/[id]/page.tsx`'s tabs are client-state, not routes).
- `src/app/(app)/marketing/accounts/page.tsx` - assembled from `Section`, `EmptyState`,
  `AccountRow`, `ConnectButton`. Two brief-vs-real-component mismatches fixed: `Section` has no
  `blurb` prop (real signature: `title, trailing, children, className` -
  `src/components/ui/page.tsx`) - rendered the blurb as a plain `<p className="text-sm
  text-steel">` first child instead, relying on `Section`'s own `space-y-3`. `EmptyState` has
  `description`, not `body` (`src/components/ui/feedback.tsx`). `remove` mutation errors are
  now caught and surfaced via `toast.error(errorMessage(...))`, matching the repo's
  `sonner`-toast convention (the brief's version called `remove` with no error handling at
  all).
- `src/lib/nav.ts` - `Megaphone` import, Marketing nav entry after Releases, verbatim per the
  brief.
- `src/lib/features.ts` - `marketing: "marketing"` in `featureForPath`, verbatim.
- `convex/lib/entitlements.ts` - **ruling 3**: added `"marketing"` to `NAV_CAPABILITIES`. This
  entry is exercised by an existing test (`convex/entitlements.test.ts`'s "maps every nav
  capability to a real feature key" test, which iterates `NAV_CAPABILITIES` and asserts
  `minTierFor` is non-null for each) - it passed, confirming `"marketing"` is correctly sold at
  Studio tier (`convex/lib/plans.ts:146`, `STUDIO_CAPS`).

No Convex codegen was needed - `convex/marketing/accounts.ts` and its `api.d.ts` registration
already existed from earlier tasks (verified `convex/_generated/api.d.ts:144,357` already
imports and maps `marketing/accounts`). This task touched no Convex handler code, so
`api.d.ts` did not need hand-patching.

## What I tested and the results

- `npm run typecheck` - clean, no errors.
- `npm run lint` - 0 errors, 80 warnings, all pre-existing (verified by grepping the lint
  output for my changed file paths - none appear; the one error I did introduce mid-work,
  `react/no-unescaped-entities` on a straight apostrophe in `accounts/page.tsx`, was fixed by
  switching to the repo's existing convention of a typographic apostrophe in JSX text, e.g.
  `src/components/agency/invite-studio-dialog.tsx:107`).
- `npm test` (`vitest run`) - **155 test files, 1317 tests, all passing.** Before trusting
  this, ran a focused `npx vitest run convex/marketing/accounts.test.ts --reporter=verbose`
  first and counted its 6 printed test names against `grep -c "  test(\|  it("` on the actual
  file (6/6 match) - confirms the symlinked `node_modules` + `preserveSymlinks: true` (landed
  by Task 10) is resolving `convex-test`'s module glob to this worktree, not the sibling main
  checkout.
- **Page-render proof (step 3):** started `PORT=3311 npx next dev --webpack` (Turbopack is the
  Next 16 default here; forced webpack per the prior task's finding that Turbopack crashes on
  a symlinked `node_modules`). Built a worktree-local `.env.local` with only
  `NEXT_PUBLIC_CONVEX_URL`/`NEXT_PUBLIC_CONVEX_SITE_URL` copied from the main checkout and no
  Clerk keys, matching the documented "dev demo mode = blank Clerk keys" pattern
  (`src/components/shell/auth-gate.tsx:7` gates on `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` being
  set) - `.env*` is gitignored so nothing here gets committed.
  - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3311/marketing/accounts` -> `200`.
  - Saved the response body and grepped it: `Marketing`, `Connected accounts`, `Add an
    account` all present, and all ten platform labels (`Instagram`, `Facebook Page`, `Google
    Business Profile`, `TikTok`, `TikTok Business`, `YouTube`, `LinkedIn`, `Threads`,
    `Pinterest`, `Bluesky`) render server-side inside the Connect buttons - confirms the page
    is real content, not a blank or error shell.
  - No `Something went wrong` / `Application error` / hydration-error text in the response
    (the two `ChunkLoadError` string hits were Next's own dev-mode auto-refresh boilerplate,
    not a triggered error - confirmed by reading the surrounding 80 characters of context).
  - Dev server log for the request showed a clean compile and `GET /marketing/accounts 200`
    with no error lines.
  - `curl /dashboard` -> `200` (server is healthy generally, not just this one route).
  - `curl /marketing` (bare, the future Calendar tab) -> `404`, as expected: no
    `src/app/(app)/marketing/page.tsx` exists yet (task 12 lands it). The sidebar's Marketing
    entry and this task's own tab strip both link there; until task 12 ships, that specific
    link 404s cleanly rather than crashing. Not a defect in this task's scope, called out here
    so the controller can track it as sequencing, not an oversight.
  - **What I did not verify:** I do not have interactive browser access that would let me pick
    between the two connected Chrome sessions (`AskUserQuestion` is not available to me), so I
    could not visually confirm client-side hydration (e.g., the sidebar's "Marketing" entry
    appearing after `useCapabilities()` resolves) or click through the popup OAuth flow in a
    real browser. What I can state as verified is the SSR output (server-rendered HTML,
    confirmed real and error-free) plus the full automated test suite. The sidebar-visibility
    code path itself is unchanged (`src/components/shell/sidebar.tsx`'s existing
    `feature`/`capability` filter, exercised identically by every other nav entry already in
    production) and my nav.ts entry is a verbatim-shaped addition to that same list.

## Files changed

- `src/lib/nav.ts` (modified)
- `src/lib/features.ts` (modified)
- `convex/lib/entitlements.ts` (modified)
- `src/components/social/platforms.ts` (new)
- `src/components/social/account-row.tsx` (new)
- `src/components/social/connect-button.tsx` (new)
- `src/app/(app)/marketing/layout.tsx` (new)
- `src/app/(app)/marketing/accounts/page.tsx` (new)

## Self-review findings

- Every failure path the Accounts UI can hit now degrades into readable copy: `startConnect`
  cap/GHL errors, `choices` network errors, the empty-picker case, `attach` cap/ownership
  errors, and `remove` errors all route through `errorMessage()` into either an inline `<p>` or
  a toast - none of them can reach the user as a raw `ConvexError` object or an unhandled
  rejection.
- Naming and structure match existing precedent closely enough that tasks 12/13 have a real
  pattern to copy: hand-written response types documented "as returned by api.X" (matches
  `releases/types.ts`), `errorMessage()` for every catch block, `toast.error()` for mutation
  failures outside a dedicated error state, `Section`/`EmptyState`/`Button` from
  `@/components/ui/*` before reaching for anything new.
- YAGNI check: did not add a shared `types.ts` for one small type (kept `Account` inline in
  `account-row.tsx`); did not build a generic route-tab-strip component (kept it local to
  `marketing/layout.tsx` since nothing else needs it yet); did not gate Connect/Remove buttons
  behind `can("marketing.approve")` in addition to the backend's own enforcement - the backend
  already throws a readable `CAPABILITY_DENIED`-adjacent error that surfaces through
  `errorMessage()`, and no other page in this codebase pre-emptively hides actions a role can't
  perform when the underlying capability isn't itself feature-flagged per role in the UI layer
  (the studio/page.tsx precedent I found for `can()`-gating a button is for a genuinely
  separate capability, `rooms.edit`, gating an "Add room" *creation* action - not a pattern
  this page's read/approve split clearly calls for without more product input).
- The `finish`/`handling`-ref interaction in `connect-button.tsx` is the one piece of real
  complexity I added beyond the brief. I traced the busy/watcher race by hand (documented in
  the file's own comment) rather than leaving it as a hopeful "should be fine" - flagging it
  here so a reviewer knows to look at it specifically rather than trust the comment.

## Issues or concerns

- Icon substitution beyond ruling 1: YouTube uses `SquarePlay`, not the ruling's named
  `PlaySquare`, because `PlaySquare` is also absent from this repo's lucide-react 1.16.0.
  Verified via grep before use; reported per the task's instruction to say so.
- `/marketing` (bare) and `/marketing/promos` and `/marketing/results` 404 until tasks 12-14
  land their pages. The tab strip and nav item still link there since the brief's file list
  and the nav entry's href are both specified verbatim - I did not add an index redirect or
  stub page, since that file is not in this task's brief and would be scope creep.
- Did not get end-to-end interactive/visual confirmation in a real browser (no
  `AskUserQuestion` tool available to pick between two connected Chrome sessions). Relied on
  curl-based SSR verification plus the full test suite; see the render-proof section above for
  exactly what was and was not checked.
