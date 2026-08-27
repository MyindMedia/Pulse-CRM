# Studio Marketing: final fix wave

Base: `3b76da5` (Artists: OK-to-feature consent for client-win posts) on `feat/studio-marketing`.
Scope: C1, C2, I2, I4 from the whole-branch review. Nothing else touched.

Gates: `npm test` 164 files / 1383 tests passing, `npm run typecheck` clean,
`npm run lint` 0 errors (86 warnings, all pre-existing and none in a file this
wave touched).

---

## C1 (Critical): tracked link with no room lost `src` and `code` at the first click

### What was wrong

`buildTrackedLink` omits the room segment when a post has no `roomId`, so the
default composer post (no room, `includeBookingLink` true) publishes
`https://<host>/book/<slug>?src=<postId>&code=SAVE20`. That lands on the studio
front page, one level above the page that reads those params. Every link off
that page threaded `ref` and only `ref`, so both died at the first click: the
visitor booked at full price against an advertised discount, and `recordBooked`
wrote a `booked` row with no `postId` and no `code`, so Results reported 0
bookings and $0 for the post that actually drove the booking.

### What changed

New pure helper `src/lib/tracking-links.ts`:

- `TRACKING_PARAM_KEYS = ["ref", "src", "code", "utm_source"]` - one list, in
  one place. These are exactly the four params `useTrackBookingStep` already
  reads off the live URL and that `createBooking` resolves server-side. I chose
  a named set over "copy every query param" so page-local junk cannot ride
  along, and over special-casing `src` and `code` so the next link added to the
  booking flow cannot silently drop half of them again.
- `readTrackingParams(search)` - pulls them off a query string or a
  `URLSearchParams`, dropping blanks so an empty `?ref=` never becomes a stray
  `?ref=` on the next link.
- `withTracking(path, params)` - appends whatever is set. A query already on
  the path is preserved and wins, since an explicit link beats an inherited
  tag.

Wired through:

- `src/app/book/[slug]/page.tsx` reads the params once (memoised on
  `searchParams`) and passes a `tracking` bag down.
- `src/components/book/room-card.tsx` and
  `src/components/book/service-card.tsx` swapped their `refId?: string` prop
  for `tracking?: TrackingParams` and build their href with `withTracking`.
  **ServiceCard had the identical defect** and is fixed the same way.
- `src/app/book/[slug]/s/[serviceId]/page.tsx` now reads `?src=` and passes it
  to `createBooking`. It previously read only `ref`, so a services-first studio
  lost post attribution even when the param survived the hop.

### What else I checked on that page

- `MembershipPlans` navigates to a Stripe Checkout URL, not deeper into the
  booking flow. Nothing to thread; left alone.
- The `#rooms` anchor is same-page.
- The room detail page already reads all three params correctly (task 4 did
  that part right); no change needed there.

### Deliberately not changed, and worth knowing

1. **Back-links are still bare.** The room page's "Back to studio" and the
   service page's back link both point at `/book/<slug>` with no params, so a
   visitor who navigates back and then picks a different room loses
   attribution. It is the same defect class but not on the landing page, and
   fixing it means plumbing `tracking` into two more pages for a path the
   review did not describe. One-line fix with the helper already in place if
   you want it.
2. **The service page has no promo UI at all**, so `?code=` is carried in the
   URL but never applied to a service booking. I did not auto-apply it:
   `createBooking` treats an invalid or expired code as a hard error, and with
   no promo box on that page a visitor arriving with a stale code would hit an
   unclearable failure. A services-first studio therefore still books at full
   price on a promo link. Pre-existing gap (services never had promo support),
   not a seam defect, and out of scope for this wave.

### Tests

`src/lib/tracking-links.test.ts` (7 assertions) covers the helper: all four
params read, blanks and unrelated params ignored, `URLSearchParams` accepted,
the front-to-room hop, bare path when nothing is tracked, percent-encoding, and
a path-owned param winning over a carried one.

`convex/marketing/attribution.test.ts` is the round trip the branch was
missing, and it is the important one. It reaches across `convex/` into
`src/lib` on purpose, because the seam is the thing under test.

