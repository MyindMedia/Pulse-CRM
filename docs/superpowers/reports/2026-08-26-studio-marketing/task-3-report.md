# Task 3: Promos and checkout resolution

## What was implemented

Added `convex/promos.ts`, a new module for time-boxed promo codes, and rewired checkout
in `convex/booking.ts` so a matching Promo is resolved before falling back to a legacy
`orgs.discountCodes` entry.

`convex/promos.ts`:
- `normalizeCode(raw)`: trims, uppercases, strips whitespace.
- `resolveCode(ctx, org, raw, roomId, now)`: the shared resolver. Looks up an active
  Promo by `(orgId, code)` via the `by_org_code` index. If one exists it is checked
  against the time window (`startsAt <= now <= endsAt`), room scope (unscoped, or
  matching the room being booked), and redemption cap. A promo that exists but fails
  any of those checks returns `null` immediately, it never falls through to a legacy
  code of the same name. Only when no Promo row matches at all does the resolver fall
  back to `org.discountCodes`. Returns `{ code, pct, label, promoId?, expiresAt? }` or
  `null`.
- `create` / `update` / `deactivate`: owner-gated (`marketing.approve`) mutations with a
  1-90 percent bound and an `endsAt > startsAt` check. `create` rejects a duplicate
  active code for the org.
- `list`: `marketing.read`-gated, returns the org's promos newest first.
- `createInternal`: internal mutation for the AI/cron rate-cut path, refreshes an
  existing active promo of the same code rather than duplicating it.
- `recordRedemption(ctx, promoId)`: increments `redemptions` by 1.

`convex/booking.ts`:
- Deleted `findDiscount` (the old legacy-only resolver). Grepped the whole repo first;
  its only two callers were the two call sites rewired below, nothing else referenced it.
- `validateCode`: now calls `resolveCode(ctx, org, code, roomId, Date.now())` and only
  spreads `expiresAt` onto the response when the match carries one (a Promo match),
  never for a legacy code.
- `createBooking` handler: `discount` is now typed `Awaited<ReturnType<typeof resolveCode>>`
  and populated via `await resolveCode(ctx, org, args.discountCode, roomId, Date.now())`.
  After the session insert and the existing `recordBooked` call, added
  `if (discount?.promoId) await recordRedemption(ctx, discount.promoId);`.

## Deviation from the brief (forced by the repo)

The brief's prose instruction says to call `resolveCode(ctx, org, args.discountCode,
args.roomId, Date.now())` in the booking handler. I used the local `roomId` constant
instead of `args.roomId`. Reason: `createBooking` supports two paths, a direct
`args.roomId` and a `args.serviceId` path where the room is derived as
`const roomId = svc ? svc.roomId : args.roomId` earlier in the same handler (this
existed before this task and is used throughout the rest of the function, e.g. the
clash check and the session insert's `roomId` field). On the service path,
`args.roomId` is `undefined`, so passing it straight into `resolveCode` would make
`roomOk` trivially true for any room-scoped promo (`!roomId` short-circuits the check),
silently defeating room-scoping for every service booking. Using the already-resolved
local `roomId` gives the correct room in both paths and matches how the rest of the
function already treats it. This does not affect `validateCode`, whose own `roomId` is
a direct query argument with no service path, so it is used exactly as the brief
specifies there.

I also had to hand-patch `convex/_generated/api.d.ts` (added the `promos` import and
`fullApi` entry, alphabetically placed between `profitability` and `push`) because
`npx convex codegen` requires `CONVEX_DEPLOYMENT` and no local/cloud deployment is
configured in this worktree. `convex/_generated/api.js` did not need a change: it
exports the runtime `anyApi` proxy, which resolves any module path dynamically, and
`convex-test` already resolved `api.promos.*` correctly against the real file tree
before this patch (proven by the RED run below, which failed with "Could not find
module" only at runtime for the promos.ts file itself, not the api.d.ts type surface).
`convex/_generated/dataModel.d.ts` needed no change: it types `DataModel` generically
from `schema.js`, so the `promos` table (already defined in Task 1/2's schema work) was
already visible without regeneration.

## Tests and results

### TDD evidence

RED (`convex/promos.ts` did not exist yet):

```
$ npx vitest run convex/promos.test.ts
```

```
 FAIL  convex/promos.test.ts > promos > a promo scoped to one room does not validate on another
