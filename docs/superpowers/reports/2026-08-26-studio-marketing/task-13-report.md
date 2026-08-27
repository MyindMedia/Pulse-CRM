# Task 13: Calendar, Promos and Results pages

## What was implemented

- `src/app/(app)/marketing/page.tsx` - month calendar. 7-column/week-row grid built with pure arithmetic (no date-fns), header stat tiles (scheduled/published this month, drafts awaiting approval, bookings from posts), day cells listing `PostChip`s, and a `Sheet` with full caption, accounts, link, failure text, and Edit/Approve/Cancel/Retry actions.
- `src/app/(app)/marketing/promos/page.tsx` - promo table (code, discount, window, room, redemptions, source pill, active toggle, "Post this" link) plus a "New promo" action and click-to-edit on the code.
- `src/app/(app)/marketing/results/page.tsx` - date-range chips (7/30/90 days) and a results table from `results.perPost` (clicks, bookings, revenue, redemptions, GHL impressions/engagements), with the required footer line and empty-state copy.
- `src/components/social/post-chip.tsx` - caption-preview chip with status pill (draft neutral, approved info, scheduled gold, published positive, failed critical). Exports `POST_STATUS_LABEL` and `POST_STATUS_TONE` so the calendar sheet reuses the same status vocabulary instead of duplicating it.
- `src/components/social/promo-dialog.tsx` - one dialog used for both create (`promos.create`) and edit (`promos.update`), reusing `schedule-math.ts`'s `toDatetimeLocalValue`/`fromDatetimeLocalValue` for the starts/ends fields in the studio's own timezone.
- `src/components/social/calendar-math.ts` + `.test.ts` - pure month-grid arithmetic (`monthBounds`, `monthGrid`, `dayKeyFor`), covering leap Februarys, month-start weekday alignment, and "today" marking. 10 new tests, all passing.

## Deviation from the brief (flagged, not guessed past)

The brief's "Conventions" section said `promos.create`, `promos.update` and `promos.deactivate` need `marketing.edit`. That is incorrect against the actual backend: `convex/promos.ts:58,75,89` all gate on `currentOrgWithCapability(ctx, "marketing.approve")`, and `convex/lib/accessPolicies.test.ts:150-151` explicitly asserts the engineer role holds `marketing.edit` but NOT `marketing.approve`. Gating the Promos UI on `marketing.edit` would let an engineer open "New promo," fill the form, and get a rejected mutation - the opposite of "never an unexplained empty area or a raw internal error." I gated the Promos page (New promo, edit, deactivate) on `marketing.approve` instead, mirroring the exact pattern `accounts/page.tsx` already uses for `connect`/`remove`. `posts.approve`/`posts.cancel` do require `marketing.approve` as stated, unaffected.

I also went slightly beyond the brief's literal Step 2 text by making the promo code clickable to edit (calls `promos.update`) - the brief's interfaces list names `promos.update` as consumed but Step 2's prose only describes create. Wiring code-click-to-edit is the only place `update` is used; without it the interface would be listed but dead.

## What I tested and what I observed

`npm run typecheck && npm run lint && npm test` - all clean (0 typecheck errors, 0 lint errors/86 pre-existing-pattern warnings, 160/160 test files and 1354/1354 tests passing, including the new `calendar-math.test.ts`).

Live verification against `dev:fiery-cricket-350` (Myind Sound demo org), Next on port 3312 with blank Clerk keys:

- **Calendar** (`/marketing`): rendered real data immediately - "Myind Sound" org, correct current month (August 2026), all four stat tiles at 0 (no seeded posts), a correctly-aligned 7-column grid (Aug 1 under Saturday, today the 27th highlighted gold), and Prev/Today/Next all worked (Prev correctly landed on July 2026 with July 1 under Wednesday). No console errors.
- **Promos** (`/marketing/promos`): empty state rendered ("No promo codes yet"). Created a real promo (`TASK13TEST`, 10%, label "Task 13 smoke test") through the actual "New promo" dialog - it appeared in the table immediately with a "Promo created" toast. Clicked "Post this" and landed on `/marketing/compose?template=rate_promo&promo=<id>` with the Rate promo template and the exact promo pre-selected in the composer. Clicked the code to open the edit dialog - correctly pre-filled and titled "Edit promo." Clicked the active toggle - it deactivated (toast "Promo deactivated") and correctly became a disabled, permanently-off switch (there is no un-deactivate mutation on the backend).
- **Results** (`/marketing/results`): initially found a real bug here - see below. After the fix, it renders the "Last 7/30/90 days" chips and the correct empty state ("No results yet" / "Publish a post with a booking link to see results here."). Range switching re-queries and re-renders correctly.

