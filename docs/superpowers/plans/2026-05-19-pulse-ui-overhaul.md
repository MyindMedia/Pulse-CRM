# Plan — Pulse UI Overhaul

**Spec:** `docs/superpowers/specs/2026-05-19-pulse-ui-overhaul-design.md`
**Strategy:** Bottom-up — tokens → primitives → shell → verification. Each step is independently sound; we can stop after any step and still have a usable app.

## Step 1 — Token + utility layer

Edit `src/app/globals.css`:

1. Add 4 elevation tokens (`--elev-1..4`) in `@theme`.
2. Refine `.glass` and `.glass-strong` (add `inset` highlight, tune blur/saturation).
3. Add `.glass-liquid` utility.
4. Add `.shadow-elev-{1..4}` Tailwind-style utilities that reference the tokens.

**Verification:** typecheck (tokens are CSS only — no TS impact). Build a tiny preview by visiting any page.

## Step 2 — Card primitive

Edit `src/components/ui/card.tsx`:

- Add an `elevation?: 0 | 1 | 2` prop, default `1`.
- Apply `shadow-elev-1` at rest, `shadow-elev-2` when `interactive` and hovered.
- Keep hairline border (no change to color).

**Verification:** every page already using `<Card>` should now visibly elevate. Spot-check dashboard.

## Step 3 — Button primitive

Edit `src/components/ui/button.tsx`:

- Restructure all variants per spec table.
- Add gold drop-shadow (`shadow-[0_6px_16px_rgba(253,185,19,0.25)]`) on primary.
- Add `transition-shadow` on hover.
- Replace `active:translate-y-px` chain (already present) with one that also drops shadow tier.

**Verification:** lint passes; visit any page with buttons.

## Step 4 — Floating layer primitives (parallel-safe)

Edit in one pass:
- `dialog.tsx` — `glass-liquid` + `shadow-elev-4`
- `sheet.tsx` — `glass-liquid` + `shadow-elev-4`
- `popover.tsx` — `glass-strong` + `shadow-elev-3`
- `dropdown-menu.tsx` — `glass-strong` + `shadow-elev-3`
- `select.tsx` (Content only) — `glass-strong` + `shadow-elev-3`
- `stat-tile.tsx` — `shadow-elev-1`

**Verification:** lint; open any modal in the running app (e.g., Add Artist dialog).

## Step 5 — Shell polish

Edit:
- `src/components/shell/topbar.tsx` — sticky + `bg-ink/70` + `backdrop-blur-md`
- `src/components/shell/command-palette.tsx` — `glass-liquid` + `shadow-elev-4`

**Verification:** scroll on any long page, watch topbar; ⌘K palette.

## Step 6 — Regression

```bash
cd "/Users/myindsound/SaaS Build Pack/pulse" \
  && npm run typecheck && npm run lint && npm run test && npm run build
```

All four must stay green. If any fail, fix-forward and re-run before commit.

## Step 7 — Commit

Single feature commit on the active branch (`feat/agency-mode-foundation`), following the existing `feat(ui):` / `feat(scope):` style.

## Done definition

- All steps 1-6 complete and green
- `globals.css`, all touched primitives, and shell files committed
- Spec + plan committed to `docs/superpowers/`
