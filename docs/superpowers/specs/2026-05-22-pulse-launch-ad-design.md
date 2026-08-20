# Pulse Launch Ad — Design Spec

**Date:** 2026-05-22
**Topic:** Brand-hype launch ad for Pulse, built in Remotion, three cuts.
**Status:** Approved (concept + location + ratios) — pending spec review.

## Goal

A brand-hype launch ad for **Pulse** (the studio operating system). Sells the *feeling* — a chaotic studio brought into one calm, gold-lit place — not a feature walkthrough. Produced programmatically in Remotion so it is fully on-brand, re-renderable, and version-controlled with the product. Real Pulse UI appears as tasteful glimpses, not a demo.

Three cuts from one shared scene system:

| Cut | Ratio | Resolution | Duration | Placement |
|---|---|---|---|---|
| `hook` | 9:16 | 1080×1920 | 15s (450f @30) | Reels / TikTok / Shorts |
| `social` | 1:1 | 1080×1080 | 30s (900f @30) | IG / X / LinkedIn feed |
| `hero` | 16:9 | 1920×1080 | 75s (2250f @30) | Landing-page hero |

fps = 30 for all.

## Creative spine

Pulse's name is the device: a recurring **gold pulse-line / heartbeat** that beats with the music and threads every scene. Mood = "studio at 2am." Arc (shared across cuts, scaled per duration):

1. **ColdOpen** — ~36-frame held breath (brand-dna principle 5), black, one gold pulse-line draws across, then `"Your studio runs on chaos."` fades in (fade + 2px rise).
2. **Chaos** — fast, desaturated flashes of the pain: spreadsheets, unpaid invoices, scattered DM threads, lost files. Cold, **no gold** (gold is withheld to make the turn land).
3. **Turn** — the flat pulse-line snaps into a heartbeat; gold floods in; **Pulse logo hits on the beat**.
4. **AugmentedShowcase** — the product made tactile in 3D, not flat glimpses:
   - **Augmented windows:** real Pulse UI screenshots as glass panels floating in perspective 3D space (CSS `perspective` + `rotateX/Y` + `translateZ`), multiple panels at different depths, slow camera-style drift and parallax.
   - **3D menu:** a Pulse nav/menu panel tilted in 3D with items that stagger-pop forward on `translateZ`.
   - **Button clicks:** an animated cursor glides to controls and clicks them — gold press ripple + the target button lights up / a panel responds — so the app feels alive and interactive.
   - **Data visualizations:** animated gold charts (bars grow, an area/line path draws, numbers count up) for the "every dollar / catalog growth" beat. Directional/illustrative labels only — no fabricated precise KPIs (honesty rule).
5. **Payoff** — `"One place. Every song. Every session. Every dollar."`
6. **CTA** — held 1s: Pulse logo + `"The studio CRM built for producers, not spreadsheets"` + URL.

The `hook` cut compresses to ColdOpen → Turn → one ValueBeat flash → CTA. The `social` cut runs ColdOpen → Chaos → Turn → 3 ValueBeats → Payoff → CTA. The `hero` cut runs the full arc with all ValueBeats.

## Brand tokens (from `src/app/globals.css` — exact, do not invent)

- Background: `--color-ink #08080a` (full-bleed, no gradients). Depth layers: `coal #141417`, `coal-2 #1a1a1f`.
- Accent (one per frame): `--color-gold #fdb913`; bright `#ffd24a`, deep `#c98a00`, gold-ink `#241900` (text on gold).
- Text: `--color-bone #f6f6f5`; muted `--color-ash #a3a3ad`.
- Hairlines: `#2b2b32` / `#383840`. Brutal gold shadow `5px 5px 0 0 #fdb913`; gold glow `0 0 0 1px rgba(253,185,19,.35), 0 10px 40px rgba(253,185,19,.18)`.
- Fonts: display = **Space Grotesk** (headlines, tight tracking −0.02em, heaviest weight), body = **Inter**, mono = JetBrains Mono. Loaded via `@remotion/google-fonts`.
- brand-dna self-check applies: one accent per frame, 60%+ negative space, emotion-first open, crushed blacks, breath before beat, headline ≥3× body.

## Assets (already on disk)

