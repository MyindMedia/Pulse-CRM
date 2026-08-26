# Task 4: Post attribution in the booking funnel

## What was implemented

Threaded a `?src=<postId>` query parameter from the public booking page through to
`bookingVisits.postId`, so a later attribution query (Task 8) can join a booking back
to the social post that drove it.

`convex/bookingFunnel.ts`:
- `track`: added `src: v.optional(v.string())` to args. Inside the handler, after
  `orgId` is resolved from the slug, `src` is resolved to a `postId` only when
  `ctx.db.normalizeId("socialPosts", args.src)` succeeds AND the resolved post's
  `orgId` matches the org derived from the slug. Anything else (garbage string,
  foreign org's post id) is silently ignored, matching the same pattern already used
  for `?ref=` artist resolution in `convex/booking.ts`. `postId` is included on the
  `bookingVisits` insert.
- `recordBooked`: `extra` type widened to `{ ref?: string; code?: string; postId?:
  Id<"socialPosts"> }`; `postId: extra.postId` written on the "booked" row.

`convex/booking.ts` `createBooking`:
- Added `src: v.optional(v.string())` to args, as its own independent arg (does not
  depend on `roomId`/`serviceId` resolution).
- Resolved it the same way as `track`: `normalizeId` + same-org check against the
  `orgId` already established from the room (the same `orgId` the `ref` resolution
  right above it uses), placed next to the existing `ref` -> `referredByArtistId`
  resolution block for consistency.
- Passed `postId` through to `recordBooked(ctx, orgId, args.visitorKey, sessionId,
  rateCents, { ref: args.ref, code: discount?.code, postId })`.

`src/lib/use-booking-funnel.ts`:
- Added `src: params.get("src") ?? undefined,` to the `track()` call inside
  `useTrackBookingStep`. Since this one hook backs every funnel step (page, room,
  checkout) across every page that mounts it, this single change threads `src`
  through all three steps, not just "page".

`src/app/book/[slug]/[roomId]/page.tsx`:
- Added `const srcFromLink = searchParams.get("src") ?? undefined;` next to
  `refFromLink`.
- Passed `src: srcFromLink` into the `createBooking` call.

## Deviation from the brief (forced by the repo)

The brief's Step 1 test uses 2-character `visitorKey` values (`"v1"`, `"v2"`, `"v3"`).
`convex/bookingFunnel.ts`'s pre-existing `cleanKey()` (not part of this task, already
on the branch) requires the cleaned key to be at least 8 characters or the mutation
returns `{ ok: false }` and writes no row:

```ts
function cleanKey(raw: string): string | null {
  const k = raw.trim().slice(0, 64).replace(/[^A-Za-z0-9_-]/g, "");
  return k.length >= 8 ? k : null;
}
```

Run verbatim, the brief's test failed after implementation (not before) with the v1
row missing entirely, because `"v1"` never passed `cleanKey` and no `bookingVisits`
row was ever inserted for it, so `rows.find((r) => r.visitorKey === "v1")` was
`undefined`. I renamed the three visitor keys to `"visitor-v1"`, `"visitor-v2"`,
`"visitor-v3"` (10 chars, passes `cleanKey` unchanged, keeps the three cases
distinguishable). No other line of the test or the implementation changed. This is a
test-fixture-only fix; the security rule the test is meant to prove (garbage/foreign
`src` silently ignored, valid same-org `src` honored) is unaffected and still holds.

Everything else (schema fields already present from Task 1, `track` args, `recordBooked`
signature, `createBooking` args and resolution, the two frontend files) matches the
brief verbatim.

## Tests and results

### TDD evidence

RED (`src` not yet a valid arg on `track`):

```
$ npx vitest run convex/bookingFunnel.test.ts
```

```
FAIL  convex/bookingFunnel.test.ts > visit tracking > records the post id from ?src=
on a page visit and ignores foreign or garbage ids
Error: Validator error: Unexpected field `src` in object
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
```

