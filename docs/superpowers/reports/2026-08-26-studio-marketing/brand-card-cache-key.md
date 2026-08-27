# Brand card CDN cache key: wrong image posted to real social accounts

## Bug, proven against production

The brand-card route (`/api/brand-card/[postId]`) took `kind` (`promo`,
`open_slot`, `rate_card`) and `v` (a cache-buster) as query parameters, and
set `Cache-Control: public, max-age=31536000, immutable`.

Netlify's CDN keys its cache on path and drops the query string. Proven:

- A fresh post id fetched with `?kind=open_slot` first returned a 69,924
  byte PNG. `?kind=promo` on the same path, immediately after, returned the
  same 69,924 bytes byte-for-byte.
- A different post id returned a different size (81,953 bytes), so the
  route's own per-post rendering was correct - the cache key was the bug.
- Distinct `v` values and `Cache-Control: no-cache` request headers made no
  difference. Every variant hit the same cached object (`age` header
  matched across requests).

Two consequences, both live in production:

1. Whichever kind was fetched first for a post won forever. A Rate Promo
   post whose Open Slot card happened to be fetched first by GHL published
   the wrong card to a real Facebook page.
2. The `v` cache-buster did nothing. Editing a post never refreshed its
   card - a corrected promo code or a changed rate kept posting the old
   image.

## Fix

Moved every input that changes the rendered PNG out of the query string
and into the path, so the CDN's own cache key distinguishes them.

**New URL shape:** `/api/brand-card/<postId>/<kind>/<version>`, where
`version` is the post's `updatedAt` timestamp. Example:
`/api/brand-card/k17abc.../promo/1756172400000`.

Why this shape:

- `postId` first, matching the original route's segment order - no reason
  to reshuffle what callers already keyed on.
- `kind` and `version` as their own segments (not a combined slug) keeps
  each one independently greppable in logs and keeps the route's
  `params` destructure trivial (`{ postId, kind, version }` vs. parsing a
  composite string).
- `version` = `updatedAt` because it is already the single timestamp that
  changes exactly when the post's content changes - no new field needed on
  `socialPosts`, and it can never drift from "did this post change."
- The long `Cache-Control: immutable` header is unchanged and is correct
  now: once postId/kind/version are all in the path, two requests for the
  same path are guaranteed to want the same bytes, so an immutable,
  never-revalidated cache is exactly right. This is also what keeps the
  card cheap for GHL to fetch repeatedly.

The route's internal logic did not change: an unrecognized `kind` string
still falls through the existing ternary chain to the promo-shaped default
headline ("Book now" / code-if-present), a post that no longer exists (or
whose Convex query throws) still 404s, a foreign-org room or promo is still
nulled out by `brandCard.data`'s own org-ownership check (untouched), and a
font or logo fetch failure still degrades to the default font / no logo
instead of throwing. None of that logic lives in the URL shape, so none of
it needed to change.

## Producers updated

Grepped the whole repo for `brand-card` (all extensions, `node_modules`
excluded) to confirm there were exactly three places that build or consume
this URL, plus the route itself:

1. **`src/app/api/brand-card/[postId]/route.tsx` -> `src/app/api/brand-card/[postId]/[kind]/[version]/route.tsx`**
   (`git mv`, so history follows). `GET`'s signature changed from reading
   `kind` off `new URL(req.url).searchParams` to destructuring
   `{ postId, kind }` from the now three-segment `params`. `version` is
   destructured out of the type but not read - it exists only so the route
   matches, since Convex is queried fresh for the post's live content on
   every request regardless of what version string got you here.

2. **`convex/marketing/posts.ts`, `payloadContext`** - the query that
   builds the media URL sent to GHL. Was:
   `` `${appHost()}/api/brand-card/${post._id}?kind=${m.brandCard}&v=${post.updatedAt}` ``.
   Now calls the shared builder:
   `` `${appHost()}${brandCardPath(post._id, m.brandCard, post.updatedAt)}` ``.

