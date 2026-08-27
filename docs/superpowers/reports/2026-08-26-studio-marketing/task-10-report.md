# Task 10: Brand Card image route

## Base and worktree correction

The worktree came up on an unrelated branch (`worktree-agent-aa95fe1a4442f27f6` at `3de7019`,
a different feature entirely - room/gear/booking work). Re-branched from `be550d2` on a new
local branch `task-10-brand-card`, confirmed `git rev-parse HEAD` = `be550d2278ce226be5fb396720f7722a4c1d04b70`
before writing any code. `feat/studio-marketing` was already checked out in the main pulse
checkout, so this worktree could not check that branch name out a second time; the new local
branch was pushed with `git push origin task-10-brand-card:feat/studio-marketing`, which
fast-forwarded cleanly (no rebase needed).

## What I implemented

- `convex/marketing/brandCard.ts` - public query `data({ postId })` returning the eight
  display-only fields (`studioName, accent, logoUrl, roomName, rateLabel, promoCode, promoPct,
  windowLabel`), per ruling 1. No `kind` field - that is the route's own query-string parameter.
- `convex/marketing/brandCard.test.ts` - the brief's Step 1 test, run RED before the query
  existed and GREEN after.
- `src/app/api/brand-card/[postId]/route.tsx` - `GET` route rendering a 1080x1350 PNG via
  `next/og`'s `ImageResponse`, with the brief's Step 3 layout, plus rulings 2 and 3:
  - **Fonts (ruling 2):** `loadGoogleFont`, copied from `src/app/opengraph-image.tsx`'s
    pattern almost verbatim (fetch TTF from Google Fonts css2, regex out the src url, return
    null on failure). Fetches Archivo Black (headline) and Inter at 500/700 (body/studio
    name/promo code), subset to a baseline charset plus the actual per-request text (studio
    name, room/promo names are arbitrary), in parallel. `fonts` is passed to `ImageResponse`
    only when non-empty, so a Google Fonts outage degrades to the default face rather than
    failing the route.
  - **Logo fetch (ruling 3):** rather than leaving `<img src={d.logoUrl}>` for satori to fetch
    internally (where a network hiccup mid-render would throw and 500 the route), the route
    fetches the logo itself first, inlines it as a base64 data URI, and falls back to
    `logoDataUrl = null` (logoless card) on any fetch failure or non-OK response.
  - Wrapped the `ImageResponse` construction itself in try/catch (matching the Next.js docs'
    own example) so an unexpected satori/resvg error also degrades to a `500` response body
    rather than an unhandled exception.
- `convex/_generated/api.d.ts` - hand-patched the import and registration lines for
  `marketing/brandCard`, matching the pattern from tasks 3/6/8/9 (codegen not run; Node 25
  breaks it per the task brief).
