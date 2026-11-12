# Eval: /demo keeps its query string

Status: fix-a-bug (verified-build §6). Branch `fix/demo-utm-passthrough`, base `develop`.
Risk: **High** by the standing list (a Netlify redirect, and middleware code that runs ahead of Clerk).
What a customer loses if it breaks: `/demo` stops reaching the demo form, or leads arrive with no source.

## The bug

`https://studiopulse.tech/demo?utm_source=…` answered 302 to the bare form address. Every UTM tag and
ad click id (`fbclid`, `gclid`) on an outreach email, ad or social link was dropped before the Zuops form.

## Root cause

`src/middleware.ts` answers `/demo` before Netlify's own redirect rule is reached, and it redirected to a
fixed string. Evidence, 2026-11-11, read-only requests against production:

- `curl -H "Cookie: __client=stale" "https://studiopulse.tech/demo?utm_source=test"` returns the two
  `set-cookie: __client=; … Max-Age=0` headers that only `expireStaleClientCookie` in the middleware writes.
  So the middleware, not `netlify.toml`, produced the 302.
- A plain Netlify rule to another host does keep the query string:
  `curl "https://studiopulse-staging.netlify.app/demo?utm_source=test&fbclid=abc"` returns
  `location: https://develop--studiopulse-staging.netlify.app/demo?utm_source=test&fbclid=abc`.
  Netlify's docs say the same: query parameters pass through on 200, 301 and 302 redirects.

So `netlify.toml` needed no behaviour change. It gets a comment and a test that pins the conditions the
pass-through depends on.

## Checks

| ID | Check | How | Result | Evidence |
|---|---|---|---|---|
| U-01 | `/demo?utm_source=x&fbclid=y` is a 302 to the form with the same parameters | `npx vitest run src/middleware.test.ts`, "carries UTM tags and click ids through to the form" | PASS | 10/10 pass; failed before the fix (5 of the new tests red) |
| U-02 | Bare `/demo` is unchanged: 302 to exactly the form address | same file, "leaves a bare /demo exactly as it was" | PASS | passed before and after the fix |
| U-03 | `/demo?` (empty query) behaves as bare | same file, "treats an empty query string as bare" | PASS | |
| U-04 | Encoded values, order and repeated parameters survive | same file, "keeps every parameter…" | PASS | compared as parsed parameters, see note 1 |
| U-05 | The stale `__client` cookie is still cleared on a tagged redirect | same file, "still clears the stale client cookie…" | PASS | |
| U-06 | Real server: the running app redirects with the query string | `npx next dev --webpack -p 3987`, then `curl -w "%{http_code} %{redirect_url}"` | PASS | `302 …-fbib`, `302 …-fbib?utm_source=x&fbclid=y`, `302 …-fbib?utm_source=instagram&utm_medium=social&utm_campaign=ig-tour&gclid=abc+def` |
| F-01 | The query string cannot change where the visitor lands (open redirect) | same file, "only ever redirects to the form, whatever the query says" | PASS | host and path are a constant; only the query is appended |
| F-02 | `netlify.toml` rule stays plain: same address, 302, no query string on `to`, no `query` condition | same file, "netlify.toml keeps a plain rule to the same form" | PASS | |
| R-01 | Look-alike paths (`/demos`, `/demo/extra`) are not redirected | same file, "does not redirect look-alike paths" | PASS | |
| R-02 | UI lab gate unchanged | same file, "UI lab gate" | PASS | |
| R-03 | Lint and types | `npx eslint src/middleware.ts src/middleware.test.ts`, `npx tsc --noEmit` | PASS | both exit 0 |
| R-04 | Full suite has no new failures | `npx vitest run` | PASS | 3462 pass, 3 fail; the same 3 fail on an untouched `origin/develop` (f1053f0), see note 2 |
| S-01 | Security review of the diff (open redirect, header injection, data sent to the form host, auth gate, test strength) | fresh-context security reviewer, read-only, against commit 0a04256 | PASS | no Critical, High or Medium findings; one Low and two Info, see note 5 |
| P-01 | Production: the live `/demo` forwards the query string | `curl -s -o /dev/null -w "%{redirect_url}" "https://studiopulse.tech/demo?utm_source=instagram&utm_medium=social&utm_campaign=ig-tour"` | PENDING | needs the staging deploy, then the `develop` → `main` promotion. Lawrence's call. |
| P-02 | A tagged link's source lands on the Zuops lead record | submit the form once from a tagged link | NOT RUN | a real booking fires live owner alerts and a confirmation call; not done here on purpose |

## Notes

1. The Next server may re-encode a value on the way in: `%20` reached the redirect as `+` in U-06. Both
   decode to a space, so the parameter the form reads is the same. The redirect is parameter-exact, not
   byte-exact.
2. Failing on `develop` before this change, untouched by it: `convex/lib/agentScope.test.ts` and
   `convex/marketing/results.test.ts` (both listed in `docs/ENVIRONMENTS.md`), plus
   `convex/outreachCalls.test.ts` "live: re-checks consent…" (expects `at 5:00 PM P`), which is not on that list.
3. Every parameter is forwarded, not an allow-list. That matches what Netlify's own rule does, and it keeps
   click ids nobody listed yet (`ttclid`, `msclkid`, …). No new vendor, script, pixel or form field: the
   form was already the destination.
4. `/demo` is not served from a hosted staging build yet; U-06 ran against a local dev server (webpack,
   because Turbopack refuses this worktree's shared `node_modules` symlink).
5. Security review findings left open for Lawrence, none blocking. Low: the forward is the whole query
   string, so a future link that put an email or a token on a `/demo` URL would send it to the form host.
   Nothing in the repo does that today (the in-repo `/demo` links carry no query). An allow-list
   (`utm_*`, `fbclid`, `gclid`, …) would close it at the cost of dropping click ids not on the list.
   Info: a query of several KB is forwarded as is and could exceed a header limit, failing only that
   visitor's own redirect. Info: Clerk is mocked in the test, so "runs ahead of Clerk" is covered only by
   the 302 assertions.
