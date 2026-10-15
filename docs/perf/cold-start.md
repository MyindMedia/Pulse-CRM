# Cold start: Pulse OS (web)

Goal: open Pulse OS, the studio OS, and see a useful dashboard as fast as
possible, on a good connection and a bad one. This file holds the web half;
the Pulse app (iOS) half lives in `MyindMedia/Pulse-Native` under the same
path.

Branch `perf/fast-cold-start`. Measured 2026-10-15.

## How it was measured

- **Build:** `next build` + `next start` (production), against a throwaway
  local Convex backend seeded with `seed:run` (Myind Sound demo studio). Demo
  mode: no Clerk key, so the Clerk part of a real sign-in is not in these
  numbers (see "What these numbers do not cover").
- **Browser:** Playwright Chromium, 1440x900, a fresh browser context per run.
- **Cold:** first visit in a fresh context (empty HTTP cache, empty
  localStorage). **Warm:** a second full navigation in the same context (HTTP
  cache and localStorage present).
- **Profiles:**
  - `normal`: loopback, no throttling.
  - `throttled`: CDP legacy "Slow 3G" (2000 ms RTT, 50 KB/s down and up) plus
    4x CPU slowdown.
  - `socket3s`: normal network, but the Convex websocket is held 3 s before it
    connects. Chrome's network throttling does not slow websocket traffic, so
    this is the profile that stands in for a slow data path (in production:
    Clerk loading, the session token, and the socket authenticating).
- **3 runs per cell, median.** Same script, same seed, same machine, before and
  after.
- **Marks** (ms from navigation start, polled every animation frame):
  - **Shell:** the app chassis is on screen (`main .pl-bay`), with no
    full-screen loader over it.
  - **First KPI:** the first dashboard stat tile showing a real figure
    (`.pl-stat-figure` with digits). Cached or live.
  - **Live KPI:** the same, rendered from live data (not inside a
    `[data-snapshot]` tile).
  - **FCP / LCP:** browser paint timing.
- **First-load JS:** `firstLoadUncompressedJsBytes` per route from
  `.next/diagnostics/route-bundle-stats.json` (gzip summed over the same
  chunks).

Scripts: `measure.mjs`, `survey.mjs`, `firstload.mjs`, `theme-check.mjs` in the
session scratchpad (`perf-web/`), not committed.

## Launch requests, before (survey)

Everything between navigation and the first usable dashboard, in order. Bold
marks what held the screen back.

| # | Request | What waited on it |
|---|---|---|
| 1 | `GET /dashboard` HTML | **The server rendered only the full-screen logo loader**: the app tree sat behind the session gate and the plan gate, both of which render a loader on the server. |
| 2 | 37 scripts, 2,170 KB raw / 649 KB gzip | **Hydration.** Nothing past the loader could paint before this. Included every dashboard widget in the Add widget tray (charts, Today board, Pulse AI panels), the booking dialog, the command palette, the booking sheet and the invoice modal, none of which a cold dashboard shows. |
| 3 | Clerk: clerk-js bundle, Frontend API client call, session token (production only) | **AuthGate** held the loader until the Convex socket authenticated. |
| 4 | Websocket connect + authenticate | Everything below. |
| 5 | Batch 1: `agencyBilling.myBilling`, `access.myCapabilities`, `orgs.current` | **BillingLockGate** held "Checking your plan" until `myBilling` answered. Only then did the shell and the page mount and ask for anything else. |
| 6 | Batch 2, 27 queries: shell (`theme.get`, `orgs.current`, `rooms.list`, `members.list`, notifications, time clock, insights, profile, beta signature, agency profile, push x2) and dashboard (`today.today`, `dashboard.overview`, `dashboard.periodKpis`, `dashboard.revenueSeries`, `reports.roomUtilization`, `opsActions.list`, `payments.recentDeposits`, `onboarding.mine`, `stripeConnect.status`, `sessions.upcoming`) | **Every dashboard tile.** Also `theme.get`: the studio's brand colors, Max white-label theme and Glass style applied only after this, so a branded studio saw stock Pulse gold first. Four of these were for closed UI: `rooms.bookable` and `members.engineers` (booking dialog), `songs.picker` and `artists.roster` (command palette). |
| 7 | Batch 3: `arrivalPrep.forSessions` | **Arrival prep checklist** waited for `sessions.upcoming` to name the session ids. |
| 8 | (when a period other than Month was saved) `dashboard.periodKpis` again | The KPI tiles: the period was read from storage in an effect, after the Month query had already gone out. |