- **"carries src and code from a room-less post link through the front page
  into the booking"** walks the whole path: `buildTrackedLink` with no room,
  assert the `/book/<slug>?src=&code=` shape, parse the landed URL with
  `readTrackingParams`, build the room href with `withTracking`, fire the
  funnel `page` step, then call the real `createBooking` with what the room
  page would have in hand. It then asserts the discount was actually applied
  (`listValueCents: 40_000`, `rateCents: 32_000` - a dropped code is a silent
  full-price charge), that `results.perPost` reports
  `clicks: 1, bookings: 1, revenueCents: 32_000, redemptions: 1` against that
  post, and that the promo's redemption counter moved.
- **"reports nothing when the front page drops the params"** pins the defect
  itself: the old bare room href produces a full-price booking and a post with
  `bookings: 0, revenueCents: 0`. Its real job is proving the first test is not
  passing vacuously - the readback genuinely depends on the params surviving.
- **"carries the same params onto a services-first studio's link"** covers the
  ServiceCard hop.

No component-render test, per the brief; the repo has none anywhere in `src/`
and the extracted helper made one unnecessary.

---

## C2 (Critical): second source of truth for the public app host

### What changed

`convex/marketing/posts.ts` replaces the module-level constant

```
export const APP_HOST = process.env.PULSE_PUBLIC_HOST ?? "https://pulse.myindsound.com";
```

with a function that chains through the existing convention:

```ts
export function appHost(): string {
  const override = process.env.PULSE_PUBLIC_HOST?.trim();
  const base = override || appUrl().trim() || "http://localhost:3000";
  return base.replace(/\/+$/, "");
}
```

Both call sites (`linkFor` for the tracked link, and the brand-card URL GHL
fetches) now call `appHost()`. A function rather than a constant so the env is
read at call time, which also makes it stubbable in tests.

`PULSE_PUBLIC_HOST` survives as an **optional override**, not a required deploy
step. Unset - the normal case - the value is exactly what `appUrl()` returns,
so it cannot silently disagree with the ~20 other modules that build public
links from `APP_URL`.

### The fallback choice, and why

The chain is `PULSE_PUBLIC_HOST` -> `APP_URL` -> `http://localhost:3000`.

I kept `appUrl()`'s own localhost fallback rather than substituting a
production domain:

1. **It is the point of the fix.** Overriding `appUrl()`'s fallback with a
   domain literal would reintroduce exactly the disagreement C2 is about. The
   dominant convention in this repo is `APP_URL ?? "http://localhost:3000"`
   (about twenty call sites); three outliers say `https://studiopulse.tech`
   and one in `booking.ts` says `https://pulse.myindsound.com`. Adding a fifth
   opinion is what created the finding.
2. **A wrong-but-plausible domain fails silently.** That is the C2 failure
   mode: a dead booking link in every published post and GHL fetching an HTML
   404 in place of the card image, with nothing to notice until a client
   complains, and no way to retract a published post. `http://localhost:3000`
   is unmistakable the first time anyone previews a caption.
3. **A correctly configured deployment can never reach it.** Production Convex
   already has `APP_URL` set, so the fallback only fires in dev or on a
   misconfigured deploy, and in the second case the loudest possible signal is
   what you want.
4. Hardcoding one studio's production domain into a Convex module also bakes a
   single-tenant assumption into a multi-tenant SaaS.

I considered throwing when neither variable is set, and rejected it: this code
path runs inside post creation and a cron, and a hard failure there trades a
visible bad link for an invisible dead feature.

### A related bug found while doing it

`appUrl()` guards with `??`, which catches an unset `APP_URL` but **not** one
set to an empty string. `APP_URL=""` makes `appUrl()` return `""`, which in
this module would publish a **relative** link to the open internet. `appHost()`
now treats blank as unset. I guarded it here rather than in
`convex/lib/links.ts` so the fix does not change behaviour for the other
callers, but the same latent bug exists for every one of them: a blank
`APP_URL` would put relative URLs into invoice emails, magic links and SMS.
**Flagged, not fixed - it is outside this wave's scope.**

### Env documentation: the premise was wrong, so it went somewhere else

The review asked me to add the variables to `.env.example`, "matching the
file's existing style". **That file does not exist in this repo**, and cannot:
`.gitignore` line 27 ignores `.env*`, so nothing named that is tracked.

More importantly, all four of these are read by `process.env` **inside Convex
functions**, so they live on the Convex deployment and are set with
`npx convex env set ... --prod`. A `.env.example` at the Next.js root would
have taught the operator the wrong mechanism.

