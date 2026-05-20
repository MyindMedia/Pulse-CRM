# Pulse UI Overhaul - Depth, Shadows, and Selective Liquid Glass

**Date:** 2026-05-19
**Topic:** ui-overhaul
**Status:** Approved (autonomy granted)
**Branch:** `feat/agency-mode-foundation`

## Goal

Add deliberate depth, shadow, and an iOS-inspired Liquid Glass veneer to Pulse without losing the existing "Brutalist Studio" identity (dark, gold, tight radii). The result should feel modern, crisp, and tactile - every floating layer should feel like it sits *above* the surface beneath it.

## Direction Picked: "Brutalist Studio + Liquid Veneer"

Keep the brutalist DNA (tight radii, gold-on-graphite, hairline borders, decisive type). Layer on:

1. A **5-tier elevation ladder** so cards, hovers, popovers, modals and sheets all read at a different depth.
2. **Refined glass utilities** for floating layers only - using top-edge specular highlights and deeper saturation, in the spirit of iOS 2026 Liquid Glass.
3. **Subtle button depth** - primary gold gets a warm drop shadow + inset highlight; secondaries get a resting elevation and a crisp hover lift.

We deliberately **do not** glass body surfaces (cards, tables, forms). Glass is reserved for floating UI so the eye reads hierarchy clearly.

### Rejected approaches

- **Full glass system** - every card and panel glass. Killed: kills hierarchy, hurts perf on long tables, off-brand for a "brutalist" studio CRM.
- **Shadow-only restraint** - no glass at all, just deepen shadows. Killed: misses the explicit iOS-glass ask.

## Elevation ladder

Five tiers, defined as CSS variables in `globals.css`:

| Token | Where it lives | Description |
|---|---|---|
| `--elev-0` | body, full-bleed sections | flush - no shadow, hairline borders only |
| `--elev-1` | resting cards, secondary buttons | soft 1-line shadow + 1px inner highlight |
| `--elev-2` | card hover, raised stat tiles | deeper drop + slightly stronger highlight |
| `--elev-3` | popovers, dropdowns, tooltips, select | shadow + outer ring + inner highlight + glass |
| `--elev-4` | dialog, sheet, command palette | deep shadow + strong inner highlight + glass-strong |

Each tier composes a shadow stack:

```css
--elev-1: 0 1px 0 0 rgba(255,255,255,.04) inset,
          0 1px 2px rgba(0,0,0,.5),
          0 2px 6px rgba(0,0,0,.35);

--elev-2: 0 1px 0 0 rgba(255,255,255,.05) inset,
          0 4px 12px rgba(0,0,0,.55),
          0 8px 24px rgba(0,0,0,.35);

--elev-3: 0 1px 0 0 rgba(255,255,255,.07) inset,
          0 0 0 1px rgba(255,255,255,.04),
          0 12px 32px rgba(0,0,0,.55),
          0 4px 8px rgba(0,0,0,.4);

--elev-4: 0 1px 0 0 rgba(255,255,255,.08) inset,
          0 0 0 1px rgba(255,255,255,.05),
          0 24px 60px rgba(0,0,0,.65),
          0 8px 20px rgba(0,0,0,.45);
```

## Liquid Glass

Refine the existing `.glass` / `.glass-strong` utilities and add a third stronger variant for sheets/modals.

```css
.glass {
  background: color-mix(in oklab, var(--color-coal) 68%, transparent);
  backdrop-filter: blur(22px) saturate(180%);
  -webkit-backdrop-filter: blur(22px) saturate(180%);
  border: 1px solid color-mix(in oklab, white 8%, transparent);
  box-shadow: inset 0 1px 0 0 color-mix(in oklab, white 8%, transparent);
}

.glass-strong {
  background: color-mix(in oklab, var(--color-coal-2) 78%, transparent);
  backdrop-filter: blur(30px) saturate(200%);
  -webkit-backdrop-filter: blur(30px) saturate(200%);
  border: 1px solid color-mix(in oklab, white 10%, transparent);
  box-shadow: inset 0 1px 0 0 color-mix(in oklab, white 10%, transparent);
}

.glass-liquid {
  /* iOS-2026 cue: stronger top-edge specular + deeper saturation */
  background: linear-gradient(
      to bottom,
      color-mix(in oklab, var(--color-coal-2) 60%, transparent) 0%,
      color-mix(in oklab, var(--color-coal) 82%, transparent) 100%
    );
  backdrop-filter: blur(36px) saturate(220%);
  -webkit-backdrop-filter: blur(36px) saturate(220%);
  border: 1px solid color-mix(in oklab, white 12%, transparent);
  box-shadow:
    inset 0 1px 0 0 color-mix(in oklab, white 14%, transparent),
    inset 0 0 0 1px color-mix(in oklab, white 4%, transparent);
}
```

