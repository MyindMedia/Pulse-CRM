# Gauntlet rematch: marketing calendar vs Buffer

Files owned/changed: `src/app/(app)/marketing/page.tsx`, `src/components/social/post-chip.tsx`.
Not touched: `account-row.tsx`, `accounts/page.tsx` (builder A); `composer.tsx`, `media-picker.tsx`,
brand-card route, `convex/marketing/posts.ts` (builder B).

## Verdict being addressed

Buffer showed destination + real filters on the calendar surface without a click. Ours hid
destination behind a click and had four stat tiles that looked like filters but did nothing.

## What was built

**1. Channel identity on the chip.** `post-chip.tsx` gained `platformsForPost(accountIds, accounts)`,
a pure helper that resolves a post's connected accounts to their distinct `Platform`s (deduped, in
account order, `[]` while accounts are loading or for a removed account). `PostChip` now renders up
to 4 `PLATFORM_META` brand marks next to the status pill, collapsing extra platforms into a `+N` text
badge, with a `title`/`aria-label` carrying the full destination list for the narrow-chip case. No new
dependency: reuses the existing `brand-icons.tsx` marks already wired through `platforms.ts`.

**2. Stat tiles are real filters.** `page.tsx` adds `StatFilter = "scheduled" | "published" | "draft" |
"bookings"` client state. Each `StatTile` now has an `onClick` that toggles that filter (clicking the
active tile again clears it) and an `accent` when active. "Bookings from posts" filters to the post
IDs with `bookings > 0` from `results.perPost` (the same set the tile's number is summed from), so all
four tiles were kept clickable rather than special-casing zero-count as "dead" - a real filter that
currently matches nothing is still a real filter (shown via the empty state, not a disabled tile). A
persistent "Showing: X / Clear filter" banner sits above the calendar for an unambiguous way out
besides re-clicking the tile. Filtering is a pure client-side narrowing of already-fetched query data,
not a mutation, so it needed no `can()` gate - a read-only viewer gets it too.

**3. Empty month CTA.** When the (unfiltered) month has zero posts, the grid/list is replaced by
`EmptyState` with "Nothing scheduled for `<Month Year>`" and a "New post" button linking to
`/marketing/compose`, gated behind `can("marketing.edit")` - a viewer without edit rights gets
"Ask a studio manager to schedule a post for this month" instead of a link to a page that would not
let them act. The same `EmptyState` slot doubles as the "filter matched nothing" case (distinct
copy + "Clear filter" action), so a filtered-empty month never looks like five rows of dead cells
either.

**4. Second density: Grid / List toggle.** Mirrors the existing `Month`/`Agenda` pattern already
shipped on `src/app/(app)/calendar/page.tsx` (same toggle visual language, same idea of a grouped
list next to a grid). List view renders the *same* month-scoped, same-filter `filteredPosts` as the
grid, grouped by day (`section` + `h3` day header, divided rows), so a studio posting twice a month
gets two rows instead of two cells lost in 35. Chosen over a rolling "upcoming/recent" window scoped
outside the visible month: it keeps the stat tiles, the filter, and both densities all agreeing on
exactly "this month" with no second query surface and no risk of the tile counts and the list
disagreeing about what's shown.

## Gate

- `npx tsc --noEmit` - clean.
- `npm run lint` - 0 errors (86 pre-existing warnings elsewhere in the repo, none in the two owned
  files).
- `npm test` - 166 files / 1398 tests passed.

## What I saw in the browser

Ran on `http://localhost:3317` (`PORT=3317`, blank Clerk keys = dev demo mode) against the shared dev
Convex deployment, `.env.local` copied from the main checkout for `NEXT_PUBLIC_CONVEX_URL`.

- `/marketing`, August 2026 (the seeded month): stat tiles read Scheduled 1 / Published 2 / Drafts 0 /
  Bookings 0. Grid chips on Aug 21 show a gold-free `PUBLISHED` badge plus a Facebook mark and an
  Instagram mark (post goes to both); Aug 24 shows `PUBLISHED` plus an Instagram mark; Aug 31 shows
  `SCHEDULED` plus a Facebook mark - destination now readable without opening anything.
- Switched to List: same three posts as grouped rows under `Fri, Aug 21, 2026` / `Mon, Aug 24, 2026` /
  `Mon, Aug 31, 2026`, each row showing time, caption, status pill, and the platform marks plus their
  full names ("Facebook Page, Instagram").
- Clicked "Published this month": tile got the gold accent ring, banner read "Showing: Published /
  Clear filter", the Aug 31 scheduled post dropped out of the list, only the two published rows
  remained.
- Clicked "Drafts awaiting approval" (count 0): banner read "Showing: Drafts awaiting approval", body
  showed `EmptyState` - "No drafts awaiting approval this month" / "Clear the filter to see every post
  scheduled this month" / Clear filter button. Confirmed the tile is a real filter even at zero, not
  dead.
- Cleared the filter, navigated forward to October 2026 (empty): all four tiles reset to 0, both Grid
  and List showed the same `EmptyState` - "Nothing scheduled for October 2026" / "Plan a post for this
  month so the calendar has something to show" / "New post" button. Clicked it - landed on
  `/marketing/compose`'s template picker as expected.
- Opened the Aug 21 chip's sheet: header pill `PUBLISHED`, Accounts list shows Facebook Page
  (Myind Sound) and Instagram (@myindsound) - matches the two marks shown on the chip, confirming chip
  and sheet never disagree.

The fourth seeded post (draft) did not fall in August or October in this pass; drafts=0 was verified
structurally (filter behavior, not draft-chip rendering) - draft tone/label code path is unchanged
from the existing, already-tested `POST_STATUS_TONE`/`POST_STATUS_LABEL` maps.

Two other builders' dev servers/tabs (port 3311, `account-row.tsx`/`accounts/page.tsx` and
`composer.tsx`/compose flow) were left untouched throughout.
