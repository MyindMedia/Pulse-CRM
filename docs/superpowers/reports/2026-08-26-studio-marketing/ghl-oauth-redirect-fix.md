# GHL OAuth redirect fix: startOAuth crash on Connect Facebook Page

## Bug

Clicking "Connect Facebook Page" on production failed with:

```
[CONVEX A(marketing/accounts:startConnect)] Uncaught TypeError: Cannot read properties of null (reading 'url')
```

Root cause, confirmed against the live GHL API:

- `startOAuth` (`convex/lib/ghl.ts`) called the shared `ghlFetch` helper against
  `/social-media-posting/oauth/<platform>/start`.
- That endpoint is not a JSON endpoint. GHL answers with HTTP 302 and the
  OAuth URL in the `Location` header (verified live: redirects to
  `https://www.facebook.com/dialog/oauth?...`).
- `ghlFetch` uses `fetch()` with default redirect handling, so it followed
  the 302 to Facebook and received Facebook's HTML login page with status
  200.
- `res.ok` was therefore true. `JSON.parse` on the HTML body threw, the
  catch set `json = null`, and `ghlFetch` returned `{ ok: true, data: null }`.
- `startOAuth` then evaluated `r.data.url` on `null`, throwing the
  TypeError that reached production.

The existing test mocked `fetch` returning `{ url }` JSON, which GHL never
actually sends for this endpoint, so the regression was invisible to the
suite.

## Fix

`convex/lib/ghl.ts`:

- `startOAuth` no longer calls `ghlFetch`. It does its own `fetch()` with
  `redirect: "manual"`, keeping the same `Authorization`, `Version`, and
  `User-Agent` headers as every other call in the client.
- A 3xx response reads the `Location` header and returns `{ url: location }`.
  A 3xx with no `Location` header returns `null` instead of throwing.
- A 200 response is still parsed as JSON and falls back to `data.url` or
  `data.redirectUrl`, in case a platform other than Facebook answers this
  way instead of redirecting (only Facebook has been observed live).
- Any other non-2xx/non-3xx status, a network error, or a non-JSON 200
  body all resolve to `null` rather than throwing. `startConnect`'s
  existing `GHL_UNAVAILABLE` ConvexError check (`if (!r) throw ...`) was
  already correct and needed no change; it now actually gets a chance to
  run instead of the TypeError happening first.
- `ghlFetch` itself is unchanged. Every other endpoint in this file (list
  accounts, attach account, create/delete/list posts, account stats) is
  genuinely JSON and keeps working exactly as before.

## Tests

`convex/lib/ghl.test.ts`, `startOAuth` coverage rebuilt:

1. Existing "passes locationId and userId as query params" test updated to
   mock a 302 with a `Location` header (was a 200 JSON body, the wrong
   assumption) and asserts `redirect: "manual"` was passed to `fetch`.
2. New: a 302 with a realistic Facebook dialog URL (redirect_uri pointing
   back at `.../oauth/facebook/finish`) in `Location` returns that URL.
3. New: a 3xx with no `Location` header returns `null` without throwing.
4. New: a 200 with a JSON `{ url }` body still returns that url (fallback
   path).
5. New: a 200 with a non-JSON HTML body (what the old code actually hit in
   production after following the redirect) returns `null` instead of
   throwing a TypeError. This is the direct regression test for the bug.
6. New: a non-2xx, non-3xx error response (401) returns `null`.

## Verification

- `npm test`: 164 files, 1388 tests, all green (worktree-local run,
  confirmed executing this worktree's files via a focused
  `npx vitest run convex/lib/ghl.test.ts` first: 12/12 passed).
- `npm run typecheck`: clean, no errors.
- `npm run lint`: 0 errors, 86 pre-existing warnings, none in
  `convex/lib/ghl.ts` or `convex/lib/ghl.test.ts` (all in unrelated React
  components).
- No Convex codegen was run, per instructions (local Node is v25).

## Notes / residual risk

- Only Facebook's redirect behavior has been verified live. The JSON
  fallback path is speculative for other platforms (Instagram, LinkedIn,
  TikTok, etc.) and untested against the live API; if any of them return
  a 200 JSON body instead of a redirect, the fallback should already
  handle it, but this was not independently confirmed platform by
  platform.
- `startOAuth`'s own `fetch()` call does not go through `ghlFetch`, so it
  does not get `ghlFetch`'s generic error-message extraction on failure.
  That is intentional per the task (redirect responses have no JSON body
  to extract a message from), and `startConnect` already surfaces a fixed
  `GHL_UNAVAILABLE` message in the null case.
