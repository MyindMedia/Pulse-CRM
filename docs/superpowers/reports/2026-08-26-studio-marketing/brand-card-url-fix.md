# Brand card 404: Convex URL resolution mismatch

## Bug

Every Rate Promo and Open Slot post handed GoHighLevel an image URL that did
not resolve. Confirmed against production:

- `marketing/brandCard:data` returned a full, correct payload for a real
  post id.
- `GET https://pulse.myindsound.com/api/brand-card/<same id>?kind=promo`
  returned a bare `404 Not found`.

Root cause: `src/app/api/brand-card/[postId]/route.tsx` read
`process.env.NEXT_PUBLIC_CONVEX_URL` directly and 404'd if it was missing,
with no fallback. `NEXT_PUBLIC_CONVEX_URL` was never set on the production
Netlify site (confirmed by listing the site's env: only `CLERK_SECRET_KEY`,
`CONVEX_DEPLOY_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` existed).

`src/components/providers/convex-client-provider.tsx` carried its own
hardcoded fallback (`?? "https://pastel-corgi-340.convex.cloud"`), so the
browser client kept working while the server route silently died. The two
files disagreeing about how to resolve the same URL is what hid the bug:
a config problem looked identical to "the post doesn't exist."

## Fix

1. **One source of truth.** New `src/lib/convex-url.ts` exports
   `resolveConvexUrl()`: prefers `NEXT_PUBLIC_CONVEX_URL`, falls back to the
   production deployment URL when the var is absent **or blank**. A plain
   `??` only catches `null`/`undefined` and would let an empty string win -
   the same latent mistake `appUrl()` in `convex/lib/links.ts` makes. Guarded
   against on purpose with a length check on the trimmed value.

   Both `convex-client-provider.tsx` and the brand-card route now import
   this helper instead of each keeping (or, in the route's case, lacking) a
   copy of the fallback. They cannot disagree again.

2. **Misconfiguration is no longer disguised as a missing post.** The route
   still guards on `!convexUrl` (defense in depth - `resolveConvexUrl()`
   always resolves to something today, so this branch shouldn't fire in
   practice) but now returns `500` with the body
   `"Brand card misconfigured: Convex URL is not resolvable"` and logs
   `console.error("[brand-card] Convex URL could not be resolved; check
   NEXT_PUBLIC_CONVEX_URL")` instead of a bare 404. Nothing sensitive is
   logged or returned - there is no secret value here, only the fact that
   resolution failed.

3. **Untouched:** a genuinely missing post (Convex returns `null`, or the
   query throws) still 404s via the existing `try/catch` below the new
   guard. A foreign-org room or promo is still nulled out - that logic lives
   entirely in `convex/marketing/brandCard.ts` and was not touched. Font and
   logo fetch failures still degrade instead of throwing. Cache headers on
   the successful `ImageResponse` are unchanged.

## Files changed

- `src/lib/convex-url.ts` (new) - shared resolution helper.
- `src/lib/convex-url.test.ts` (new) - covers env-set, absent, empty-string,
  whitespace-only, and both-consumers-agree cases.
- `src/components/providers/convex-client-provider.tsx` - now imports and
  calls `resolveConvexUrl()` instead of inlining the fallback.
- `src/app/api/brand-card/[postId]/route.tsx` - now imports and calls
  `resolveConvexUrl()`; the missing-URL branch returns a distinguishable 500
  instead of a 404, with a server-side log line.

## Verification

- `npm test` - 165 files, 1393 tests, all green (worktree run, `node_modules`
  symlinked from the main checkout; `vitest.config.ts`'s `preserveSymlinks`
  keeps globs anchored to this worktree).
- `npm run typecheck` - clean.
- `npm run lint` - 0 errors, 86 pre-existing warnings unrelated to this
  change (line numbers in `route.tsx`'s existing `<img>` warnings shifted
  because of the added guard, but the warnings themselves predate this fix).

## Note

Netlify's `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CONVEX_SITE_URL` were
already set on production separately from this change - a rebuild alone
would have papered over the symptom without fixing the actual defect (two
places resolving the same value two different ways). This fix makes the
route incapable of falling out of sync with the client provider again,
independent of whether the env var happens to be set.
