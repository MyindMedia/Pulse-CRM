# Pulse chrome redesign — motion & scroll spec

Goal: duplicate the look + motion of https://www.dylanbrouwer.design/ in Pulse's
Next.js 16 / React 19 stack, keeping Pulse **gold #FDB913** as the only accent.

## What the reference actually does (observed 2026-06-09)

Stack on the reference (Webflow): **Locomotive Scroll (beta)** for smooth
inertia scrolling + **GSAP 3.15** with **ScrollTrigger**, **SplitText**,
**ScrambleTextPlugin**, **Observer**, **Draggable**. Media = **7 looping, muted
HLS (.m3u8) videos** (Bunny CDN) shown inside device mockups.

Motion inventory:
1. **Smooth scroll** — eased/inertia scroll on the whole page (Locomotive). Every
   scroll-driven effect is tied to scroll progress, not time.
2. **Hero headline** — "SITES THAT" sits solid; **"MOVE" is offset lower + behind**
   the monitor at reduced opacity and **parallaxes** (moves slower than scroll).
   Words reveal on load via SplitText (per-line clip + rise).
3. **3D monitor** — a laptop/monitor rendered in **perspective tilt**, holding a
   looping muted video of a site. On scroll it **scales up / rotates toward flat**
   and rises into the viewport (ScrollTrigger scrub).
4. **Mono metadata** — bottom-left readout ("DESIGN BY DYLAN / NL 00:40 CET");
   the **clock ticks** and labels **scramble** in (ScrambleTextPlugin).
5. **Dark → light** — hero is dark (obsidian + chrome fog); **work sections are
   bright (white)** with **device mockups** (laptop + phone) playing looping work
   videos; tiles get an accent frame on hover (Ember on reference → **gold** here).
6. **Section reveals** — headings/words rise + clip in as they enter (SplitText +
   ScrollTrigger), not simple fades.

## How we duplicate it (our stack)

- **Smooth scroll:** add **Lenis** (`lenis` / `@studio-freight/lenis`) — the
  React-friendly Locomotive equivalent. Mount once in `(app)`-free landing layout;
  drive GSAP ScrollTrigger from Lenis' scroll callback.
- **Scroll animation:** add **gsap** + **@gsap/react** (`useGSAP`) +
  **ScrollTrigger** (free). SplitText is now free in GSAP 3.13+; if we avoid it,
  replicate per-line reveal with CSS clip + a small split util.
- **Scramble metadata:** small custom hook (no paid plugin needed) that scrambles
  through glyphs to the target string; the CET clock is a `setInterval` updating
  `HH:MM` in the user's TZ. Keep it mono (IBM Plex Mono / `.chrome-meta`).
- **Hero monitor:** a CSS 3D `perspective` + `rotateX/rotateY` frame holding the
  dashboard loop (`<HlsVideo>` already exists, hls.js + native fallback, muted +
  loop). ScrollTrigger scrubs `rotateX` → 0 and `scale` 0.9 → 1 as it enters.
- **"MOVE" parallax:** absolutely-positioned chrome word behind the monitor;
  ScrollTrigger `y` scrub at ~0.5x scroll speed, lower opacity.
- **Work/device sections (light register):** Already flipped Features/Pricing to
  the bright register. Add a "Work" / "In the studio" section with laptop + phone
  mockups playing the looping Pulse clips (see video prompts doc), gold hover frame.
- **Section reveals:** replace/augment the existing dependency-free `Reveal` with
  GSAP ScrollTrigger batch for the per-line rise+clip on `.chrome-display`.

## Build order (proposed)
1. Lenis smooth scroll + GSAP/ScrollTrigger provider on the landing.
2. Hero: SplitText-style headline reveal + "MOVE" parallax + 3D monitor scrub.
3. Scramble mono metadata + live CET clock.
4. Work/device section with looping Pulse dashboard clips + gold hover frames.
5. Per-section heading reveals; respect `prefers-reduced-motion` (disable scrubs).

Deps to add: `lenis`, `gsap`, `@gsap/react`. (hls.js already installed.)
Reduced-motion: gate all scrubbed animations behind
`matchMedia('(prefers-reduced-motion: reduce)')`.
