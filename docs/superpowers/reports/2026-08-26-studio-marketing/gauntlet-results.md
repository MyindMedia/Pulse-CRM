# Gauntlet rematch: Results page

Scope: `src/app/(app)/marketing/results/page.tsx` and two new pure modules
colocated with it. `convex/marketing/results.ts` was not touched - the
backend was already correct (confirmed by calling `perPost` directly against
the dev deployment with a 7-day window before making any change: it returned
the same 2 rows as 30 and 90 days).

## Defect 1: blank page on "Last 7 days"

### What I found

The pre-existing code already followed the documented mount-snapshot
pattern (`to` in `useState(() => Date.now())`, re-taken only on a chip
click via `setTo(Date.now())`) and never read `Date.now()` in the render
body. Reading the arithmetic (`from = to - days * DAY`) line by line, and
confirming with `npx convex run marketing/results:perPost` using the exact
from/to pair the page would compute, the 7-day window is mathematically
identical in shape to the 30 and 90-day ones and the backend returns both
seeded posts for it.

Extensive live reproduction against the shared dev deployment (fresh page
loads, clicking "Last 7 days" as the very first action, rapid switching
between all three chips in every order, both via full navigations and via
in-app clicks) did not reproduce a blank page today - both seeded posts
(published Aug 21 and Aug 24, "now" being Aug 27) sit comfortably inside
every one of the three windows, so I could not force a live failure with
the current dev data and clock.

### Root cause

`days` and `to` were two independently-updated pieces of `useState`. The
component only produced a correct window when both setters were called
together on every range change, and nothing (types, structure, or a single
source of truth) enforced that pairing. That is a real, fixable fragility
even though React's batching happened to keep them in sync in every path I
tested: any future edit that updates one without the other (a URL-driven
default, a reset button, a memoized handler that drops a dependency) would
silently reintroduce exactly the "unstable window" failure mode the
existing mount-snapshot comment already warns about, and the narrowest
window (7 days) is the one with the least margin to absorb it - which
matches the reported pattern of 30/90 tolerating it while 7 does not.

### Fix

Extracted the window arithmetic into a pure, dependency-free module,
`src/app/(app)/marketing/results/range.ts`:

```ts
export function computeRange(now: number, days: number): { from: number; to: number } {
  return { from: now - days * DAY_MS, to: now };
}
```

The page now holds ONE state value, `Selection = { days, from, to }`, set
in a single `setSelection` call built by `selectionFor(days)` (mount
initializer and the click handler both go through it). `days` and its
window can no longer be observed out of step with each other because
there is only one state update, not two. `Date.now()` is still called
exactly where it was before - inside the `useState` lazy initializer and
inside the click handler - never in the render path.

`range.test.ts` tests `computeRange` for the 7, 30 and 90-day cases against
a fixed clock (`2026-08-27T18:00:00.000Z`), plus a monotonicity check that a
post inside the 7-day window is provably inside the 30 and 90-day windows
too (the exact invariant the reported bug appeared to violate).

## Defect 2: empty range looks like a bug

The `rows.length === 0` branch already rendered an `EmptyState`, but with a
generic first-run message ("Publish a post with a booking link...") that
does not distinguish "this studio has never posted" from "this studio has
posted, just not in the selected window" - which is the common case a
7-day filter on an older post would hit. Changed the copy to name the
range: `No posts published in the last {days} days. Try a wider range, or
publish a new post to start tracking it.`

Also added an explicit loading state (`LoadingPanel`, already in
`feedback.tsx`) for `rows === undefined`, which previously rendered nothing
at all. This closes the same "blank looks like broken" gap for the (brief,
normal) network round trip, not just for a genuinely empty result set.

## Improvement 3: lead summary

Added a summary strip above the table with the totals a studio owner
actually asks about - clicks, bookings, revenue and code redemptions,
phrased as one sentence rather than a KPI-tile grid, plus which post led
the range. The ranking logic (`summarizeResults` in `summary.ts`, tested in
`summary.test.ts`) sums clicks + bookings + redemptions per post (revenue
excluded from the score since a room-rate difference would silently change
"best" for reasons not visible on the row) and only declares a leader when
someone actually has activity and there is more than one post to compare -
a lone post is never announced as having "won", and an all-zero range gets
a plain "No clicks or bookings yet this range" instead of a fabricated
winner.

Deliberately did not use `StatTile`'s delta/percentage chrome: a studio
posting a handful of times a month can go from 0 to 6 clicks, a change no
percentage renders sensibly, and the brief explicitly warned against
copying Buffer's KPI-delta framing for its own sake. The sentence form
reads as a status report regardless of whether the numbers are big or
small - "0 bookings" in a sentence reads as a fact, not a broken counter.

The winning post also gets a small gold "Top" badge and a soft row tint in
the table itself, so the two rows are no longer visually identical when
one drove six clicks and the other drove none.

## Improvement 4: unexplained GHL columns

Confirmed via `grep` across `convex/` that nothing writes
`socialPosts.stats.impressions` or `.engagements` anywhere in the backend -
the schema field exists but no cron or mutation populates it yet (the daily
`refreshStatsAll` cron only writes `socialAccounts.stats`, i.e.
followers/reach at the account level, not per-post stats). So "-" was
permanent, not occasionally pending.

Changed the cell text from bare "-" to "Not synced" (reads as pending, not
broken), and added a tooltip on both column headers (`Tooltip` from
`ui/tooltip.tsx`, plus a small info icon) that expands the acronym and
explains the state: "GoHighLevel per-post stats - Syncs from your connected
GHL accounts once available. Shows 'Not synced' until then."

## Verification

- `npm run typecheck`: clean.
- `npm run lint`: 0 errors (85 pre-existing warnings elsewhere in the repo,
  none in any file touched here).
- `npx vitest run`: 168 files, 1410 tests, all passing (11 new tests across
  `range.test.ts` and `summary.test.ts`).
- Live check against the shared dev deployment (`dev:fiery-cricket-350`),
  `next dev --webpack` on port 3319, blank Clerk keys: clicked all three
  range chips repeatedly, in every order, from both a hard reload and
  in-app navigation. Every chip showed both seeded posts (6 clicks / 0
  bookings / $0 / 0 redemptions on "Record we mixed in Studio B...",
  0/0/$0/0 on "Tracking vocals..."), the lead summary and "Leading" badge,
  and the "Not synced" GHL cells with working tooltips.

## Files changed

- `src/app/(app)/marketing/results/page.tsx` (modified)
- `src/app/(app)/marketing/results/range.ts` (new)
- `src/app/(app)/marketing/results/range.test.ts` (new)
- `src/app/(app)/marketing/results/summary.ts` (new)
- `src/app/(app)/marketing/results/summary.test.ts` (new)

`convex/marketing/results.ts` and every file owned by the other two
concurrent builders were not touched.
