# Brand icons for Studio Marketing accounts page

## Problem

`src/components/social/platforms.ts` mapped every social network to a generic
lucide-react glyph (camera for Instagram, person-group for Facebook,
briefcase for LinkedIn, music note for TikTok, globe for Google Business
Profile) because lucide-react 1.16.0 dropped its brand icons. On the live
`/marketing/accounts` page this read as unfinished: "Connect Instagram" next
to a plain camera.

## What was built

- `src/components/social/brand-icons.tsx` (new): a `BrandIcon` primitive
  (`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">`) plus one
  exported component per mark: `GoogleIcon`, `FacebookIcon`, `InstagramIcon`,
  `TiktokIcon`, `YoutubeIcon`, `PinterestIcon`, `ThreadsIcon`, `BlueskyIcon`.
  Path data and titles are inlined verbatim from Simple Icons v16
  (https://simpleicons.org, https://github.com/simple-icons/simple-icons),
  licensed CC0-1.0. Attribution and the license are in the file header
  comment. `simple-icons` was not added as a dependency; the eight paths are
  static and never change, so a package is unnecessary weight for this.
- `src/components/social/platforms.ts`: rewired every `PLATFORM_META` entry
  except `linkedin` to use its real brand mark. `tiktok` and
  `tiktok-business` both use `TiktokIcon`. `google` (Google Business Profile)
  uses `GoogleIcon`.

## Color decisions (per platform)

Rendered in the official brand hex, baked into the component (legible on
Pulse's dark coal / coal-2 / coal-3 surfaces):

- Google `#4285F4`
- Facebook `#0866FF`
- Instagram `#FF0069`
- YouTube `#FF0000`
- Pinterest `#BD081C`
- Bluesky `#1185FE`

Fell back to `currentColor` (inherits whatever text color the button or row
already sets, e.g. `text-bone` on the connect button, `text-steel/70` on the
account row):

- TikTok - Simple Icons' hex is pure `#000000`, invisible on this dark UI.
- Threads - same, pure `#000000`.

Judgment call worth flagging: Pinterest's `#BD081C` computes to a WCAG
luminance contrast of only ~2.65:1 against `coal-2` (below the 3:1 non-text
guideline), the weakest of the six brand-hex marks. I kept the official red
anyway rather than substituting a brighter red or falling back to
currentColor, because the visual check in the browser (see below) showed it
reading clearly as Pinterest's red bug against the dark row, unlike TikTok's
and Threads' literal black-on-near-black. Saturated red against a desaturated
dark background pops more than pure luminance math suggests. If this reads
too dim on other monitors, the fix is a one-line hex swap in
`brand-icons.tsx` (`PinterestIcon`'s `fill`) or falling back to
`currentColor` like TikTok/Threads.

## LinkedIn

LinkedIn is not in Simple Icons - it was removed at LinkedIn's own legal
request, so there is no CC0 mark to pull. `platforms.ts` leaves `linkedin` on
lucide's `Briefcase` icon (the existing choice), with a comment at that entry
explaining why it's the odd one out and noting that LinkedIn's official
asset from their brand page can be dropped in later if wanted. No new brand
mark was drawn or fetched for it.

**Flag for the owner:** LinkedIn still uses a neutral glyph, not a real
LinkedIn mark. Grab the official LinkedIn logo asset from
https://brand.linkedin.com/ and it can be swapped in the same way as the
other eight.

## Type widening and consumers checked

`PLATFORM_META`'s `icon` field was `LucideIcon`. It is now
`React.ComponentType<{ className?: string }>` (`type PlatformIcon` in
`platforms.ts`), matching the existing convention already used elsewhere in
this codebase for icon props (`src/app/(app)/brief/[sessionId]/page.tsx`,
`src/app/agency/settings/page.tsx`, `src/app/kiosk/page.tsx`,
`src/components/calendar/checklists-panel.tsx`,
`src/components/today/side-panels.tsx`, etc. all use the identical
`React.ComponentType<{ className?: string }>` shape). This accepts both
lucide's `LucideIcon` (used for `linkedin`'s `Briefcase`) and the inlined
brand components, all of which render `<meta.icon className="..." />`.

Grepped every importer of `PLATFORM_META` in `src/`:

- `src/components/social/connect-button.tsx` - `<meta.icon className="size-4" />`
- `src/components/social/account-row.tsx` - `<meta.icon className="size-5 shrink-0 text-steel/70" />`
- `src/components/social/composer.tsx` - `<meta.icon className="size-4 shrink-0 text-steel/70" />`
- `src/app/(app)/marketing/page.tsx` - `<meta.icon className="size-3.5 text-steel/70" />`

All four use the identical `<meta.icon className="..." />` pattern; none
pass any other prop or rely on `LucideIcon`-only members (`size`,
`absoluteStrokeWidth`, etc.), so the widened type covers them without any
other code changes.

## Verification

- `npm run typecheck` - clean, 0 errors.
- `npm run lint` - 0 errors (86 pre-existing warnings elsewhere in the repo,
  none touching `brand-icons.tsx` or `platforms.ts`).
- `npm test` - 164/164 test files, 1388/1388 tests passed.
- Browser: copied `.env.local` from the main checkout, ran
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= PORT=3314 npx next dev --webpack`,
  opened `http://localhost:3314/marketing/accounts` against
  `dev:fiery-cricket-350` in demo mode as Myind Sound.

  What actually rendered, all ten "Connect X" buttons, top to bottom:
  - **Instagram** - pink (`#FF0069`) camera-outline glyph, crisp, no
    distortion despite the ~2000-char path.
  - **Facebook** - blue (`#0866FF`) circular "f", clean.
  - **Google Business Profile** - blue (`#4285F4`) flat "G" bug (Simple
    Icons' current single-tone mark, not the classic four-color G).
  - **TikTok** - white music-note glyph (`currentColor` resolving to the
    button's `text-bone`), clearly legible.
  - **TikTok Business** - same white note glyph as TikTok, correctly
    sharing the one component.
  - **YouTube** - red (`#FF0000`) play-button bug, high contrast.
  - **LinkedIn** - white lucide `Briefcase`, neutral but readable, does not
    look out of place next to the real marks.
  - **Threads** - white "@"-style Threads mark (`currentColor`), legible.
  - **Pinterest** - red (`#BD081C`) circular "P", reads clearly in practice
    despite the borderline WCAG contrast math noted above.
  - **Bluesky** - blue (`#1185FE`) butterfly, clean.

  No layout shift: every icon sits at the same size/position the old lucide
  glyphs occupied, buttons stayed the same height and alignment. Clicked
  "Connect Instagram" to confirm the row still behaves normally past the
  icon change - it surfaced the expected "Social publishing is not
  configured on this server yet." message (demo mode has no GHL wiring),
  which is the pre-existing behavior, not something this change touched.
  No console errors on load or after that click.