Three round trips stood between the socket and a complete dashboard, after
the JavaScript and (in production) Clerk.

## What changed

### Optimistic shell + cached data

- **Boot preview instead of a logo.** While the session is confirmed and the
  plan check answers, the gates render `BootShell`: the real chassis
  (`ShellFrame`, shared with the live shell, so the swap moves no pixels), a
  skeleton rail, the top bar, and on `/dashboard` the last dashboard this
  person saw, rendered by the real dashboard components from the cache. It is
  server-rendered, so the chassis is on screen at first paint instead of after
  the JavaScript downloads. The root loading boundary renders the same
  chassis on app routes (`BootChassis`), so a cold load never passes through a
  full-screen logo; public pages keep the logo loader.
- **Nothing can be written before the session is confirmed.** The whole boot
  preview is `inert` (no clicks, focus or submits) and `aria-hidden`, with a
  screen reader status line. The live tree, and every mutation in it, still
  mounts only after Convex has authenticated the session and the plan check
  has answered, exactly as before. In the live tree, a tile still showing a
  cached figure is inert too until its live answer lands (`SnapshotTile`).
  Money and permission actions are Convex mutations, which re-check the
  session, role and plan on the server on every call.
- **Dashboard snapshot** (`src/lib/boot-cache.ts`, `src/lib/boot-snapshot.tsx`):
  - One localStorage record per person, keyed by the Clerk user id (from the
    server's verified session, `auth()` in the root layout) and holding the
    org id. A record for another org is dropped when the live org answers (org
    or sub-account switch). Opening the cache as a different person wipes every
    other person's record (account switch). Signing out wipes all of it, and so
    does reaching `/sign-in`.
  - Only what this person's own dashboard rendered: the tiles read through
    `useSnapshotQuery`, which records live answers. Before anything is written,
    any field whose name looks like contact or payment details (email, phone,
    card, last4, bank, token, secret, address...) is stripped at any depth. No
    payment card data, no other person's data.
  - Versioned (`v1`), size-capped (256 KB; the demo studio's record is 13 KB),
    every storage call in try/catch. Corrupt JSON, a wrong version or a wrong
    shape is deleted, not trusted. A cached value the current code cannot
    render is caught by `SnapshotBoundary`, which drops the cache and renders
    without it.
- **No flash of the default theme.** After each load the live theme as it
  stands on `<html>` (brand tokens, Max white-label tokens, `data-ui-style`
  for Hardware or Glass, `data-brand-theme`, white-label mode, Google Fonts) is
  saved in the same record. An inline script in the root layout paints it
  before the first frame, on app routes only (`src/lib/app-routes.ts`; public
  pages like `/book` carry their own studio's brand and are skipped). The
  values are re-validated in the script (custom property names, no `<{};`,
  attribute allowlist, fonts only from fonts.googleapis.com). The cached rule
  is removed the moment the live theme is known (`BootRecorder`), and
  `OrgTheme`, `WhiteLabelTheme` and `useUiStyleRoot` no longer clear anything
  while their own data is still loading.
- Warm loads preload the boot preview's code in idle time after the live
  dashboard is up, so the next cold load can paint the cached figures at
  hydration.

### Parallel + fewer round trips

- **Dashboard queries ride with the plan check.** `DashboardPrefetch`
  subscribes the dashboard's queries (and `theme.get`) in the same websocket
  batch as `myBilling`, with `useQueries` so an error never throws into the
  shell. It stays mounted across the gate swap, so the answers are still in
  the Convex client's cache when the tiles mount: they render with data on
  their first frame. Capability-gated tiles are fetched only once the person
  is known to hold the capability (live answer, or last visit's cache), so an
  engineer's browser never asks for deposits.
- **Arrival prep in one trip.** New query `arrivalPrep.forUpcoming` returns
  prep state for the same upcoming window as `sessions.upcoming`, so both go
  out together instead of one after the other. `forSessions` is unchanged for
  its other callers, and the card falls back to it if the backend does not
  have `forUpcoming` yet (site deployed before Convex): checked by rewriting
  the subscription to a missing function in the browser, the dashboard still
  renders and arrival prep loads through `forSessions`.
- **Saved KPI period read at first render**, not in an effect, so the Month
  query no longer goes out and gets replaced.
- **Closed UI no longer loads or queries on a cold start:** the booking
  dialog, parking sign dialog, command palette (roster and songs search),
  global booking sheet and global invoice modal load on first open.
- **Code splitting on the dashboard:** the revenue chart (visx) and every
  widget that starts in the Add widget tray are their own chunks, each with a
  same-footprint placeholder.
- **Loading boundaries:** `(app)/loading.tsx` is now a bay skeleton inside the
  shell, so navigating between app pages keeps the rail and top bar on screen
  instead of blanking to a full-screen logo. Each dashboard tile already loads
  on its own (no tile waits for another), and each is wrapped in its own
  boundary (`SnapshotTile`).

## Before / after

Medians of 3 runs. ms from navigation start.

| Profile | Visit | Shell before | Shell after | First KPI before | First KPI after | Live KPI before | Live KPI after | LCP before | LCP after |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| normal | cold | 117 | 28 | 158 | 102 | 158 | 102 | 228 | 164 |
| normal | warm | 48 | 21 | 67 | 47 | 67 | 47 | 156 | 104 |
| Slow 3G + 4x CPU | cold | 29,401 | 8,304 | 29,949 | 28,314 | 29,949 | 28,314 | 30,052 | 28,408 |
| Slow 3G + 4x CPU | warm | 4,947 | 2,131 | 5,467 | 4,924 | 5,467 | 4,924 | 5,552 | 5,012 |
| socket held 3 s | cold | 3,135 | 26 | 3,195 | 3,108 | 3,195 | 3,108 | 3,272 | 3,168 |
| socket held 3 s | warm | 3,063 | 21 | 3,128 | **336** | 3,128 | 3,047 | 3,192 | 372 |

Reading it:

- **The shell is on screen at first paint** in every profile: 3.5x sooner on a
  throttled cold load (29.4 s to 8.3 s), and from about 3 s to about 20 ms
  whenever the data path is slow. FCP itself barely moves (the old first paint
  was the logo loader; it is now the chassis).
- **Returning visits show the dashboard from cache almost at once** when the
  session or socket is slow: first figures at 336 ms instead of 3.1 s, live
  figures swap in when they land.
- **Live data arrives sooner** in every profile, from the round trips removed
  and the smaller bundle: 35% faster on loopback cold, 10% on throttled warm,
  5% on throttled cold. On Slow 3G the cold load is still dominated by
  downloading about 470 KB of JavaScript at 50 KB/s; see "Next".
- Throttled warm shows no cached-figure phase because Chrome's throttling does
  not slow the websocket: live data lands right after hydration, at the same
  moment the cache would paint.

### Request round trips after

| Batch | Before | After |
|---|---|---|
| 1 (with the plan check) | 3 queries | 11: the plan check plus `theme.get` and the dashboard's ungated queries |
| 2 | 27 queries, incl. 4 for closed UI | 15: shell queries plus the capability-gated tiles (no closed UI) |
| 3 | `arrivalPrep.forSessions` | none |

### First-load JS

| Route | Before (raw) | After (raw) | Change | After (gzip) |
|---|---:|---:|---:|---:|
| `/dashboard` | 2,170 KB | 1,508 KB | **-662 KB (-31%)** | 459 KB (was 649) |
| `/payments` | 1,782 KB | 1,661 KB | -121 KB | 512 KB |
| `/settings` | 2,266 KB | 2,145 KB | -121 KB | 660 KB |
| `/bookings` | 1,637 KB | 1,567 KB | -70 KB | 476 KB |
| `/calendar` | 1,633 KB | 1,621 KB | -12 KB | 491 KB |
| `/book` (public) | 986 KB | 990 KB | +4 KB | 289 KB |
| `/sign-in` | 991 KB | 1,002 KB | +11 KB | 293 KB |

Measured at runtime on `/dashboard`: 37 scripts, 2,170 KB decoded / 662 KB
transferred before; 33 scripts, 1,659 KB / 522 KB after.

## Visual checks

`theme-check.mjs`: the studio set to the midnight-blue brand preset (plus the
demo studio's Max white-label theme), Hardware and Glass, in Chromium,
Firefox and WebKit, at 1440 and 390 px. Each run records a visit, then cold
loads again with the socket held 3 s and samples every frame. **All 12 pass:**
every frame with the shell on screen already has the live accent, ink and UI
style (0 wrong frames out of 53 to 59 per run), the cached dashboard paints at
about 360 ms, the live theme takes over cleanly, no horizontal overflow, no
console errors. Screenshots: `perf-web/frames/boot-*.png` and `live-*.png` in
the session scratchpad.

`~/.claude/tools/browser-check` on `/dashboard`: identical results before and
after. Firefox, WebKit, iPhone and no-WebP pass. The Chromium and Android
failures are aborted link prefetches (`?_rsc=` ERR_ABORTED as the page
closes), and iPad reports a 142 px overflow from the ambient room-light tiles;
both are present on `develop` too and are not touched here.

## Tradeoffs

- **Stale figures:** a returning visit shows last visit's numbers for as long
  as the session and the socket take, then they update in place. Tiles
  showing cached figures are inert and marked `data-snapshot` until live.
- **Expired session or subscription:** the server middleware still refuses an
  expired session before the page renders. If the session is valid at the
  edge but fails to authenticate the socket, the person sees the inert cached
  home for that moment and cannot act; the live tree (and every write) never
  mounts. A billing-locked studio sees the cached home until the plan check
  answers, then the lock screen, as before.
- **Role changes:** cached capabilities can show a tile or nav item the
  person has since lost, until the live answer arrives. The data behind it is
  checked on the server either way.
- **One more stored record per browser** (about 13 KB for the demo studio),
  wiped on sign-out.

## What these numbers do not cover

- **Clerk.** Demo mode has no Clerk, so the real chain (clerk-js download,
  Frontend API call, session token, socket authentication) is not in the
  timings. It is exactly the wait the boot preview covers, and the
  `socket held 3 s` profile stands in for it. Measure on staging with a real
  account before and after merging to confirm.
- **Real Safari** and real devices: checked with Playwright WebKit only.
- Convex needs a deploy for `arrivalPrep.forUpcoming` (it is not part of the
  Netlify build). Until then the card uses the old `forSessions` path, so
  either deploy order is safe. Nothing was deployed from this branch.

## Next

- The remaining cold cost on a slow network is JavaScript every app route
  ships: `motion` (page transitions), Clerk, Radix, `@dnd-kit` (the sidebar's
  reorder). Lazy-loading the sidebar's drag-to-reorder and the page
  transition would cut roughly another 150 to 200 KB raw from every app route.
- Prefetching the shell's own batch-2 queries (notifications, insights,
  profile) with the plan check would remove the last sequential round trip
  for the chrome.