Fallback for browsers without `backdrop-filter`: solid `--color-coal-2` background. (Already supplied via `color-mix`'s fallback layer.)

## Where glass goes - and where it doesn't

| Surface | Treatment |
|---|---|
| **Dialog content** | `glass-liquid` + `elev-4` |
| **Sheet content** | `glass-liquid` + `elev-4` |
| **Command palette** | `glass-liquid` + `elev-4` |
| **Popover** | `glass-strong` + `elev-3` |
| **Dropdown menu** | `glass-strong` + `elev-3` |
| **Select content** | `glass-strong` + `elev-3` |
| **Tooltip** | unchanged (intentionally flat - tooltips should feel quick, not floaty) |
| **Topbar / studio banner** | subtle backdrop-blur only - sticks but doesn't draw focus |
| **Sidebar rail** | opaque (`bg-ink-2`) - anchor surface |
| **Cards** | opaque + `elev-1` at rest, `elev-2` on hover when `interactive` |
| **Tables, forms, body content** | opaque |
| **Stat tiles** | opaque + `elev-1` |

## Button updates

```ts
// button.tsx - variants get composed depth
primary:   bg-gold + inset highlight + soft gold drop shadow (warm cast)
           hover: lift translate-y-[-1px], deeper gold shadow
           active: translate-y-px, shadow collapses

secondary: bg-coal-2 + elev-1 + hairline ring
           hover: bg-coal-3, elev-2
           active: elev-1

ghost:     no shadow at rest
           hover: bg-coal-2 + elev-1
           active: elev-1 → elev-0

outline:   border + elev-1
           hover: border-gold-dim + elev-2

danger:    bg-critical/15 + ring + elev-1
           hover: elev-2

brutal:    unchanged - kept as deliberate alt for hero CTAs
```

Press-state: all buttons (except `brutal`) get `active:translate-y-px` and shadow drops one tier.

## Motion

Existing motion (anim-pop / anim-sheet / anim-rise) is good. Adjustments:

- Modal/sheet: add a 4px backdrop-blur fade-in over 160ms so the glass "wakes up" smoothly.
- Buttons: shadow transitions on `transition-shadow duration-150 ease-out`.
- No new keyframes needed.

## Files to touch

### Token + utility layer
- `src/app/globals.css` - add `--elev-1..4`, refine `.glass`/`.glass-strong`, add `.glass-liquid`

### Primitives
- `src/components/ui/card.tsx` - add `elevation` prop (default `1`); apply `--elev-1` at rest, `--elev-2` on `interactive` hover
- `src/components/ui/button.tsx` - restructure variants per table above
- `src/components/ui/dialog.tsx` - switch content to `glass-liquid` + `elev-4`
- `src/components/ui/sheet.tsx` - switch content to `glass-liquid` + `elev-4`
- `src/components/ui/popover.tsx` - `glass-strong` + `elev-3`
- `src/components/ui/dropdown-menu.tsx` - `glass-strong` + `elev-3`
- `src/components/ui/select.tsx` - `glass-strong` + `elev-3` on content
- `src/components/ui/stat-tile.tsx` - add `elev-1` at rest

### Shell
- `src/components/shell/topbar.tsx` - add `backdrop-blur` + `bg-ink/70`
- `src/components/shell/studio-banner.tsx` - light blur
- `src/components/shell/command-palette.tsx` - `glass-liquid` + `elev-4`

### Verification
- typecheck + lint + 50 vitest + next build must all stay green
- Visual check: dashboard, calendar, songs, settings, agency/staff page each render correctly

## Out of scope (deliberately)

- Light-mode theming (still dark-first)
- Per-tenant accent color tokens beyond gold (already supported)
- New micro-interactions / Lottie / motion-design
- Touching the `book/[slug]` public booking flow (separate brand surface - needs its own pass)

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Backdrop blur perf on long lists | Glass is only on floating layers, never on tables |
| Glass over busy backgrounds reads muddy | Saturation values tuned; tested against grid/dot backgrounds |
| Press-state translate breaks layout | `transform: translateY()` doesn't reflow, safe |
| Inner-highlight loses contrast on bright accent | Applied at low opacity (4-14%) only |

## Success criteria

- Every modal/sheet/popover/dropdown sits visibly above the surface beneath it
- Buttons feel tactile - pressing them gives a real "click-down" cue
- Identity stays Brutalist Studio (gold-on-black, tight radii, hairline borders)
- No drop in lint/test/build status