I documented them in **`GO-LIVE.md`**, which is this repo's actual per-
integration env checklist (it already opens with the `npx convex env set`
incantation and documents Stripe, Resend, Google, SMS and AI the same way). New
section **"6. Studio Marketing - social posting via GHL (currently
simulated)"** covers `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_SOCIAL_USER_ID`
(all three required together, absence of any one meaning simulated mode) and
`PULSE_PUBLIC_HOST` (optional, follows `APP_URL`, with the consequence of
setting it wrong spelled out). The old section 6 became section 7.

If you would rather have a tracked `.env.example` as well, it needs a
`!.env.example` negation in `.gitignore`; say the word and it is a two-line
change.

---

## I2 (Important): `scheduledDue` scanned the whole `socialPosts` table every 30 minutes

### What changed

New index in `convex/schema.ts`:

```ts
.index("by_status_scheduled", ["status", "scheduledFor"])
```

Status-first on purpose. The cron runs across **every** org, and both existing
candidate indexes (`by_org_status`, `by_org_scheduled`) are org-prefixed, so
neither can serve "what is due everywhere" without iterating orgs. The review
suggested `by_org_scheduled`; it does not fit this access pattern, which is why
the original code fell back to an unbounded scan.

`scheduledDue` now reads:

```ts
.withIndex("by_status_scheduled", (q) => q.eq("status", "scheduled").lte("scheduledFor", Date.now()))
```

**The selected set is identical to before** - the old code collected everything
and filtered `status === "scheduled" && scheduledFor <= Date.now()` in JS. Only
the rows *read* to find it changed: from every row in every org (drafts,
published, cancelled, failed, none ever deleted) to just the overdue scheduled
ones. The `isDue` filter is kept as belt and braces, and the simulated-mode
branch in `syncStatusAll` is untouched.

I considered adding a `.take(n)` cap so a pathological backlog would drain over
successive runs rather than throw, and left it out to honour "preserve the
existing behaviour exactly". Worth knowing: a post that gets stuck in
`scheduled` because GHL never reports on it is now a permanent member of the
read set. That is bounded by total GHL failure, not by normal volume, but there
is no reaper for it.

### Tests

`convex/marketing/scheduledDue.test.ts`, 4 tests where there were zero:

1. **Due-window selection** - seeds due-real, due-simulated, due-with-no-
   `ghlPostId`, future-scheduled, draft, published, cancelled, failed, plus a
   second org's due post. Asserts both orgs come back grouped separately (one
   GHL call per org, never one org's `ghlPostId` in another org's request),
   that the simulated post lands in its own bucket, and that all six others are
   excluded.
2. **Future post selects nothing** - both buckets empty.
3. **Simulated branch publishes** - runs the real `syncStatusAll` with no GHL
   env and asserts the due simulated post becomes `published` at its
   `scheduledFor`, while the future one and the due-but-unconfirmed real one
   stay `scheduled`.
4. **One due post behind 300 terminal-state rows** - the shape of the growth
   the finding is about.

Honest note: these are characterisation tests. The old unbounded query selected
the same set, so they would pass against it too; `convex-test` cannot simulate
the 16,384-document read limit. Their value is pinning that the bounded query
did not quietly change *what* is selected, which is the failure mode a
narrowing refactor actually risks.

---

## I4 (Important, security): GHL popup message listener ignored `event.origin`

### What changed

`src/components/social/ghl-message.ts` gains `isGhlOrigin(origin)` and
`isOwnGhlCloseMessage` now takes the origin as its **first required
argument**.

Making it a required parameter rather than a separate call was deliberate: a
second predicate the component has to remember to call is a check that
eventually gets dropped. This way the security check cannot be skipped without
a type error, and the one call site in `connect-button.tsx` had to be updated.

`isGhlOrigin` parses the origin with `new URL`, requires `https:`, and matches
the hostname as *the apex itself or a subdomain of it*:

```ts
host === domain || host.endsWith(`.${domain}`)
```

The leading dot is what defeats the suffix trick. `evil-gohighlevel.com` does
not end with `.gohighlevel.com`, and `gohighlevel.com.evil.tld` neither equals
an apex nor ends with one. Anything unparseable - including the literal
`"null"` a sandboxed frame reports - is rejected.

Allowed apexes: `gohighlevel.com`, `leadconnectorhq.com`, `msgsndr.com`. All
three are GoHighLevel-owned (app, API/callback host, white-label domain). I
allowed all three rather than the narrowest possible list because this ships to
a real studio next: too strict and a legitimate redirect leaves the connect
button spinning forever with no error. **This is the one judgement call in the
wave I would most like a second opinion on** - see concerns below.