GREEN (after implementing `track`, `recordBooked`, and fixing the visitor key length,
see deviation above):

```
$ npx vitest run convex/bookingFunnel.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### Targeted suite (brief's Step 4 + the other three files named in my task)

```
$ npx vitest run convex/bookingFunnel.test.ts convex/bookingConversion.test.ts convex/promos.test.ts convex/discountCodes.test.ts
 Test Files  4 passed (4)
      Tests  41 passed (41)
```

### Full suite

```
$ npm test
> vitest run
 Test Files  149 passed (149)
      Tests  1284 passed (1284)
```

(1284, up from 1283 before this task: the 1 new test.)

```
$ npm run typecheck
> tsc --noEmit
(clean, no output)
```

No changes were needed to `convex/_generated/api.d.ts`: this task added no new Convex
module, only new args/fields on existing `bookingFunnel.track` and `booking.createBooking`.

Node: ran under `/opt/homebrew/opt/node@22/bin` (node 22), matching the branch's
established Convex-codegen gotcha with node 25.

## Files changed

- `convex/bookingFunnel.ts`: `track` accepts `src`, resolves it to `postId` with the
  same-org check, writes `postId` on the visit row; `recordBooked` accepts and writes
  `postId`.
- `convex/bookingFunnel.test.ts`: added the brief's test (visitor keys lengthened per
  the deviation above).
- `convex/booking.ts`: `createBooking` accepts `src`, resolves it the same way, passes
  `postId` to `recordBooked`.
- `src/lib/use-booking-funnel.ts`: reads `src` from `window.location.search` and sends
  it with every funnel step.
- `src/app/book/[slug]/[roomId]/page.tsx`: reads `src` from the URL, passes it to
  `createBooking`.

## Self-review

- Re-read the full diff (`git show 3c19ec5`) line by line; the only file with a
  substantive line beyond the brief's exact code is `bookingFunnel.test.ts`, and that
  change is the three renamed visitor keys documented above.
- Confirmed the security rule end to end in both resolution sites (`track` and
  `createBooking`): `normalizeId` never throws on a malformed id string (it returns
  `null`), and the `post.orgId === orgId` check runs before `postId` is ever set, so a
  well-formed id belonging to a different org's post is rejected the same way a
  garbage string is, both silently.
- Confirmed `orgId` in `createBooking` is the same variable the `ref` resolution
  block already uses (`const orgId = room.orgId;`, set right after the room lookup),
  so `src` resolution does not duplicate or diverge from how the org is derived
  elsewhere in the same handler, and does not depend on `svc`/`roomId`'s two-path
  logic as the task brief warned to watch for.
- Confirmed `bookingVisits.postId` and `socialPosts` were already in
  `convex/schema.ts` from Task 1 (line 2230 and 2458 respectively); no schema change
  was needed or made in this task.
- Grepped the touched files for em dashes: none.
- Ran `npx eslint convex/bookingFunnel.ts convex/bookingFunnel.test.ts convex/booking.ts src/lib/use-booking-funnel.ts "src/app/book/[slug]/[roomId]/page.tsx"`: 0 errors, 2 warnings
  (`Id` unused in `bookingFunnel.test.ts`, `STEPS` type-only use in `bookingFunnel.ts`).
  Confirmed both pre-existed before this task by linting the pre-task commit
  (`d81b15d`) of `bookingFunnel.test.ts`: same warning, same line. Neither file I
  touched introduced a new lint warning.
- Confirmed `git status --porcelain` shows exactly the 5 files listed above staged
  and committed, nothing else touched, and `convex/_generated/api.d.ts` was not
  modified (correct, since no new module was added).

## Concerns

None. The one deviation (visitor key length) is a pre-existing, unrelated constraint
in `cleanKey()` that the brief's literal test values did not satisfy; the fix is
test-fixture-only and does not change any production code path or the security
invariant under test.

## Fix round 1: test coverage for createBooking's own src to postId resolution

### The finding

Review found that `bookingFunnel.test.ts` only exercised the `src` to `postId`
resolution inside `bookingFunnel.track`. The independent copy of that same
resolution inside `booking.ts` `createBooking` (lines 776-781) had no test of its
own: the foreign-org and garbage-id rejection paths on the booking mutation were
unverified, only asserted for the sibling `track` mutation.

### What changed

Extended `convex/bookingConversion.test.ts`, which already had the exact test
shape for the sibling `ref` argument (valid same-org / foreign / garbage cases
against `createBooking`). Added:

- `orgPost` and `foreignPost`: an org1 and an org2 `socialPosts` row, inserted in
  the existing `beforeEach` alongside `referrer`/`foreignReferrer`, using the same
  minimal-row shape (`template`, `status`, `caption`, `media: []`, `accountIds:
  []`, `scheduledFor`, `timezone`, `ghlType`, `submittedBy`, `createdAt`,
  `updatedAt`) already established in `bookingFunnel.test.ts`.
- Three new tests calling `api.booking.createBooking` directly with a
  `visitorKey` (required for `recordBooked` to write a row at all; anything
  shorter than 8 characters after `cleanKey()` writes nothing) and a `src`:
  1. A valid same-org `orgPost` id resolves to `postId` on the `booked`
     `bookingVisits` row.
  2. A `foreignPost` id (real row, different org) is silently ignored: `postId`
     is `undefined` on the booked row, and the booking still returns a
     `sessionId`.
  3. A garbage string (`"not-a-real-id"`) is silently ignored the same way.

Each test reads back with `t.run((ctx) => ctx.db.query("bookingVisits").collect())`
and finds the row where `step === "booked"` (no `.withIndex()` inside `t.run()`,
per the same convex-test typing gap noted for the `by_org`/`by_org_visitor`
indexes elsewhere on this branch). Since each test runs against a freshly
`initT()`-created `t` from the block's `beforeEach` and only ever calls
`createBooking` once, exactly one `bookingVisits` row exists per test and its
`step` is always `"booked"`.

### Verifying the tests actually test something

Before trusting the three new cases, temporarily broke the org check in
`convex/booking.ts` (`if (post && post.orgId === orgId) postId = srcId;` to
`if (post) postId = srcId;`) and reran. The cross-org case failed exactly as
expected:

```
FAIL  convex/bookingConversion.test.ts > booking conversion + referral > a cross-org src is silently ignored (postId undefined, booking still succeeds)
AssertionError: expected '000000000000000010006socialPosts' to be undefined
```

Reverted the sabotage (`git diff convex/booking.ts` clean afterward) and reran;
all green. This confirms the new tests exercise the real guard rather than
passing vacuously.

Against the unmodified implementation on the branch, all three new cases passed
on the first run: `createBooking`'s `src` resolution already matched the brief
and the sibling `track` behavior. No production code changed in this fix round.

### Commands run and output

```
$ npx vitest run convex/bookingConversion.test.ts convex/bookingFunnel.test.ts convex/promos.test.ts
 Test Files  3 passed (3)
      Tests  34 passed (34)
```

```
$ npm run typecheck
> tsc --noEmit
(clean, no output)
```

```
$ npm test
> vitest run
 Test Files  149 passed (149)
      Tests  1287 passed (1287)
```

(1287, up from 1284 before this fix: the 3 new tests.)

Node: ran under `/opt/homebrew/opt/node@22/bin` (node 22), same as the original
task-4 work, matching the branch's established Convex-codegen gotcha with node 25.

### Files changed

- `convex/bookingConversion.test.ts`: added `orgPost`/`foreignPost` fixtures to
  the `beforeEach` and three tests covering `createBooking`'s own `src` to
  `postId` resolution (valid same-org, cross-org, garbage).

### Concerns

None. The finding was a genuine test-coverage gap, not a production bug: the
existing `createBooking` implementation already enforced the same-org check
correctly, and the new tests now prove it directly instead of only by analogy
to `bookingFunnel.track`'s coverage.