Error: Could not find module for: "promos"
 ❯ node_modules/convex-test/dist/index.js:1288:19
...
 Test Files  1 failed (1)
      Tests  4 failed | 2 passed (6)
```

(The other 2 tests in that file passed even at RED because they only exercise the
legacy `orgs.discountCodes` path through `booking.validateCode`, which did not yet
depend on `promos.ts`.)

GREEN (after implementing `convex/promos.ts` and rewiring `convex/booking.ts`):

```
$ npx vitest run convex/promos.test.ts convex/discountCodes.test.ts convex/bookingConversion.test.ts convex/bookingFunnel.test.ts
```

```
 Test Files  4 passed (4)
      Tests  36 passed (36)
```

### Full suite

```
$ npm run typecheck
> tsc --noEmit
(clean, no output)

$ npm test
> vitest run
 Test Files  149 passed (149)
      Tests  1279 passed (1279)
```

`convex/discountCodes.test.ts` "validates an active code and returns exactly that one
code" still passes with `toEqual` (exact shape) because `expiresAt` is only spread onto
`validateCode`'s response object when `match.expiresAt` is present, which only happens
for a Promo match, never a legacy-code match.

Node: ran everything with `/opt/homebrew/opt/node@22/bin` prepended to PATH (the
default `node` on this machine resolves to v25, which the existing memory notes flag as
breaking Convex codegen; `npm ci`, `vitest`, and `tsc` all ran fine under v22).

## Files changed

- `convex/promos.ts` (new): resolver, CRUD mutations, `list`, `createInternal`,
  `recordRedemption`.
- `convex/promos.test.ts` (new): the 6 tests from the brief, verbatim.
- `convex/booking.ts`: removed `findDiscount`; `validateCode` and `createBooking` now
  call `resolveCode`; redemption recorded after `recordBooked`.
- `convex/_generated/api.d.ts`: added the `promos` module entry (hand-patched, see
  deviation note above).

## Self-review

- Grepped for `findDiscount` repo-wide before and after deletion: only the two call
  sites in `booking.ts` existed; both are gone; zero references remain anywhere
  (`convex/`, `src/`).
- Checked the client (`src/components/book/promo-code.tsx`), the only caller of
  `api.booking.validateCode`: it reads `check.valid`, `check.code`, `check.pct`,
  `check.label` and ignores unknown fields, so adding the optional `expiresAt` field is
  fully backward compatible; no UI change was needed or made (out of this task's scope).
- Confirmed `promos` table fields in `convex/schema.ts` (lines ~2438-2454) match exactly
  what `promos.ts` reads and writes: `orgId, code, pct, label, startsAt, endsAt, roomId,
  maxRedemptions, redemptions, source, active, createdBy, createdAt`, plus the
  `by_org` and `by_org_code` indexes both functions rely on.
- Confirmed `currentOrgWithCapability` and `currentActor` in `convex/lib/tenant.ts`
  match the imported signatures used in `promos.ts`.
- Confirmed `marketing.approve` / `marketing.read` capabilities exist in
  `convex/lib/accessPolicies.ts` and that `engineer` does not carry `marketing.approve`
  (`convex/lib/accessPolicies.test.ts` line 151), matching the "engineer cannot create
  promos" test.
- Ran `npx eslint convex/promos.ts convex/promos.test.ts convex/booking.ts`: clean, no
  output.
- Grepped for em dashes in all three touched/added files: none.
- Full diff of the commit reviewed line by line (`git show 7c8e637`); no stray changes,
  no unrelated files touched.

## Concerns

- The `promos.ts` code is verbatim from the brief except for the one `roomId` vs
  `args.roomId` fix in `createBooking` documented above. I believe that fix is
  necessary and correct (it closes a room-scoping bypass on the service-booking path),
  but flagging it explicitly since the task instructions asked for verbatim code except
  where the repo forces a change.
- `convex/_generated/api.d.ts` is a checked-in generated file that I hand-patched
  rather than regenerating via `npx convex codegen`, because no `CONVEX_DEPLOYMENT` is
  configured in this worktree. The patch is a minimal, alphabetically-correct addition
  matching the exact format Convex codegen produces elsewhere in the same file. If a
  later task runs real codegen against a live deployment, it should produce an
  identical result for this entry (modulo whatever other modules that task adds).
- No client UI was added for promo management (create/update/deactivate/list are
  wired up as backend mutations/query only); the brief's Task 3 section does not
  mention a UI, so this is presumed to belong to a later task.

## Fix round 1

Task review approved the original work but raised four Important findings, all
extensions of the brief rather than contradictions. Addressed all four.

### What changed

1. `convex/promos.ts` `createInternal`: added `validate(args)` as the first line of the
   handler, before the dedupe/refresh lookup. An AI/cron-created promo now gets the
   same 1-90 percent bound and `endsAt > startsAt` check as an owner-created one; the
   caller (a cron/action) is expected to handle the throw.
2. `convex/promos.ts` `update`: added the same duplicate-active-code guard `create`
   already had, scoped to exclude the promo being updated itself
   (`if (dup && dup._id !== id) throw ...`). Without this, renaming promo A to a code
   already active on promo B silently produced two active promos answering to the
   same code, with `resolveCode`'s `.first()` picking one arbitrarily.
3. `convex/promos.test.ts`: added a test that runs a real `api.booking.createBooking`
   with a promo code and asserts the promo's `redemptions` field reads `1` afterward
   (read via `t.run((ctx) => ctx.db.get(id))`, not through a query the app exposes).
   This proves `recordRedemption` is actually wired into the booking write path, not
   just callable in isolation.
4. `convex/promos.test.ts`: added three more tests.
   - A promo and a legacy `orgs.discountCodes` entry sharing the same code
     (`SHARED15`): the legacy entry is active at 15 percent, the promo is EXPIRED at
     30 percent. Asserts `validateCode` returns `{ valid: false }`, proving the
     resolver's "a promo match blocks fallback to a legacy code of the same name" rule
     actually holds when there is something to fall back to (the original 6 tests
     never had a legacy code sharing a name with a failing promo).
   - `createInternal` rejects pct 95 (`/between 1 and 90/`), covering fix 1.
   - `update` rejects reusing a code that is already active on a different promo,
     covering fix 2.

### A test-authoring snag found and fixed along the way

The first draft of the "shared code" test queried the org with
`ctx.db.query("orgs").withIndex("by_org", (q) => q.eq("orgId", "org1")).first()` inside
a `t.run()` callback, mirroring the exact pattern used in `convex/bookingConversion.test.ts`
and inside `booking.ts` itself. `npx vitest run` passed (vitest does not typecheck), but
`npm run typecheck` failed:

```
convex/promos.test.ts(90,56): error TS2345: Argument of type '"by_org"' is not
assignable to parameter of type 'keyof SystemIndexes'.
convex/promos.test.ts(90,78): error TS2345: Argument of type '"orgId"' is not
assignable to parameter of type '"_creationTime" | "_id"'.
```

Root cause: `convex/promos.test.ts` declares `let t: ReturnType<typeof convexTest>;`
(the exact form given in the brief). `convexTest` is a generic function; taking
`ReturnType` of it directly, with no call-site inference context, resolves the
`Schema` type parameter to its bare constraint rather than the concrete schema, so
`ctx.db` inside `t.run()` only knows about built-in system indexes, not the app's
custom `by_org` / `by_org_code` indexes. `.insert()` and `.patch()` stay permissive
under that widened type (which is why the original 6 tests, and the file's other
`t.run()` calls, never hit this), but `.withIndex()` validates the index name and
its field strictly and fails.

I checked the rest of the test suite: every other file that declares `t` this same
direct way (`discountCodes.test.ts`, `sessions.test.ts`, `rooms.test.ts`, and ~55
more) avoids `.withIndex()` inside `t.run()` entirely, using `.collect()` plus a
plain JS `.find()`/filter instead. Files that DO use `.withIndex()` inside `t.run()`
(`bookingConversion.test.ts`, `betaClock.test.ts`, `handover.test.ts`) all go through
a shared `initT()` helper that resolves the schema type concretely, avoiding the
widening. Rather than introduce a new `initT` helper into this file (a bigger,
unrequested change) or add an `any` cast, I matched the established convention for
files of this file's own declaration style and rewrote the query as:

```ts
const org = (await ctx.db.query("orgs").collect()).find((o) => o.orgId === "org1");
```

This is a same-behavior, test-only change (small fixture, `.collect()` is fine) and
it is what the rest of this file's sibling test files already do. Confirmed via an
isolated repro file (`repro.test.ts`, deleted after) that the error is a
convex-test/TypeScript inference gap independent of anything else in this file, not
a symptom of a real schema or logic problem.

### Commands and results

RED/GREEN not applicable here (these are additive fixes to already-passing code, not
a new failing-first cycle); ran straight to verification.

```
$ npx vitest run convex/promos.test.ts convex/discountCodes.test.ts convex/bookingConversion.test.ts
```

```
 Test Files  3 passed (3)
      Tests  28 passed (28)