- Logo: `pulse/public/pulse-logo.png`.
- Real UI: `pulse/.shots/{dashboard,agency,bookings,inventory,studio,book,live,book-slug,live-book}.png`.
- These are copied into the ad project's `public/` at build time (a small copy script), so the project is self-contained.

## Architecture

A **dedicated, self-contained Remotion project** at `pulse/marketing/remotion/` (own `package.json`, Remotion 4.0.465, React 18). Decoupled from OpenMontage.

```
pulse/marketing/remotion/
  package.json            # remotion@4.0.465 + @remotion/cli/transitions/google-fonts/media, react 18, typescript
  remotion.config.ts
  tsconfig.json
  copy-assets.mjs         # copies ../../public/pulse-logo.png + ../../.shots/*.png into public/
  public/                 # logo + screenshots (+ optional music.mp3 supplied by user)
  src/
    index.ts              # registerRoot(Root)
    Root.tsx              # 3 <Composition>s: Hook/Social/Hero, all -> <Ad cut=...>
    theme.ts              # tokens + pacing constants (FPS=30, BREATH=36, beatFrames(bpm))
    cuts.ts               # per-cut config: {aspect,w,h,durationInFrames, scenes:[{key,frames}]}
    Ad.tsx                # composes scenes for a given cut via <Series>/<TransitionSeries>
    scenes/{ColdOpen,Chaos,Turn,AugmentedShowcase,DataViz,Payoff,CTA}.tsx  # responsive via useVideoConfig
    components/
      PulseLine.tsx       # animated gold heartbeat/waveform (SVG path draw + beat pulse)
      Stage3D.tsx         # perspective container + slow camera drift for 3D scenes
      Window3D.tsx        # screenshot as a glass panel posed in 3D (rotateX/Y, translateZ)
      Menu3D.tsx          # tilted Pulse nav panel; items stagger-pop on translateZ
      ClickCursor.tsx     # cursor that glides to a target + gold press ripple
      BarChart.tsx        # animated gold bars (grow via interpolate)
      LineChart.tsx       # gold area/line path that draws (stroke-dashoffset)
      GlassFrame.tsx      # 2D glass frame (used in compact cuts where 3D is overkill)
      KineticText.tsx     # fade + 2px rise; gold key-word emphasis
      CountUp.tsx         # gold count-up for chart numbers (illustrative, no fake KPIs)
```

**3D approach:** CSS 3D transforms (`perspective`, `rotateX/Y`, `translateZ`) for augmented windows + menu — real depth, renders deterministically, no heavy dependency. (React-Three-Fiber via `@remotion/three` is a possible later upgrade for volumetric/orbit shots; out of scope for v1.)

**Prop type rule (Remotion ≥4.0.46x gotcha):** all Composition prop types declared as `type`, never `interface` (interfaces fail the `Record<string, unknown>` constraint). See `reference_remotion_setup` memory.

**Responsiveness:** every scene reads `useVideoConfig()` for width/height and lays out from center with relative units, so the same components serve 9:16, 1:1, and 16:9. `cuts.ts` is the single source of which scenes appear and for how many frames per cut.

**Audio:** `<Audio src={staticFile('music.mp3')} />` rendered only if the file exists (guard); cuts land on `beatFrames(bpm)` boundaries (default bpm 120 → 15-frame beats) with the brand-dna breath before the first cut. User supplies a licensed track; renders silent if absent. No network audio fetch.

**VO (optional):** ad stands alone as music + kinetic text. A separate `VO-SCRIPT.md` provides per-cut lines Lawrence can record himself; not wired into the render by default.

## Build / verify

- All Remotion commands run with Node 22 on PATH: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.
- `npm run copy-assets` then `npm run studio` (`npx remotion studio`) for preview.
- Render: `npx remotion render src/index.ts Hook out/pulse-hook.mp4` (and `Social`, `Hero`).
- Verification (no visual unit tests): `npx tsc --noEmit` clean; `npx remotion still src/index.ts <Comp> out/<comp>-frame.png --frame=N` snapshot per key scene; render all three to mp4 and eyeball against the brand-dna self-check list.

## Out of scope (YAGNI)

- Seedance / AI b-roll footage (can layer in later as an enhancement).
- Localization, Lambda/cloud rendering, dynamic data props.
- Landing-page embed work (separate task once the mp4/webm exist).
