# Pulse UI Design Spec

Version 2.0, October 2026. Source of truth for updating the Pulse web app and building the Pulse iOS app.

Pulse is the Studio OS. The interface is built like studio hardware: every card is a machined **chassis** sitting on a stack of slabs, data lives on **recessed glass screens**, actions are **physical keys** that press in, and **Pulse yellow (#FFC900)** is the indicator light. Depth, shadows and colors come directly from the Pulse email signature. When in doubt, match the signature.

Live reference: the **Pulse design system** artifact (tokens, components, web mockups, iOS mockups, live Ticker demo). Charts are built with **Bklit UI** (section 5.5) themed to Pulse tokens.

---

## 1. Principles

1. **Three physical levels, always distinct.** Chassis (raised) > Well (recessed) > Screen (glass inside the well). Data never sits directly on a chassis face.
2. **One light source, top-left.** Highlights on top and left edges, shadows on bottom and right. Never reverse it.
3. **Yellow is a light, not a paint.** It marks the one primary action, the active item, live state and the focused series. It glows. Six uses per screen at most.
4. **Keys feel mechanical.** Raised at rest, sink 1px right and 2px down when pressed, with a haptic tick on iOS.
5. **Studio language.** Session, room, engineer, deposit, split, rate, lockout, hold. Never "event" or "item".
6. **Exact figures.** Money, times and percentages in mono, always formatted, always signed when they are changes.

---

## 2. Design tokens

### 2.1 Color

| Token | Hex / value | Use |
|---|---|---|
| `void` | `#0F0F11` | App canvas, the desk the hardware sits on |
| `well` | `#161618` | Recessed wells and screens |
| `slab-dark` | `#18181A` | Slab stack, dark layer |
| `slab-mid` | `#212124` | Slab stack, mid layer |
| `panel-side` | `#242427` | Side rails, sidebar ground, darker half of a face |
| `face` | `#2B2B2E` | Main chassis face |
| `face-raised` | `#343438` | Raised keys, row hover |
| `face-high` | `#4A4A4E` | Top of key gradients, highlight |
| `edge` | `#3D3D41` | Chassis outline, dividers |
| `edge-hi` | `#56565C` | First slab under a face (bright machined edge) |
| `line-control` | `#7A7A80` | Input and outline-key borders (3:1 on well, side, face) |
| `ink` | `#FFFFFF` | Primary text |
| `ink-muted` | `#C9C9CE` | Secondary text, links |
| `ink-subtle` | `#A8A8AE` | Icons, meta, axis labels (not on `face-high`) |
| `pulse-yellow` | `#FFC900` | Brand light: primary keys, active LED, brackets, scan line, focus |
| `pulse-yellow-hover` | `#FFD633` | Top of yellow key gradient, hover |
| `pulse-yellow-press` | `#E0B000` | Pressed yellow |
| `pulse-yellow-soft` | `rgba(255,201,0,.14)` | Tint behind yellow text, selected rows |
| `grid-line` | `rgba(255,201,0,.05)` | 20px blueprint grid etched on hero faces |
| `on-yellow` | `#111111` | Text and icons on yellow |
| `metal-100` / `300` / `500` | `#E4E4E8` / `#9A9AA0` / `#5C5C62` | Chrome rings, knobs, context series |
| `copper` | `#D0947B` | Rare second series |
| `positive` | `#2FC27A` | Paid, confirmed, gains (always with a word or sign) |
| `negative` | `#FF6B6F` | Overdue, cancelled, losses (always with a word or sign) |
| `info` | `#5AADFF` | System notices only |
| `*-soft` | 16% alpha of the above | Chip grounds |

Contrast (WCAG): `ink` 14:1 on `face`, `ink-muted` 8.6:1, `ink-subtle` 6.0:1, `pulse-yellow` 9.1:1, `on-yellow` on yellow 12.2:1. All text tokens pass 4.5:1 on every surface except `ink-subtle` on `face-high`.

### 2.2 Type

| Style | Family | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `display` | Archivo | 40 / 44 | 800 | -0.02em | One hero line |
| `h1` | Archivo | 26 / 32 (iOS large title 32 / 38) | 800 | -0.01em | Page titles |
| `h2` | Archivo | 16 / 22 | 700 | -0.01em | Chassis titles (signature name size) |
| `h3` | Archivo | 14 / 20 | 600 | 0 | Section titles, list names |
| `body` | Archivo | 14 / 20 | 400 | 0 | Default |
| `body-sm` | Archivo | 13 / 18 | 400 | 0 | Tables, dense lists |
| `caption` | Archivo | 11 / 16 | 400 | 0 | Meta (signature contact size) |
| `label` | Archivo | 10.5 / 14 | 700 | 0.08em, UPPERCASE | Chips, kickers, keys |
| `figure-lg` | JetBrains Mono | 30 / 34 | 500 | -0.02em | KPIs |
| `figure` | JetBrains Mono | 13 / 18 | 500 | 0 | Money, times, IDs |

Fallbacks: Arial, Helvetica (the signature's own stack). Mono figures are tabular.

### 2.3 Spacing, radius, depth, motion

| Token | Value | Use |
|---|---|---|
| `space-1..8` | 4, 8, 12, 16, 20, 24, 32 | 4px base scale |
| `space-6` | 24 | Gap between chassis (lets slab edges and shadows show) |
| `well-inset` | 5 | Chassis edge to well |
| `bezel` | 9 | Bevel strip on a raised module |
| `radius-screen` | 4 | Screens, keys, chips, inputs |
| `radius-well` | 7 | Wells, key banks |
| `radius-chassis` | 14 | Every chassis (iOS tab bar: 26) |
| `radius-pill` | 999 | LEDs, thumbs |
| `depth-step-x` / `depth-step-y` | 0.7 / 1 | Offset per slab layer |
| `depth-layers` | 6 | Slabs under a chassis |
| `boot-fade` | 0.7s | Surfaces fade in |
| `scan-sweep` | 1.4s | One yellow scan line |
| `key-press` | 0.12s | Key down and up |

### 2.4 Shadows (exact, from the signature)

```css
--shadow-slab: 0.7px 1px 0 #56565c, 1.4px 2px 0 #18181a, 2.1px 3px 0 #212124,
               2.8px 4px 0 #18181a, 3.5px 5px 0 #212124, 4.2px 6px 0 #18181a,
               0 22px 36px -4px rgba(0,0,0,.6), 0 10px 16px rgba(0,0,0,.4);
--shadow-lip: inset 0 1.5px 0 rgba(255,255,255,.22), inset -1.5px 0 0 rgba(255,255,255,.12),
              inset 0 -1.5px 0 rgba(0,0,0,.4);
--shadow-well: inset 2px 3px 6px rgba(0,0,0,.85), inset 0 0 0 1px rgba(0,0,0,.6),
               0 1px 0 rgba(255,255,255,.22), 1px 0 0 rgba(255,255,255,.1), 0 -1px 0 rgba(0,0,0,.5);
--shadow-screen: inset 0 0 0 1px rgba(0,0,0,.55), inset 3px 4px 7px rgba(0,0,0,.65),
                 inset -1px -1px 3px rgba(0,0,0,.3);
--shadow-key: inset 0 1px 0 rgba(255,255,255,.22), inset 0 -1px 0 rgba(0,0,0,.4),
              0.7px 1px 0 #18181a, 1.4px 2px 0 #121214, 0 4px 8px rgba(0,0,0,.5);
--shadow-key-pressed: inset 1px 2px 4px rgba(0,0,0,.7), 0 1px 0 rgba(255,255,255,.12);
--glow-yellow: 0 0 14px 4px rgba(255,201,0,.65);
--glow-yellow-soft: 0 0 8px rgba(255,201,0,.6);
--shadow-pop: 0 18px 40px rgba(0,0,0,.65);
```

---

## 3. The hardware model

```
 void (#0F0F11)
 ┌───────────────────────────────────────────┐  CHASSIS: face #2B2B2E, 1px edge #3D3D41, r14
 │ ⌐ bracket                                 │  + shadow-lip + shadow-slab (6 layers + drop)
 │   [LIVE NOW]  Studio A          ● LIVE    │  + top-left gloss (radial white 17% → 0)
 │   ▬▬▬ yellow bar (glow)                   │  + optional 20px yellow grid
 │   ┌─────────────────────────┐  ┌───────┐ │
 │   │ WELL #161618, r7        │  │MODULE │ │  MODULE: raised right block, bezel 9px,
 │   │ shadow-well             │  │┌─────┐│ │  ramp #343438 → #58585C,
 │   │ ┌─────────────────────┐ │  ││SCRN ││ │  well + glass screen inside
 │   │ │ SCREEN r4           │ │  │└─────┘│ │
 │   │ │ shadow-screen       │ │  └───────┘ │
 │   │ └─────────────────────┘ │            │
 │   └─────────────────────────┘            │
 │ ⌙ bracket   [ KEY ] [ YELLOW KEY ]        │  KEYS: raised, press in
 └───────────────────────────────────────────┘
   └─ slab edges stack down-right: #56565C, #18181A, #212124, #18181A, #212124, #18181A
```

**Chassis recipe:** face, edge outline, lip, slab stack, gloss (`radial-gradient(circle 300px at 110px 0, rgba(255,255,255,.17), rgba(255,255,255,.05) 45%, transparent)` plus `linear-gradient(155deg, rgba(255,255,255,.05), transparent 50%)`), yellow corner brackets 14x14, 2px, inset 7px at top-left and bottom-left.

**Well recipe:** `well` fill, `radius-well`, `shadow-well`.

**Screen recipe:** `well` fill, `radius-screen`, `shadow-screen` as an overlay, faint 155deg glass sheen.

**Key recipe:** gradient `face-high` to `face-raised`, `radius-screen`, `shadow-key`. Pressed: `translate(1px, 2px)`, `shadow-key-pressed`, `panel-side` fill. Yellow key: gradient `pulse-yellow-hover` to `pulse-yellow`, slab edges `#8A6D00`, `#5C4900`, glow `0 4px 12px rgba(255,201,0,.25)`.

**LED:** 6px dot. Off `metal-500`. On `pulse-yellow` + `glow-yellow-soft`.

**Boot sequence (once per page or screen load, hero chassis only):** surfaces fade in over 0.7s, brackets snap from 2.2x scale to 1x, then one 3px yellow scan line with `glow-yellow` sweeps left to right over 1.4s. Disabled when reduce motion is on.

---

## 4. Components

| Component | Anatomy | Rules |
|---|---|---|
| **Panel (Chassis)** | Brackets, optional kicker chip (yellow), title `h2`, yellow bar, actions right, body, optional raised module | One job per chassis. `space-6` between chassis. Grid only on hero and overview chassis. |
| **Well** | Recess, optional glass screen | Every readout, chart, table and list sits in a well. |
| **Button (Key)** | Variants: `key` (default), `primary` (yellow), `outline`, `yellow-outline`, `ghost`; sizes 34px and 26px web, 44px and 50px iOS | One primary per view. `pressed` latches for toggles (Hold, Mute). Labels uppercase via style. Never yellow for destructive. |
| **Badge (Chip)** | `yellow` (solid title chip), `live` (yellow on tint + LED), `positive`, `negative`, `info`, `neutral` | One or two words. Word always carries meaning. |
| **StatTile** | Well, label + LED, mono figure, signed delta | `highlight` lights LED and turns figure yellow; one per screen. |
| **Sidebar (web)** | Own chassis on `panel-side`, logo with emboss, yellow bar, grouped items with LEDs | Active item: pushed-in key, yellow text, lit LED. Counts only for queues. |
| **Tabs / Segmented** | Key bank inside a well | Selected key stands up with a lit LED. 2 to 5 options. |
| **ProgressBar** | Machined groove, glowing yellow fill, optional chrome knob | Yellow for focus, `metal` for context, `copper` for second category. |
| **DataTable** | On a glass screen; uppercase `label` headers; mono money | Selected row: yellow tint and 2px yellow left edge. |
| **AreaChart** | Yellow glowing line, yellow fade fill, yellow grid at 8%, dashed cursor | One yellow series; comparison in `metal-100`. |
| **Ticker** | Fixed 1ch digit slots in the mono face; each digit is a 0 to 9 strip that rolls | Used for every figure that can change on screen. Only changed digits roll. See section 5. |
| **Calendar block** | A key placed on the timeline | Selected: yellow key. Hold: hatched yellow outline. Now line: 2px yellow + glow. |

Logo treatment (from the signature): `drop-shadow(-1px -1px 0 rgba(255,255,255,.4)) drop-shadow(1px 1px 1px rgba(0,0,0,.9)) drop-shadow(0 3px 3px rgba(0,0,0,.55))`. Never redraw the logo.

Icons: solid glyphs (signature style), 16px web, 22pt iOS (SF Symbols `.fill` variants), `ink-subtle` at rest, `ink` active, `pulse-yellow` in the active nav item.

---

## 5. Motion and live data

The rule: **the frame stays, the values move.** Chassis, wells, axes, columns and labels never unmount, resize or jump when data changes. Only the numbers, marks and lights inside them animate. A studio owner should be able to leave Pulse open on a screen all day and watch it update like a piece of gear.

### 5.1 Motion tokens

| Token | Web | iOS | Use |
|---|---|---|---|
| `tick-roll` | 700ms `cubic-bezier(.34,1.36,.64,1)` (slight overshoot) | `.spring(response: 0.5, dampingFraction: 0.78)` | Digit roll |
| `tick-flash` | 900ms | 0.9s | Up/down color flash after a roll |
| `chart-reveal` | 1100ms `cubic-bezier(.85,0,.15,1)` (Bklit clip reveal) | `.easeInOut(duration: 1.1)` | First draw of a chart only |
| `domain-tween` | 500ms | `.easeInOut(duration: 0.5)` | Axis range change when data or status changes |
| `row-in` | 240ms ease-out | `.snappy(duration: 0.24)` | New row slides in at top |
| `row-flash` | 600ms | 0.6s | Updated row tint `pulse-yellow-soft` fades out |
| `key-press` | 120ms ease-out | 0.12s | Keys |
| `boot-fade` / `scan-sweep` | 0.7s / 1.4s | same | Boot sequence (hero only) |
| `live-pulse` | 2.2s loop + 280ms pause | same | Live LED and live-line tip dot |

Ease for anything that reveals or travels (charts, domains, rows). Spring only for things that feel physical (digits, keys, knobs, tooltip panel following the crosshair).

### 5.2 Rolling digits (Ticker)

Anatomy: each character of the formatted value is a slot. Digit slots are exactly `1ch` wide in JetBrains Mono with `tabular-nums`, `1.15em` tall, `overflow: hidden`, with a soft top and bottom mask. Inside is a vertical strip of 0 to 9; the strip translates to `-digit × 10%`. Symbols (`$ , . : % +`) are static slots.

Rules:

1. **Format first, then animate.** Format the number to its final string (`$48,250`, `02:14:37`, `82%`), then roll only the characters that differ.
2. **Only changed digits roll.** Unchanged digits do not move. Slots are keyed from the right so the units digit stays the units digit when the number gains a place.
3. **Layout never shifts.** Reserve width for the largest expected value (`min-width: 9ch` for money tiles, `8ch` for timers). Never use proportional figures for changing values.
4. **Direction tells the story.** Increases flash `positive` for 0.9s, decreases flash `negative`. On a highlighted (yellow) tile the flash is a brighter yellow glow instead. Timers and clocks roll with `flash` off.
5. **Never animate first paint.** Values appear static on mount; they roll only on change.
6. **Throttle.** At most one roll per value per 600ms; coalesce bursts (Convex can push several updates a second) and roll to the latest.
7. **Accessibility.** The visible digits are `aria-hidden`; the container has `aria-label` with the full value and `aria-live="polite"` only on the one KPI that matters. Reduced motion: digits swap instantly, flash stays.

Web (shipped in the design system as `Pulse.Ticker`; `StatTile` uses it automatically):

```tsx
<StatTile label="Revenue" value={formatUSD(revenue)} delta={12.4} highlight live />
<Ticker value={`${hh}:${mm}:${ss}`} flash={false} />
```

```css
.pl-tick { display: inline-flex; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pl-tick__slot { width: 1ch; height: 1.15em; overflow: hidden;
  mask-image: linear-gradient(180deg, transparent 0, #000 18%, #000 82%, transparent 100%); }
.pl-tick__strip { display: flex; flex-direction: column;
  transition: transform 700ms cubic-bezier(.34,1.36,.64,1); }
.pl-tick__d { height: 1.15em; line-height: 1.15em; }
.pl-tick--up   { color: var(--positive); text-shadow: 0 0 10px rgba(47,194,122,.45); }
.pl-tick--down { color: var(--negative); text-shadow: 0 0 10px rgba(255,107,111,.45); }
@media (prefers-reduced-motion: reduce) { .pl-tick__strip { transition: none; } }
```

### 5.3 Data updates, UI stays

| Situation | Do | Never |
|---|---|---|
| First load | Render the full chassis and well geometry; charts in Bklit `status="loading"` with `loadingStyle="sweep"` and a shimmer label ("Loading revenue…"); figures show dimmed `$--,---` placeholders at final width | Spinners replacing content, collapsing cards |
| Value changes | Ticker rolls the changed digits; delta updates with it | Re-mounting the tile, fading the whole card |
| New chart data | Append points; tween y-domain 500ms; keep axes, grid and frame | Redrawing from zero, replaying the reveal |
| Live stream | Bklit `LiveLineChart` with a fixed `window`; old points scroll off left | Rescaling x every tick |
| New table row | Insert at top with `row-in`, flash `pulse-yellow-soft` 600ms | Re-sorting rows under the pointer or finger |
| Row value changes | Update the cell in place (Ticker for money), flash the row | Moving the row |
| Optimistic action (Collect deposit) | Update immediately, LED goes yellow-pulse "Syncing"; roll back with a `negative` flash and a chip if it fails | Blocking the UI while saving |
| Connection | Header LED: yellow steady = live, yellow pulse = syncing, `metal-500` = offline, plus caption "Updated 2s ago" (itself a Ticker) | Toasts for routine sync |

Data plumbing: Pulse reads through Convex reactive queries (`useQuery`), so screens subscribe once and every change flows straight into Tickers and charts. Stripe and BILL webhooks write to Convex; the UI never polls. Key every list by record id so React and SwiftUI update in place.

### 5.4 Data display patterns

- **KPI readout:** StatTile in a well: label + LED, Ticker figure, signed delta, optional sparkline (Bklit Area, no axes, `fadeEdges`) under the figure.
- **Live session:** elapsed Ticker (flash off), progress groove fills continuously (CSS width transition 1s linear), live LED pulses on `live-pulse`.
- **Today's money:** Bklit `LiveLineChart` of collected revenue today with the tip badge in the mono face and `momentumColors` up `positive`, down `negative`, flat `metal-300`.
- **Comparisons:** current period yellow, prior period `metal-100` dashed (`dashFromIndex` for forecast tails).
- **Empty:** keep the chassis; inside the well, one caption line and one key ("No sessions today. Open calendar").

### 5.5 Charts with Bklit UI

Bklit UI is a shadcn/ui-registry chart library built on visx and motion. Install per chart:

```bash
npx shadcn@latest init
# components.json → "registries": { "@bklit": "https://ui.bklit.com/r/{name}.json" }
npx shadcn@latest add @bklit/area-chart @bklit/live-line-chart @bklit/bar-chart @bklit/gauge @bklit/ring-chart @bklit/heatmap-chart @bklit/funnel-chart @bklit/sankey-chart
```

Theme Bklit with Pulse tokens (add to the global stylesheet, inside the dark scope):

```css
:root {
  --chart-line-primary: var(--pulse-yellow);
  --chart-line-secondary: var(--metal-100);
  --chart-grid: rgba(255, 201, 0, 0.08);
  --foreground: var(--ink);
  --muted-foreground: var(--ink-subtle);
  --background: var(--well);
}
```

Pulse chart catalog:

| Bklit chart | Pulse use |
|---|---|
| Area | Revenue and payouts over time (hero charts) |
| Live Line | Collected today, live; room occupancy now |
| Bar | Booked hours by room or month (Classic shape, Solid fill; Pattern fill for holds and projections) |
| Composed | Revenue bars with booking-count line |
| Gauge | Monthly goal, room utilization |
| Ring | Deposit collection rate, split sheet signatures |
| Heatmap | Busy hours: weekday × hour across rooms |
| Funnel | Inquiry → call (Max) → booked → paid |
| Sankey | Session revenue → split sheet → payees |
| Sunburst | Revenue by room, then by service |
| Pie | Revenue mix (max 5 slices) |
| Radar | Room or engineer profile across KPIs |
| Scatter | Session length vs rate |
| Choropleth | Where clients come from |
| Candlestick | Not used |

Rules for every chart: mount inside a `Well` screen; one yellow series; tooltip with `showDatePill`, `indicatorColor="var(--pulse-yellow)"`, `matchCrosshair` (spring follow); first reveal uses `animationDuration={1100}`, later updates only tween; loading uses `status="loading"` with the grid `shimmer` and `shimmerSync`. Bklit Studio (bklit.com/studio) can preview a chart with these settings (State Ready/Loading, Shape Classic, Fill Solid/Pattern, Animation Ease/Spring); export with "Get code" and replace colors with the tokens above.

```tsx
<Well screen>
  <AreaChart data={revenue} status={status} loadingLabel="Loading revenue…" animationDuration={1100} yDomainTween aspectRatio="3 / 1">
    <Grid horizontal shimmer shimmerSync stroke="var(--chart-grid)" />
    <Area dataKey="current" fill="var(--chart-line-primary)" fillOpacity={0.32} fadeEdges strokeWidth={2} loadingStyle="sweep" />
    <Area dataKey="previous" fill="var(--chart-line-secondary)" fillOpacity={0} dashFromIndex={0} />
    <YAxis /><XAxis />
    <ChartTooltip matchCrosshair indicatorColor="var(--pulse-yellow)" />
  </AreaChart>
</Well>

<LiveLineChart data={points} value={latest} window={60}>
  <LiveLine dataKey="value" formatValue={(v) => formatUSD(v)}
    momentumColors={{ up: "var(--positive)", down: "var(--negative)", flat: "var(--metal-300)" }} />
  <LiveXAxis /><LiveYAxis position="left" formatValue={(v) => formatUSD(v)} />
</LiveLineChart>
```

### 5.6 iOS: rolling digits and live charts

Native numeric roll (iOS 17), the default for every changing figure:

```swift
Text(revenue, format: .currency(code: "USD").precision(.fractionLength(0)))
    .font(PulseFont.figureLg)                 // JetBrains Mono, monospacedDigit
    .contentTransition(.numericText(value: revenue))
    .animation(.spring(response: 0.5, dampingFraction: 0.78), value: revenue)
    .frame(minWidth: 140, alignment: .leading) // reserve width: layout never shifts
```

Per-digit odometer when the hero needs the full hardware look (masked strips, flash):

```swift
struct Odometer: View {
    let text: String                       // pre-formatted, e.g. "$48,250"
    var flash: Color? = nil
    var body: some View {
        let chars = Array(text)
        // key each slot from the right so the units digit keeps its identity when the number grows
        let slots = chars.enumerated().map { (key: chars.count - $0.offset, ch: $0.element) }
        HStack(spacing: 0) {
            ForEach(slots, id: \.key) { slot in
                if let d = slot.ch.wholeNumberValue {
                    DigitStrip(digit: d)
                } else {
                    Text(String(slot.ch))
                }
            }
        }
        .font(PulseFont.figureLg)
        .foregroundStyle(flash ?? PulseColor.ink)
        .shadow(color: (flash ?? .clear).opacity(0.45), radius: 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
    }
}

struct DigitStrip: View {
    let digit: Int
    var body: some View {
        GeometryReader { g in
            VStack(spacing: 0) {
                ForEach(0..<10, id: \.self) { n in Text("\(n)").frame(height: g.size.height) }
            }
            .offset(y: -CGFloat(digit) * g.size.height)
            .animation(.spring(response: 0.5, dampingFraction: 0.78), value: digit)
        }
        .frame(width: 18, height: 34)          // 1ch of JetBrains Mono at 30pt
        .clipped()
        .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.18),
                                     .init(color: .black, location: 0.82), .init(color: .clear, location: 1)],
                             startPoint: .top, endPoint: .bottom))
    }
}
```

Swift Charts, Pulse-styled, updates without redrawing:

```swift
Chart(points) { p in
    AreaMark(x: .value("Day", p.date), y: .value("Revenue", p.value))
        .foregroundStyle(LinearGradient(colors: [PulseColor.yellow.opacity(0.32), .clear], startPoint: .top, endPoint: .bottom))
        .interpolationMethod(.monotone)
    LineMark(x: .value("Day", p.date), y: .value("Revenue", p.value))
        .foregroundStyle(PulseColor.yellow)
        .lineStyle(StrokeStyle(lineWidth: 2))
        .shadow(color: PulseColor.yellow.opacity(0.6), radius: 4)
        .interpolationMethod(.monotone)
}
.chartYAxis { AxisMarks { _ in AxisGridLine().foregroundStyle(PulseColor.yellow.opacity(0.08)); AxisValueLabel().foregroundStyle(PulseColor.inkSubtle) } }
.chartXAxis { AxisMarks { _ in AxisValueLabel().foregroundStyle(PulseColor.inkSubtle) } }
.animation(.easeInOut(duration: 0.5), value: points)   // domain tween, no re-reveal
.frame(height: 150)
.well()
```

Live line on iOS: keep a fixed 60s window (`.chartXScale(domain: now.addingTimeInterval(-60)...now)`) inside `TimelineView(.animation)` so the line scrolls smoothly while new points append. Loading: keep the chart frame and draw the grid with a shimmer overlay (a moving `LinearGradient` masked to the grid), never `ProgressView` in place of a chart.

Haptics for data: none for passive updates. `.sensoryFeedback(.success, trigger:)` only when a payment or booking the person is watching lands, at most once per 10s.

## 6. Web app

### 6.1 Shell

- Grid: `232px` sidebar chassis + content column, `24px` gap, page padding `24px 32px 32px 24px`, canvas `void`.
- Top bar chassis: page title `h1` + caption, search well, view tabs, one primary key.
- Content: rows of chassis in CSS grid, every grid item `min-width: 0`.

### 6.2 Screens (see design system Mockups)

1. **Studio overview:** live session hero (grid, boot, lens module), October KPIs (4 StatTiles), booking revenue chart, room utilization bars, Pulse AI ops card, today's sessions table, deposits feed.
2. **Bookings:** day calendar by room on a screen (rooms rows, hours columns, key-shaped blocks, hatched holds, glowing now line), selected booking chassis (details well, paid bar, Collect balance), Today at a glance tiles, Session prep checklist.
3. **Invoices and splits:** cash position tiles, invoices table (Overdue, In BILL, Sent, Paid, Draft), split sheet with per-contributor bars and e-sig status, 12-week payouts chart.

### 6.3 CSS starter

```css
.pl-chassis { position: relative; isolation: isolate; background: var(--face);
  border: 1px solid var(--edge); border-radius: var(--radius-chassis);
  box-shadow: var(--shadow-lip), var(--shadow-slab); }
.pl-chassis::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: radial-gradient(circle 300px at 110px 0, rgba(255,255,255,.17) 0%, rgba(255,255,255,.05) 45%, rgba(255,255,255,0) 100%),
              linear-gradient(155deg, rgba(255,255,255,.05) 0%, rgba(255,255,255,0) 50%); }
.pl-chassis--grid::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background-image: linear-gradient(var(--grid-line) 1px, transparent 1px), linear-gradient(90deg, var(--grid-line) 1px, transparent 1px);
  background-size: 20px 20px; }
.pl-well { background: var(--well); border-radius: var(--radius-well); box-shadow: var(--shadow-well); padding: 12px; }
.pl-btn { border-radius: var(--radius-screen); background: linear-gradient(180deg, var(--face-high), var(--face-raised));
  box-shadow: var(--shadow-key); transition: transform .12s, box-shadow .12s; }
.pl-btn:active { transform: translate(1px, 2px); box-shadow: var(--shadow-key-pressed); }
:where(a, button, [tabindex]):focus-visible { outline: 2px solid var(--pulse-yellow); outline-offset: 2px; }
```

The complete stylesheet and React components (`window.Pulse`) are in the design system's `components/bundle.css` and `components/bundle.js`.

---

## 7. iOS app

Target iOS 17+, SwiftUI, dark appearance only (`.preferredColorScheme(.dark)`), iPhone first (393 x 852 reference).

### 7.1 Navigation

- **Floating tab bar chassis** (radius 26, inset 14pt sides, 26pt above home indicator), five slots: **Today**, **Bookings**, **New** (center yellow key, 54pt, radius 18), **Money**, **More**. Active tab: yellow glyph with soft glow and label.
- Content scrolls under a bottom fade from clear to `void` (140pt) so the tab bar floats.
- Large title headers: caption kicker (date or month, uppercase), title 32pt 800, yellow bar 56 x 3 with glow, optional trailing key.
- Detail screens push with a ghost Back key and a status chip in the nav row; no tab bar on full-focus screens (live session).

### 7.2 Screens

1. **Today:** live session chassis (grid, LIVE NOW chip, Recording chip, room and client, elapsed timer in yellow mono, Extend yellow key), two StatTiles (Revenue highlighted, Outstanding), Up next chassis with a list well (avatar key, name, room and time in mono, status chip), Pulse AI suggestion chassis.
2. **Bookings:** week strip in a well (selected day is a yellow key), room filter segmented key bank, timeline chassis with hour rows, key-shaped session blocks, hatched holds, glowing now line. Tap a block for Session detail; long-press to drag (haptic on pickup and drop).
3. **Session detail (live):** hero chassis with four brackets, room chip, chrome lens, 44pt yellow mono timer with glow, ends-at caption, boot sequence on open. Client chassis with Session time and Paid bars. Key row: Notes, Hold (latching), Patch. Full-width yellow key: Extend 1 hour.
4. **Money:** Collected chassis (grid, 34pt yellow figure, signed delta, chart on a screen), segmented Open / Paid / Splits, invoice list well (client, ID, amount, status chip), split sheet chassis with contributor bars and signature status.
5. **More:** Clients, Rooms and gear, Patch map, Staff, Pulse AI, Settings as a list well of keys with LEDs and chevrons.
6. **New (center key):** sheet with detents `.medium` and `.large`: client, room, date and time pickers in wells, rate, deposit toggle (latching key), primary Book session.

### 7.3 Haptics and motion

| Event | Feedback |
|---|---|
| Key press | `.sensoryFeedback(.impact(weight: .light), trigger:)` |
| Yellow primary key | `.impact(weight: .medium)` |
| Latching toggle | `.selection` |
| Payment received, booking saved | `.success` |
| Overdue alert, destructive confirm | `.warning` |

Motion: key press 0.12s ease-out; screen boot only on Today first load and Session detail open; respect `accessibilityReduceMotion` (skip scan and bracket snap).

### 7.4 SwiftUI foundation

```swift
import SwiftUI

// MARK: Tokens
extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

enum PulseColor {
    static let void        = Color(hex: 0x0F0F11)
    static let well        = Color(hex: 0x161618)
    static let slabDark    = Color(hex: 0x18181A)
    static let slabMid     = Color(hex: 0x212124)
    static let panelSide   = Color(hex: 0x242427)
    static let face        = Color(hex: 0x2B2B2E)
    static let faceRaised  = Color(hex: 0x343438)
    static let faceHigh    = Color(hex: 0x4A4A4E)
    static let edge        = Color(hex: 0x3D3D41)
    static let edgeHi      = Color(hex: 0x56565C)
    static let lineControl = Color(hex: 0x7A7A80)
    static let ink         = Color.white
    static let inkMuted    = Color(hex: 0xC9C9CE)
    static let inkSubtle   = Color(hex: 0xA8A8AE)
    static let yellow      = Color(hex: 0xFFC900)
    static let yellowHover = Color(hex: 0xFFD633)
    static let yellowPress = Color(hex: 0xE0B000)
    static let yellowSoft  = Color(hex: 0xFFC900, opacity: 0.14)
    static let gridLine    = Color(hex: 0xFFC900, opacity: 0.05)
    static let onYellow    = Color(hex: 0x111111)
    static let metal100    = Color(hex: 0xE4E4E8)
    static let metal300    = Color(hex: 0x9A9AA0)
    static let metal500    = Color(hex: 0x5C5C62)
    static let copper      = Color(hex: 0xD0947B)
    static let positive    = Color(hex: 0x2FC27A)
    static let negative    = Color(hex: 0xFF6B6F)
    static let info        = Color(hex: 0x5AADFF)
}

enum PulseRadius { static let screen: CGFloat = 4, well: CGFloat = 7, chassis: CGFloat = 14, tabBar: CGFloat = 26 }
enum PulseSpace  { static let s1: CGFloat = 4, s2: CGFloat = 8, s3: CGFloat = 12, s4: CGFloat = 16, s5: CGFloat = 20, s6: CGFloat = 24, s8: CGFloat = 32 }

enum PulseFont {
    // Bundle Archivo and JetBrains Mono (OFL) and list them under UIAppFonts.
    static func sans(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .custom("Archivo", size: size).weight(weight) }
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .medium) -> Font { .custom("JetBrains Mono", size: size).weight(weight).monospacedDigit() }
    static let largeTitle = sans(32, .heavy)
    static let h2 = sans(16, .bold)
    static let body = sans(14)
    static let caption = sans(11)
    static let label = sans(10.5, .bold)          // use .tracking(0.84) + uppercase
    static let figureLg = mono(30)
    static let figure = mono(13)
}

// MARK: Chassis (signature slab stack)
struct Chassis: ViewModifier {
    var radius: CGFloat = PulseRadius.chassis
    var grid = false
    var brackets = true
    private let slabs: [Color] = [PulseColor.edgeHi, PulseColor.slabDark, PulseColor.slabMid,
                                  PulseColor.slabDark, PulseColor.slabMid, PulseColor.slabDark]

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background {
                ZStack {
                    // Slab stack, deepest first
                    ForEach(Array(slabs.enumerated()).reversed(), id: \.offset) { i, c in
                        shape.fill(c).offset(x: 0.7 * CGFloat(i + 1), y: CGFloat(i + 1))
                    }
                    .compositingGroup()
                    .shadow(color: .black.opacity(0.6), radius: 18, x: 0, y: 18)
                    .shadow(color: .black.opacity(0.4), radius: 8, x: 0, y: 10)

                    shape.fill(PulseColor.face)
                    if grid { GridEtch().clipShape(shape) }
                    // Gloss from the top-left
                    shape.fill(RadialGradient(colors: [.white.opacity(0.17), .white.opacity(0.05), .clear],
                                              center: UnitPoint(x: 0.2, y: 0), startRadius: 0, endRadius: 300))
                    shape.fill(LinearGradient(colors: [.white.opacity(0.05), .clear],
                                              startPoint: .topLeading, endPoint: .center))
                }
            }
            .overlay {
                ZStack {
                    shape.strokeBorder(PulseColor.edge, lineWidth: 1)
                    // Lip: light top and right, dark bottom
                    shape.strokeBorder(LinearGradient(colors: [.white.opacity(0.22), .clear, .black.opacity(0.4)],
                                                      startPoint: .top, endPoint: .bottom), lineWidth: 1.5)
                        .padding(1)
                    if brackets { Brackets() }
                }
                .allowsHitTesting(false)
            }
    }
}

struct GridEtch: View {
    var body: some View {
        Canvas { ctx, size in
            var p = Path()
            stride(from: 0, through: size.width, by: 20).forEach { x in p.move(to: .init(x: x, y: 0)); p.addLine(to: .init(x: x, y: size.height)) }
            stride(from: 0, through: size.height, by: 20).forEach { y in p.move(to: .init(x: 0, y: y)); p.addLine(to: .init(x: size.width, y: y)) }
            ctx.stroke(p, with: .color(PulseColor.gridLine), lineWidth: 1)
        }
    }
}

struct Brackets: View {
    var corners: [UnitPoint] = [.topLeading, .bottomLeading]
    var body: some View {
        ZStack {
            ForEach(corners.indices, id: \.self) { i in
                let c = corners[i]
                BracketShape(top: c.y == 0, left: c.x == 0)
                    .stroke(PulseColor.yellow, lineWidth: 2)
                    .frame(width: 14, height: 14)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: Alignment(horizontal: c.x == 0 ? .leading : .trailing, vertical: c.y == 0 ? .top : .bottom))
                    .padding(7)
            }
        }
    }
}

struct BracketShape: Shape {
    var top: Bool, left: Bool
    func path(in r: CGRect) -> Path {
        var p = Path()
        let y = top ? r.minY : r.maxY, x = left ? r.minX : r.maxX
        p.move(to: CGPoint(x: x, y: top ? r.maxY : r.minY)); p.addLine(to: CGPoint(x: x, y: y))
        p.addLine(to: CGPoint(x: left ? r.maxX : r.minX, y: y))
        return p
    }
}

// MARK: Well and screen
struct Well: ViewModifier {
    var radius: CGFloat = PulseRadius.well
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .padding(PulseSpace.s3)
            .background(
                shape.fill(PulseColor.well
                    .shadow(.inner(color: .black.opacity(0.85), radius: 3, x: 2, y: 3))
                    .shadow(.inner(color: .black.opacity(0.6), radius: 0.5)))
            )
            .overlay(   // rim catching light on the lower right
                shape.strokeBorder(LinearGradient(colors: [.black.opacity(0.5), .white.opacity(0.18)],
                                                  startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1)
            )
    }
}

// MARK: Keys
struct KeyStyle: ButtonStyle {
    enum Kind { case key, primary, ghost }
    var kind: Kind = .key
    var height: CGFloat = 44

    func makeBody(configuration: Configuration) -> some View {
        let pressed = configuration.isPressed
        let shape = RoundedRectangle(cornerRadius: PulseRadius.screen, style: .continuous)
        return configuration.label
            .font(PulseFont.label).tracking(0.84).textCase(.uppercase)
            .foregroundStyle(kind == .primary ? PulseColor.onYellow : (kind == .ghost ? PulseColor.inkSubtle : PulseColor.ink))
            .padding(.horizontal, PulseSpace.s4)
            .frame(minHeight: height)
            .background {
                if kind != .ghost {
                    ZStack {
                        // two-slab key edge
                        shape.fill(kind == .primary ? Color(hex: 0x5C4900) : Color(hex: 0x121214)).offset(x: 1.4, y: 2)
                        shape.fill(kind == .primary ? Color(hex: 0x8A6D00) : PulseColor.slabDark).offset(x: 0.7, y: 1)
                        shape.fill(kind == .primary
                                   ? LinearGradient(colors: [PulseColor.yellowHover, PulseColor.yellow], startPoint: .top, endPoint: .bottom)
                                   : LinearGradient(colors: [PulseColor.faceHigh, PulseColor.faceRaised], startPoint: .top, endPoint: .bottom))
                        shape.strokeBorder(LinearGradient(colors: [.white.opacity(kind == .primary ? 0.45 : 0.22), .clear, .black.opacity(0.4)],
                                                          startPoint: .top, endPoint: .bottom), lineWidth: 1)
                    }
                    .opacity(pressed ? 0 : 1)
                    .background(shape.fill(kind == .primary ? PulseColor.yellowPress : PulseColor.panelSide)
                        .shadow(.inner(color: .black.opacity(0.7), radius: 2, x: 1, y: 2)))
                    .shadow(color: kind == .primary ? PulseColor.yellow.opacity(pressed ? 0 : 0.25) : .black.opacity(pressed ? 0 : 0.5),
                            radius: kind == .primary ? 6 : 4, y: 4)
                }
            }
            .offset(x: pressed ? 1 : 0, y: pressed ? 2 : 0)
            .animation(.easeOut(duration: 0.12), value: pressed)
            .sensoryFeedback(.impact(weight: kind == .primary ? .medium : .light), trigger: pressed) { _, new in new }
    }
}

// MARK: LED, chip, scan line
struct LED: View {
    var on: Bool
    var body: some View {
        Circle().fill(on ? PulseColor.yellow : PulseColor.metal500)
            .frame(width: 6, height: 6)
            .shadow(color: on ? PulseColor.yellow.opacity(0.6) : .clear, radius: 4)
    }
}

struct Chip: View {
    enum Tone { case yellow, live, positive, negative, info, neutral }
    var text: String; var tone: Tone = .neutral; var dot = false
    var body: some View {
        let (fg, bg): (Color, Color) = {
            switch tone {
            case .yellow:   return (PulseColor.onYellow, PulseColor.yellow)
            case .live:     return (PulseColor.yellow, PulseColor.yellowSoft)
            case .positive: return (PulseColor.positive, PulseColor.positive.opacity(0.16))
            case .negative: return (PulseColor.negative, PulseColor.negative.opacity(0.16))
            case .info:     return (PulseColor.info, PulseColor.info.opacity(0.16))
            case .neutral:  return (PulseColor.inkMuted, PulseColor.faceRaised)
            }
        }()
        HStack(spacing: 4) {
            if dot { Circle().fill(fg).frame(width: 6, height: 6).shadow(color: fg, radius: 3) }
            Text(text).font(PulseFont.label).tracking(0.84).textCase(.uppercase)
        }
        .foregroundStyle(fg).padding(.horizontal, 8).frame(height: 18)
        .background(bg, in: RoundedRectangle(cornerRadius: PulseRadius.screen))
    }
}

struct BootScan: ViewModifier {   // once, on hero chassis
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var x: CGFloat = -0.05
    @State private var shown = false
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .overlay(alignment: .leading) {
                if !reduceMotion {
                    GeometryReader { g in
                        Rectangle().fill(PulseColor.yellow).frame(width: 3)
                            .shadow(color: PulseColor.yellow.opacity(0.65), radius: 10)
                            .offset(x: x * g.size.width)
                            .opacity(x > 0 && x < 1 ? 1 : 0)
                    }
                    .allowsHitTesting(false)
                }
            }
            .onAppear {
                withAnimation(.easeOut(duration: 0.7)) { shown = true }
                withAnimation(.linear(duration: 1.4).delay(0.8)) { x = 1.05 }
            }
    }
}

extension View {
    func chassis(grid: Bool = false, brackets: Bool = true) -> some View { modifier(Chassis(grid: grid, brackets: brackets)) }
    func well() -> some View { modifier(Well()) }
    func boot() -> some View { modifier(BootScan()) }
}
```

### 7.5 iOS screen skeleton (Today)

```swift
struct TodayView: View {
    var body: some View {
        ZStack(alignment: .bottom) {
            PulseColor.void.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    LargeHeader(kicker: "FRIDAY, OCT 9", title: "Today")
                    LiveSessionCard()                 // .chassis(grid: true).boot()
                    HStack(spacing: 10) {
                        StatTile(label: "Revenue", value: "$48.2k", delta: 12.4, highlight: true)
                        StatTile(label: "Outstanding", value: "$6.9k", delta: -8.3)
                    }
                    UpNextCard()                      // .chassis(brackets: false), list in .well()
                    PulseAICard()
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 140)
            }
            LinearGradient(colors: [.clear, PulseColor.void], startPoint: .top, endPoint: .center)
                .frame(height: 140).allowsHitTesting(false)
            PulseTabBar(selection: .today)            // .chassis(radius 26, brackets: false)
                .padding(.horizontal, 14).padding(.bottom, 8)
        }
        .preferredColorScheme(.dark)
    }
}
```

Performance: the slab stack is six shapes per chassis; on long lists use `.drawingGroup()` on the stack or render list rows as wells inside one chassis rather than one chassis per row.

---

## 8. Accessibility

- Focus ring (web): 2px solid yellow, 2px offset, on every interactive element.
- Status never relies on color: chips carry words; deltas carry sign and arrow.
- Hit targets: 44pt minimum on iOS; web keys 34px (26px only in dense toolbars).
- Dynamic Type: scale `body`, `caption`, `label` with `relativeTo:`; figures may cap at xxxLarge.
- Reduce Motion: skip boot scan, bracket snap and chart animation; keep key press offset.
- VoiceOver: LEDs are decorative; chips read as "Status: Overdue"; timers announce as "2 hours 14 minutes elapsed".

---

## 9. Content rules

- Address the studio owner as "you". Pulse AI suggests, never commands ("Send a reminder?").
- Sentence case in source; uppercase only via `label` style.
- Money `$1,250.00`, compact on mobile tiles `$48.2k`; times `15:00 to 19:00`; changes `+4.2%` / `−8.3%` with arrows.
- No emoji, no exclamation marks.

---

## 10. Migration checklist

**Web**

1. Replace the old token file with the tokens in section 2 (or import the design system's `tokens.css`).
2. Load Archivo (400 to 800) and JetBrains Mono (400, 500).
3. Set the canvas to `void`; wrap every card in `.pl-chassis` with `space-6` gaps.
4. Move all data (KPIs, charts, tables, lists) into `.pl-well` / screens.
5. Swap buttons for keys; keep one yellow primary per view.
6. Rebuild the sidebar as its own chassis with LEDs and the pushed-in active item.
7. Swap status pills for chips; add signs and arrows to every delta.
8. Add the boot sequence to the hero chassis of Overview, Bookings and Finance only.
9. Swap every changing figure to `Ticker` (StatTile does it automatically); reserve widths; throttle to one roll per 600ms.
10. Install Bklit charts, apply the token mapping in 5.5, and move every chart into a `Well` screen with loading states.
11. Wire Convex `useQuery` subscriptions so values update in place; remove spinners that replace content.
12. Run a contrast and focus pass against section 8.

**iOS**

1. Add `PulseColor`, `PulseFont`, `Chassis`, `Well`, `KeyStyle`, `LED`, `Chip`, `BootScan` (section 7.4) to a `PulseUI` package.
2. Bundle the two font families; register under `UIAppFonts`.
3. Build the floating `PulseTabBar` with the center New key.
4. Build Today, Bookings, Session detail, Money, More, and the New booking sheet per section 7.2.
5. Wire haptics per section 7.3; verify Reduce Motion and Dynamic Type.
6. Use `.contentTransition(.numericText(value:))` for every changing figure and `Odometer` on hero readouts (section 5.6); restyle Swift Charts per 5.6.
7. Test on iPhone SE (375pt) and Pro Max (440pt): chassis stack, tab bar and timeline must not clip.

**Open item:** add the Pulse logo file (PNG or SVG) to the design system so the sidebar and iOS header use the real mark with the signature emboss.