```

(`promos.test.ts` alone: 10 tests, up from 6.)

```
$ npm run typecheck
> tsc --noEmit
(clean, no output)
```

Full suite re-run for safety:

```
$ npm test
> vitest run
 Test Files  149 passed (149)
      Tests  1283 passed (1283)
```

(1283, up from 1279: the 4 new tests.)

`npx eslint convex/promos.ts convex/promos.test.ts`: clean, no output. Grepped both
files for em dashes: none.

### Files changed (this round)

- `convex/promos.ts`: `createInternal` validates args; `update` guards against a
  duplicate active code on another promo.
- `convex/promos.test.ts`: 4 new tests (redemption increments on a real booking,
  promo-vs-legacy same-code fall-through blocked, `createInternal` percent bound,
  `update` duplicate-code guard).

### Self-review (this round)

- Re-read the full diff (`git show dc3918e`) line by line; both fixes are minimal,
  additive, and do not change behavior for any existing passing case (confirmed by
  the unchanged pass count on the other 27 pre-existing tests in the three target
  files).
- Confirmed `update`'s guard uses the same error message and pattern as `create`'s,
  for consistency, and correctly excludes the promo being updated by comparing
  `_id`, so renaming a promo to keep its own current code (or changing pct/dates
  without changing the code) still works.
- Confirmed `createInternal`'s new `validate(args)` call sits before both the dedupe
  lookup and the insert/patch, so an invalid rate-cut promo throws before touching
  the database.
- Confirmed the "shared code" test's legacy-code patch targets the org actually
  seeded in `beforeEach` (`orgId: "org1"`) and appends to its existing
  `discountCodes` array rather than clobbering the `LEGACY10` entry other tests in
  the file rely on (this test runs in an isolated `convexTest` instance per `it`
  via `beforeEach`, so there is no cross-test bleed either way).

### Concerns (this round)

- None new. The `TS2345` finding above is a pre-existing, previously-latent
  convex-test typing gap for any file declaring `t: ReturnType<typeof convexTest>`
  directly and then calling `.withIndex()` inside `t.run()`; it was never
  encountered in this file before because none of the brief's original 6 tests
  needed a raw indexed query inside `t.run()`. Worth a note for whoever eventually
  standardizes on the `initT()` helper repo-wide, but out of scope for this task.
