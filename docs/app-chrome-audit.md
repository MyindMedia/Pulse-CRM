# App chrome + motion audit (2026-06-09)

Goal: extend the marketing site's chrome **look + animations + feel** into every
app and dashboard surface. The palette sweep already converted all app routes to
the chrome tokens; this is about the *voice* (monolithic chrome headings, mono
metadata) and the *motion layer* (reveals, transitions, count-ups) that the app
currently lacks.

## Current state (findings)
- **Every app surface composes the same shared primitives** — `ui/page.tsx`
  (`PageHeader`, `Section`) + `ui/*` (card, button, stat-tile, charts, badge,
  skeleton, feedback). So shared-component changes propagate everywhere = high leverage.
- **`chrome-display` usage in app surfaces: 0.** The monolithic chrome headline type
  is marketing-only. App headers use `.overline` eyebrow + `font-grotesk` title.
- **Motion: ~static.** Only 6 app components import `motion/react`; there is no
  reveal-on-view, no route transition, no count-up/draw-in layer (unlike marketing's
  Lenis + GSAP + parallax + the live DashboardSim count-ups).
- Net: the app reads as "chrome palette" but not "chrome look + feel".

## Route inventory (~45 surfaces)
- **(app) — 21:** dashboard, pipeline, calendar, schedule, inbox, bookings,
  payments (+[id]), roster (+[id]), songs (+[id]), studio (+[id]), releases,
  reports, inventory, software, licensing, settings, agent.
- **agency — 8:** agency, branding, agents, [orgId], audit, staff (+[id]), autopilot.
- **public/auth — ~13:** welcome, welcome-team, onboard (+done), book/[slug]
  (+[roomId], +checkout), portal/[token], sign/[token], invite/[token],
  pay/invoice/[invoiceId], sign-in, sign-up, activate.

## Prioritized plan

### P0 — Shared shell, header voice + motion scaffold (few edits → all pages)
- [x] `PageHeader` / `Section` → chrome voice: `chrome-meta` eyebrow + a chrome
      title (chrome-display at an app-appropriate scale, or font-grotesk tuned to match).
- [x] Unify the `.overline` utility with the `chrome-meta` mono-metadata look.
- [x] Add `<AppReveal>` (in-view rise+fade, `motion/react`, reduced-motion safe) and a
      route/content transition on the `(app)` layout (AnimatePresence fade/slide).
- [x] Card / StatTile entrance + hover motion polish (consistent lift/elevation):
      `rise-in-soft` keyframe + `.rise-soft` / `.rise-stagger` utilities; StatTile
      rises in on mount, grids opt into stagger via `.rise-stagger`.

### P1 — Shared data components
- [x] Charts (`TrendArea` / `HBars` / `CategoryDonut`) — already gold-gradient + chrome
      tooltip + recharts draw-in animation. ✓ (verified on Dashboard/Reports/Agency)
- [x] Detail + agency pages (9 non-PageHeader surfaces) → chrome-display titles.
- [ ] Tables / list rows → staggered reveal (optional polish; metadata header rows
      already mono via the `.overline` change).
- [x] Sheets / Dialogs / Command palette → already use chrome pop/sheet keyframes.
- [ ] Skeleton→content crossfade (optional polish).

**SHIPPED LIVE (95c35e9 + 9cfeba9):** verified 6 structurally-different surfaces
(dashboard, pipeline/kanban, settings/forms, reports/tables, agency/own-shell,
calendar/grid) all carry the unified chrome look (chrome-display titles, mono
metadata, gold accents, chrome tiles/cards/tables) + motion (route transition +
rise-soft + chart/donut draw-in). Verified via demo mode (no Clerk key → seeded data).

### P2 — Per-surface pass (grouped, in build order)
1. [x] **Dashboard** (flagship) — KPI count-ups (CountUp in app-motion), chart
       draw-in (recharts native), KPI grid + activity feed `.rise-stagger`.
2. [x] **Pipeline** (kanban) — KPI count-ups + summary stagger + column reveal.
3. [ ] **Calendar / Schedule.** (no stat tiles; route transition + chrome header
       from P0 cover these — only bespoke polish left if wanted)
4. [ ] **Inbox / conversations.** (same as above)
5. [x] **Bookings / Payments / Invoices** — stat tiles count up + stagger
       (payments via MoneySummary).
6. [x] **Roster (+detail) / Studio (+room detail) / Releases** — count-ups + stagger.
7. [x] **Inventory / Software** — count-ups + stagger. Reports/Settings/Agent have
       no stat tiles; covered by P0 shell pass.
8. [x] **Agency** overview + [orgId] rollup — count-ups + stagger (chrome titles
       on the rest shipped in 9cfeba9).
9. [ ] **Public/portal/booking** pages (already partly marketing-styled).

### P3 — Feel depth (polish)
- [ ] Number count-ups + value transitions on data refresh.
- [ ] Consistent loading→loaded transitions.
- [ ] Evaluate subtle in-app smooth-scroll (data apps often should NOT use Lenis —
      decide per surface).

## Recommendation
Build P0 first (propagates the chrome look + base motion to all ~21 app pages in a
handful of shared-component edits), then P2 #1 Dashboard as the flagship reference,
then sweep the rest P2 #2→#9. P1 components slot in alongside P2 as needed.
