# Pulse background-loop video prompt (Seedance 2.0 / Higgsfield Motion)

Authored with the `seedance-director` skill for the landing-page background loop.
On-brand (gold/black), abstract enough to keep text readable, with explicit
seamless-loop instructions.

## Prompt (paste into Seedance / Higgsfield Motion, set Loop ON)

```json
{"prompt":"Shot structure: 1 continuous shot, 10s, 16:9 aspect ratio. Style & Mood: Shot on Arri Alexa 65, 35mm. Motivated single warm gold practical low in frame, deep negative fill, near-black void. Kodak Vision3 5219 emulation, rich micro-contrast, soft halation on gold highlights, palette near-black with molten-gold accents only. Dynamic Description: Locked-off camera, no cuts. Fine gold dust particles drift slowly upward through volumetric haze while a faint horizontal band of gold light pulses gently across the lower third like a slow audio waveform, swelling and settling. Motion begins and ends in the same calm resting state for a seamless loop. Static Description: Abstract dark studio void, near-black background, a faint gold horizon line, floating dust, soft golden bokeh. Constraints: avoid jitter, avoid temporal flicker, avoid identity drift, avoid abrupt motion, avoid on-screen text, avoid bright flashes, ensure first and last frames match for a seamless loop."}
```

## Hero studio montage (framed reel in the hero)

A high-end recording-studio montage: multiple angles, slow panning/dolly camera
moves, warm gold lighting to match the brand. Plays in the framed `HeroReel`
(natural color). Drop the file at `public/studio-montage.webm` and set
`STUDIO_MONTAGE_SRC` in `hero.tsx`.

```json
{"prompt":"Shot structure: 4 shots, 14s total, 16:9 aspect ratio. Style & Mood: Shot on Arri Alexa 65, 35mm for room coverage and 85mm for gear close-ups. Motivated warm tungsten and amber practicals, deep negative fill, dark wood and acoustic panels. Kodak Vision3 5219 emulation, rich micro-contrast, soft halation on warm highlights, near-black palette with molten-gold accents. Dynamic Description: Slow dolly forward along a large mixing console, faders and channel lights glinting under a warm key. Hard cut to a slow left-to-right pan across a condenser microphone in a softly lit vocal booth. Cut to a slow tilt up a rack of outboard gear beside glowing studio monitors. Cut to a slow orbit around vintage guitars on a dark wall and a grand piano, dust drifting in a warm light shaft. Static Description: High-end recording studio, mixing console, condenser mic, outboard rack, near-field monitors, instruments, acoustic panels, warm practical lighting, gentle haze. Constraints: avoid jitter, avoid temporal flicker, avoid identity drift, avoid fast motion, avoid people, avoid on-screen text, avoid reflections in glass, keep camera moves slow and smooth."}
```

## How to wire the generated file in

1. Export the loop as `bg-loop.webm` (or `.mp4`) and drop it in `public/`.
2. In `src/components/marketing/hls-video.tsx`, change `DEFAULT_SRC` to
   `"/bg-loop.webm"`. (Plain files are set directly; `.m3u8` URLs stream via
   hls.js.)
3. The backdrop is grayscaled + gold-color-blended in `site-backdrop.tsx`, so
   the loop reads as molten gold on black automatically. Adjust the video
   `opacity` / wash there if you want it more or less present.

## Generate via API instead (optional)

If you set `MUAPI_API_KEY`, the loop can be generated through the MuAPI wrapper
at `~/Documents/seedance-muapi` and dropped in `public/` directly.
