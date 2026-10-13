## 1. Foundation (slice 1)

- [x] 1.1 `src/app/hardware.css`: kit tokens as `--pl-*`, app tokens remapped under `:root:has(.pulse-hw)`, dark only
- [x] 1.2 Archivo 400 to 800 loaded; sans/display/grotesk/chrome map to Archivo, meta/mono to JetBrains Mono
- [x] 1.3 Card = chassis (lip + slab shadows, top-left gloss); `.pl-well`, `.pl-screen`, `.pl-grid` helpers
- [x] 1.4 Button = keys (yellow primary, graphite secondary, press 1px x 2px, uppercase label)
- [x] 1.5 Badge = chips (soft tone backgrounds, words always)
- [x] 1.6 Glass materials and aurora off inside the shell; yellow focus ring
- [x] 1.7 `/ui-lab` staging-only gallery (404 in production)

## 2. Shell (slice 2)

- [x] 2.1 Sidebar chassis: LEDs, pushed-in active key, plan well, real Pulse logo with emboss (#62, #63; nav in 4 sections, reorder within a section)
- [x] 2.2 Top bar chassis: title + caption, search well, view tabs as a key bank, one primary key (#62; PageHeader portals title + actions into it; overview Day / Week / Month drive the stat tiles)
- [x] 2.3 Corner brackets on shell chassis; hide the light/dark toggle inside the shell

## 3. Screens (slices 3 and 4)

- [x] 3.1 Studio overview per `screenshots/pulse-overview.png` (#64, #65; live data: today.today, dashboard.overview + revenueSeries, reports.roomUtilization, opsActions, payments.recentDeposits)
- [x] 3.2 Bookings per `screenshots/pulse-bookings.png` (day board by room with now line, holds hatched, selected booking, today at a glance, session prep; week view; Month opens the calendar; pipeline kept below)
- [x] 3.3 Invoices and splits per `screenshots/pulse-invoices-splits.png` (cash position, invoices in a screen with status filter, split sheet spotlight, collected chart on Bklit; no BILL tile or Push to BILL: Pulse has no BILL integration)

## 4. Live data (slice 5)

- [ ] 4.1 Ticker for every changing figure (StatTile first), one roll per 600ms
- [ ] 4.2 Boot sequence on the Overview, Bookings and Finance hero chassis, reduced motion respected
- [~] 4.3 Bklit charts in wells with the 5.5 token mapping; loading keeps the frame (overview booking revenue done: Bklit AreaChart in a well; other charts to follow)
- [ ] 4.4 Contrast and focus pass (section 8); cross-browser check on staging
- [x] 4.5 Room light (Lawrence 2026-10-12: "a dimly lit moving background ... luxury feel across all screens"): `AmbientLight` behind every .pulse-hw screen, three warm pools drifting on 66-112s loops, grain + vignette; CSS transforms, not WebGL; still under reduced motion