3. **`src/components/social/media-picker.tsx`** - the composer's live
   preview `<img>`. Was `` `/api/brand-card/${postId}?kind=${kind}` `` with
   no version at all, so the preview was frozen at whatever the first
   render happened to be - editing the draft and saving never changed the
   `<img src>`, so neither the browser cache nor (in production) the CDN
   ever saw a new URL to fetch. Added an `updatedAt?: number` prop to both
   `MediaPicker` and `BrandCardToggle`, threaded from `Composer`'s
   `existingPost?.updatedAt` (a live Convex `useQuery`, so it updates
   automatically the moment `update()` bumps the post's `updatedAt` - no
   manual refetch needed). The preview now calls
   `brandCardPath(postId, kind, updatedAt ?? 0)`. The `?? 0` fallback only
   matters for the one-render gap between creating a brand-new draft and
   the router-driven reload that hands the component a real `updatedAt`;
   since that path has never been cached before, the fallback cannot
   collide with a stale image.

**Shared module:** `convex/lib/brandCardUrl.ts` exports `brandCardPath()`
and the `BrandCardKind` type. Both `convex/marketing/posts.ts` (relative
import) and `src/components/social/media-picker.tsx`
(`@convex/lib/brandCardUrl`, the same cross-boundary import pattern already
used by `@convex/lib/plans`, `@convex/lib/entitlements`, etc.) import the
same function, so the two producers cannot disagree about the URL shape
again. This is a plain TypeScript module with no Convex server import, so
it needed no codegen.

No other producer exists. Grepped for `brand-card`, `kind=`, and
`payloadContext` across `src/` and `convex/` (excluding `node_modules`) -
the only two additional query-param builders were the ones above; every
other `kind=` hit was an unrelated `kind` prop (a `<track kind="captions">`,
a Stripe webhook test literal, icon-kind props) or the `payloadContext`
Convex generated types themselves.

## Middleware verification

`src/middleware.ts`'s public-route matcher is `"/api/brand-card/(.*)"`,
built through Clerk's `createRouteMatcher` -> `@clerk/shared/pathMatcher`'s
`createPathMatcher`, which compiles the string with the vendored
`pathToRegexp`. Verified directly rather than by inspection: loaded the
actual compiled matcher in a Node REPL against the installed
`@clerk/shared` package.

```
pathToRegexp("/api/brand-card/(.*)")
  => /^\/api\/brand-card(?:\/(.*))[\/#\?]?$/i

"/api/brand-card/post123"                          => true
"/api/brand-card/post123/promo/1756172400000"      => true
"/api/brand-card/post123?kind=promo"               => true
```

`(.*)` in the compiled regex matches across `/` (JS `.` excludes only line
terminators, not slashes), so the existing single matcher continues to
cover the new three-segment path without modification. Added a comment at
the matcher explaining this so a future reader does not have to re-derive
it. No change to `config.matcher` at the bottom of the file was needed
either - it already forwards every `/api/*` request into the middleware,
Clerk-enabled or not.

## Tests

New `convex/lib/brandCardUrl.test.ts` (5 cases, pure logic, no
`convex-test` needed since `brandCardPath` touches no database):

- same post/kind/`updatedAt` -> identical URL twice
- `updatedAt` changed -> different URL
- the three kinds for one post/version -> three distinct paths (asserted
  via `Set` size)
- exact shape check: `brandCardPath("post1", "promo", 1000)` ->
  `"/api/brand-card/post1/promo/1000"`
- two different post ids, same kind/version -> distinct paths

Ran `npm test` (full suite: 166 files, 1398 tests, all passing, including
the pre-existing `convex/marketing/brandCard.test.ts`, which covers only
the `brandCard.data` query and needed no changes since its return shape is
untouched), `npm run typecheck` (clean), and `npm run lint` (0 errors, 86
pre-existing warnings in unrelated files, same count before and after this
change - confirmed by grepping the lint output for the touched file paths
and finding only the pre-existing `<img>`/`alt` warnings that were already
attached to that exact JSX before the move).

## Verifying the worktree actually ran these files

Symlinked `node_modules` from the main checkout into this worktree, then
ran `npx vitest run convex/marketing/brandCard.test.ts` before making any
change and confirmed the `RUN` banner printed this worktree's own path
(not the main checkout's), so the focused run and the full suite both
executed the code in this worktree.