- `src/middleware.ts` - added `/api/brand-card(.*)` to the Clerk `isPublicRoute` matcher.
  **This is beyond the brief and is a real finding, not scope creep for its own sake:**
  `convex/marketing/posts.ts:160` already builds
  `${APP_HOST}/api/brand-card/${post._id}?kind=${m.brandCard}&v=${post.updatedAt}` and hands
  it to GHL as the post's `image/png` media URL - GHL's Social Planner fetches that URL
  server-to-server, signed out. Before this change, any route under `/api/*` that wasn't in
  the public-route list got Clerk's `auth.protect()` treatment, which 307-redirects an
  unauthenticated request to `/sign-in`. In production (where `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  is set), GHL's fetch would have received an HTML sign-in redirect instead of a PNG,
  silently breaking every brand-card post. Verified this concretely: before the fix, curling
  the route in dev with a real Clerk key configured produced the sign-in redirect behavior
  described in the middleware comments; after adding the matcher entry, the same request
  passed through to the route handler (confirmed via the `x-middleware-rewrite` response
  header and a signed-out response reaching the handler - see the route-render proof below).
- `vitest.config.ts` - added `resolve.preserveSymlinks: true`. **Also beyond the brief, and
  load-bearing, not optional polish** - see the TDD section below; without it, `npx vitest run
  convex/marketing` silently targets the sibling main checkout's `convex/` tree instead of
  this worktree's, exactly the failure mode the task brief warned about ("an earlier task in
  this plan nearly reported green on code it never ran").

## TDD evidence

**RED** - `npx vitest run convex/marketing/brandCard.test.ts` before `brandCard.ts` existed:
```
✖ marketing brand card > brand card data exposes only display fields
Error: Could not find module for: "marketing/brandCard"
```
Expected failure: the query module does not exist yet.

However, the first attempt at this RED run (before adding `preserveSymlinks` to
`vitest.config.ts`) failed with the *same* "Could not find module" error even after
`brandCard.ts` was written and correctly hand-registered in `api.d.ts`. Root cause:
`node_modules` in this worktree is a symlink into the main checkout, and Vite/Vitest resolve
symlinks to their real path by default. `convex-test`'s internal
`import.meta.glob("../../../convex/**/*.*s")` is relative to the convex-test package's own
location inside `node_modules`, so with the symlink followed to its real path, that glob
statically resolved to the **main checkout's** `convex/` directory (which does not have
`brandCard.ts` at all), not this worktree's. I confirmed this root cause directly: a
temporary vitest config with `resolve.preserveSymlinks: true` made the exact same test pass
immediately with no other changes, and the main checkout's `convex/marketing/` directory was
independently confirmed to be missing `brandCard.ts` at the time. Since the pre-existing
marketing test files are currently byte-identical between the two trees (both on `be550d2`),
this same bug would have let a broken *edit* to an existing file report green while silently
testing stale code in the other tree - exactly the danger flagged in my task brief. Fixed
permanently in `vitest.config.ts` (see diff), not worked around locally.

**GREEN** - `npx vitest run convex/marketing` after implementing `brandCard.ts` and the
`preserveSymlinks` fix:
```
✓ convex/marketing/brandCard.test.ts > marketing brand card > brand card data exposes only display fields 18ms
...
Test Files  6 passed (6)
     Tests  28 passed (28)
```

`npm run typecheck` (`tsc --noEmit`): clean, no errors.

Full suite once before committing: `npx vitest run` → **155 files, 1315 tests, all passed**
(this also validates the `preserveSymlinks` change didn't regress anything else in the
suite, run from this worktree).

## Route-render proof (step 4)

The dev Convex deployment (`fiery-cricket-350`, from `.env.local` copied out of the main
checkout for this manual check only - it's gitignored, not committed) could **not** be pushed
to. `npx convex dev --once --codegen disable --typecheck disable` (run under a node@22 keg to
avoid the documented Node 25 codegen crash) failed its own preflight:

```
Environment variable CLERK_JWT_ISSUER_DOMAIN is used in auth config file but its value was
not set.
```

This is a pre-existing gap on that shared dev deployment, unrelated to this change (see
`convex/auth.config.ts`'s own comment: unset is the documented demo-mode fallback). Setting
it on a shared dev deployment to work around a CLI preflight was out of scope and risked
breaking other people's auth testing against that same deployment, so I did not do it and did
not get a real end-to-end Convex round-trip through the dev server for this task.

What I did verify, honestly split into two parts:

1. **End-to-end through the real Next.js dev server** (`PORT=3311 npx next dev --webpack` -
   Turbopack itself crashed on the symlinked `node_modules`, `TurbopackInternalError: Symlink
   [project]/node_modules is invalid, it points out of the filesystem root`; `--webpack`
   avoided that and started cleanly). Curled a nonexistent post id:
   ```
   curl -D- http://localhost:3311/api/brand-card/kg2fakepostidfakepostidfakepo?kind=promo
   HTTP/1.1 404 Not Found
   x-clerk-auth-status: signed-out
   x-middleware-rewrite: /api/brand-card/kg2fakepostidfakepostidfakepo?kind=promo
   content-type: text/plain;charset=UTF-8
   ```
   This proves, against the real running app: the Clerk middleware fix lets a signed-out
   request through instead of redirecting to `/sign-in` (`x-middleware-rewrite` shows it
   reached the route rather than being redirected); the dynamic `[postId]` route dispatches;
   and the route degrades to a plain `404`, not a crash, when the underlying Convex query
   fails (in this case because the function isn't deployed at all, not because the post is
   missing - same code path either way).

2. **The satori render path itself** (fonts, logo fetch/degrade, actual PNG bytes), which the
   404 above cannot exercise since it never reaches `ImageResponse`. I wrote a temporary,
   uncommitted test file at `src/app/api/brand-card/[postId]/_manual-render-check.test.ts`
   that imports the real `GET` handler directly and monkeypatches only
   `ConvexHttpClient.prototype.query` to return fixture data (avoiding the unpushable
   deployment) - the Google Fonts fetch and the logo fetch are real network calls, not
   mocked. Deleted before committing; `git status` confirms it is not part of the diff.

   Result, saved to
   `/private/tmp/claude-501/-Users-myindsound-Library-CloudStorage-Dropbox-MyindSound-Myind-Sound-Myind-Media-Dev-Pulse-SaaS/2a191801-efab-4cbd-b4cb-fd0b90b7c584/scratchpad/`:

   | file | kind exercised | status | content-type | bytes | dimensions |
   |---|---|---|---|---|---|
   | `brandcard-promo.png` | `promo` | 200 | image/png | 71,072 | 1080x1350 |
   | `brandcard-rate_card.png` | `rate_card` | 200 | image/png | 56,258 | 1080x1350 |
   | `brandcard-open_slot.png` | `open_slot` | 200 | image/png | 74,785 | 1080x1350 |
   | `brandcard-logofail.png` | `promo`, with an unreachable logo URL | 200 | image/png | 69,127 | 1080x1350 |

   A fifth case (query throws, simulating the exact failure the real deployment produced)
   asserted a `404`, not a `500`. All confirmed real PNGs via `file`; viewed `brandcard-promo.png`
   and `brandcard-rate_card.png` directly - the headline renders in a genuinely heavy face
   (Archivo Black) in the studio's accent colour, the studio name and promo code render bold
   (Inter 700), and `brandcard-logofail.png` shows the identical layout with the logo simply
   absent - no broken image, no crash, no Pulse mark anywhere on the card.

I'm confident the route's own logic is correct and exercised for real (fonts, logo
degradation, all three `kind` branches, and the query-failure-to-404 path). What I did not
get was a single curl hitting a real Convex-backed post end to end, because the shared dev
deployment could not be pushed to for reasons outside this change.

## Files changed

- `convex/marketing/brandCard.ts` (new)
- `convex/marketing/brandCard.test.ts` (new)
- `src/app/api/brand-card/[postId]/route.tsx` (new)
- `convex/_generated/api.d.ts` (hand-patched registration)
- `src/middleware.ts` (added `/api/brand-card(.*)` to public routes)
- `vitest.config.ts` (added `resolve.preserveSymlinks: true`)

## Self-review

- **Completeness against the brief + rulings:** all three controller rulings applied (eight-field
  query shape with no `kind`; real fonts passed to satori; logo fetch pre-resolved with
  graceful degradation). Caching header (`immutable`, busted by `v=`) kept as specified.
- **Naming:** matches the brief exactly (`brandCard.ts`, `data` query, `route.tsx`).
- **YAGNI:** did not add anything the brief didn't ask for beyond the two infra fixes
  (middleware public route, vitest preserveSymlinks), both of which are load-bearing for the
  feature to function at all, not speculative generality. Did not add a second Convex test
  for a malformed-id case after concluding it would test an unrelated, uncertain code path
  (argument validation format) rather than the "post not found" path the handler already
  covers with `if (!post) return null`.
- **Does the test verify real behavior?** Yes - it seeds real Convex records across four
  tables and asserts the exact returned shape (`toEqual`, not a partial match), which would
  fail if `kind` were accidentally included or any field were misnamed/miscomputed (e.g.
  `rateLabel` rounding, `accent` fallback).
- **Does the route degrade rather than throw on every external dependency?**
  - Missing `NEXT_PUBLIC_CONVEX_URL` → 404, no crash.
  - Convex query throws (bad id, deployment down, function missing) → caught → 404.
  - Post/org not found (query returns `null`) → 404.
  - Google Fonts fetch fails → `null` per font, filtered out, `fonts: undefined` if all fail
    → default face, not a crash.
  - Logo fetch fails or returns non-OK → `logoDataUrl = null` → logoless card, not a crash.
  - `ImageResponse`/satori itself throws → caught → `500` with a plain message, not an
    unhandled exception.
- One thing I considered and rejected: fetching the logo through `ctx.storage.getUrl` already
  happens in the Convex query (returns `null` if `logoId` unset), so the route's own fetch
  wrapping is the only additional failure surface introduced by this task, and it's covered.

## Issues or concerns

- **Two changes beyond the brief's file list** (`src/middleware.ts`, `vitest.config.ts`).
  Both are small, one-purpose, commented, and necessary for correctness rather than
  stylistic - flagging per the task's instruction to report any deviation from the brief and
  why. Happy to have these reviewed separately if the controller wants them split out.
- **No true end-to-end proof against a live Convex-backed post**, for reasons documented
  above (shared dev deployment's own auth-config preflight, unrelated to this change). If a
  working dev deployment or a scoped way to seed one becomes available, the exact `curl`
  command to run is: `curl -o card.png "http://localhost:3311/api/brand-card/<real postId>?kind=promo"`.
- `.env.local` was copied into this worktree from the main checkout to attempt the dev-server
  proof. It's gitignored (`.env*`) and not part of the commit; left in place in case the
  worktree is reused for further verification.
- Left the temporary manual-render-check test file's output PNGs in the scratchpad directory
  (not the repo) for inspection; they are not part of the commit.
