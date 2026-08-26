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