### Tests

`src/components/social/ghl-message.test.ts` grew from 7 to 14:

- `isGhlOrigin` accepts six real GHL origins (both apexes bare and three
  subdomains, plus `link.msgsndr.com`).
- Rejects lookalikes ending in the same letters: `evil-gohighlevel.com`,
  `notgohighlevel.com`, `xleadconnectorhq.com`.
- Rejects prefix tricks: `gohighlevel.com.evil.tld`,
  `leadconnectorhq.com.attacker.io`.
- Rejects an unrelated origin, plain `http://` on a real GHL host, and
  unparseable input (`"null"`, `""`, a bare hostname with no scheme).
- `isOwnGhlCloseMessage` gains **"rejects a perfectly-shaped message from the
  wrong origin"**, which is the attack itself: a payload that passes every
  shape check, from `evil.example.com`, `evil-gohighlevel.com` and
  `gohighlevel.com.evil.tld`.
- The seven existing shape tests were updated to pass a good origin, so their
  coverage is unchanged.

---

## Files changed

Modified:

- `convex/marketing/posts.ts` (C2, I2)
- `convex/marketing/posts.test.ts` (C2)
- `convex/schema.ts` (I2, new index)
- `src/app/book/[slug]/page.tsx` (C1)
- `src/app/book/[slug]/s/[serviceId]/page.tsx` (C1)
- `src/components/book/room-card.tsx` (C1)
- `src/components/book/service-card.tsx` (C1)
- `src/components/social/connect-button.tsx` (I4)
- `src/components/social/ghl-message.ts` (I4)
- `src/components/social/ghl-message.test.ts` (I4)
- `GO-LIVE.md` (C2, env documentation)

Added:

- `src/lib/tracking-links.ts` (C1)
- `src/lib/tracking-links.test.ts` (C1)
- `convex/marketing/attribution.test.ts` (C1, the round trip)
- `convex/marketing/scheduledDue.test.ts` (I2)

Deliberately untouched: I1 (calendar `perPost` bounds), I3 (`needs_reconnect`
and the reconnect UI), and every Minor. I did not refactor near them.

---

## Things that worried me

1. **The GHL origin allowlist is unverified against the live integration.**
   `startOAuth` returns a URL from GHL's API, so nothing in this repo pins
   which host actually sends the `postMessage`. I inferred the three apexes
   from the product rather than observing them. If the real sender is on a
   fourth GHL-owned domain, the connect flow will now silently do nothing
   instead of connecting. **Worth one manual connect against the live GHL
   location before merge**, watching the console for a message that gets
   rejected. That is a five-minute check and it is the only thing in this wave
   that could break a working path.

2. **Blank `APP_URL` returns `""` from `appUrl()` for twenty other callers.**
   Fixed locally in `appHost()`; the latent version still sits in
   `convex/lib/links.ts` and would put relative URLs into invoice emails,
   magic links and SMS. One-line fix (`||` instead of `??`), out of scope here.

3. **The new `by_status_scheduled` index needs a Convex deploy** before the
   cron will work. `npx convex deploy` builds and backfills it. If the frontend
   ships before the backend, `scheduledDue` will fail on an unknown index and
   status sync stops - the same symptom I2 describes, from the opposite cause.
   Deploy Convex first, which `DEPLOY.md` step 2 already says.

4. **Services-first studios still book at full price on a promo link** (C1
   note 2 above). The param now survives the hop; there is no UI to apply it.

5. **Back-links still drop attribution** (C1 note 1 above).

## Worktree note

The worktree came up on `main` (`3de7019`) rather than on
`feat/studio-marketing` at `3b76da5` - the same failure the brief warned about.
The working tree was clean (verified `git status --porcelain` empty first), so
I reset it to `3b76da5` and worked from there. `feat/studio-marketing` itself is
checked out in the main checkout, so this worktree commits on its own branch and
pushes to `origin feat/studio-marketing`; force-stealing the branch from the
other worktree would have left that checkout's working tree misreporting against
a moved HEAD. **The local `feat/studio-marketing` ref in the main checkout is
now behind origin** and needs `git merge --ff-only origin/feat/studio-marketing`
there.

`node_modules` is symlinked from the main checkout. I verified vitest executes
*this* worktree's files (appended a deliberate syntax-level failure to
`posts.test.ts`, confirmed the error reported this worktree's path and line, and
reverted) before trusting any green.