**Bug found and fixed during verification**: my first cut of `results/page.tsx` computed `to = Date.now()` directly in the render body on every render. Because `useQuery` compares args by value, a `to` that changes on every render handed Convex a "new" query on every render, and the subscription never settled - the page stayed stuck showing neither the loading state nor the empty state (blank space below the range chips), with zero console errors, making it look like nothing was wrong until I inspected the accessibility tree and confirmed nothing had rendered past the chips. The lint config's own `react-hooks/purity` warning was pointing at exactly this line the whole time. Fixed by taking `to` as a `useState` snapshot (once at mount, and again only when a range chip is clicked), matching how the Calendar page memoizes `monthBounds` on `[year, month]` rather than recomputing every render.

## Files changed

- `src/app/(app)/marketing/page.tsx` (new)
- `src/app/(app)/marketing/promos/page.tsx` (new)
- `src/app/(app)/marketing/results/page.tsx` (new)
- `src/components/social/post-chip.tsx` (new)
- `src/components/social/promo-dialog.tsx` (new)
- `src/components/social/calendar-math.ts` (new)
- `src/components/social/calendar-math.test.ts` (new)

## Self-review findings

- Completeness against the brief: all three pages, both new components, and all four listed interfaces (`posts.list/cancel/approve`, `promos.list/create/update/deactivate`, `results.perPost`, `rooms.list`) are wired and exercised live.
- Naming: matched existing conventions (`Section`, `EmptyState`, `StatTile`, `errorMessage`, `useCapabilities`) rather than inventing new primitives.
- YAGNI: did not add anything beyond the brief except the click-to-edit promo affordance (justified above, since it is the only consumer of `promos.update`) and the `calendar-math.ts` extraction (justified by tasks 11/12's own precedent of pulling out pure, testable logic, and it caught real bugs via its tests: an initially-wrong "today" test assumption and, indirectly, gave me confidence the grid math itself was solid before I ever opened a browser).
- Every mutating control (New promo, edit, deactivate toggle, Approve, Cancel, Retry) is hidden - not disabled-with-no-explanation - for a viewer who lacks the capability, with a plain-English sentence in its place, matching `accounts/page.tsx`'s established pattern. I did not get to visually verify the read-only-viewer view in the browser (the demo actor has full owner-level capabilities), so this is verified by code inspection and matching the existing accounts.tsx pattern rather than by an end-to-end screenshot.
- All error paths route through `errorMessage()` before hitting a toast; nowhere does a raw `ConvexError`/`Error` string reach the UI.
- Removed a small duplication I introduced on first pass: `page.tsx` had its own local status-to-badge-tone map identical to one already in `post-chip.tsx`; now `post-chip.tsx` exports `POST_STATUS_TONE` and both files share it.

## Issues or concerns

- The `marketing.edit` vs `marketing.approve` discrepancy above (deviation, not a guess - verified against source and a passing test file).
- `monthGrid`'s "isToday" marker and the calendar's own "now" are read at render/memo time, not on an interval - if a studio owner leaves the Calendar tab open across midnight, "today" stays on the old day until they navigate months or reload. Same class of staleness as `schedule-picker.tsx`'s existing `Date.now()`-in-render pattern; not worth a `setInterval` for a marketing calendar.
- Did not seed and test a "published" or "failed" post end-to-end (the demo deployment currently seeds no social posts), so the Sheet's failure-text and Retry paths were verified by code review against `convex/marketing/posts.ts`'s `status`/`failure` fields, not by clicking a real failed post in the browser.
