# Pulse background-loop video prompt (Seedance 2.0 / Higgsfield Motion)

Authored with the `seedance-director` skill for the landing-page background loop.
On-brand (gold/black), abstract enough to keep text readable, with explicit
seamless-loop instructions.

## Prompt (paste into Seedance / Higgsfield Motion, set Loop ON)

```json
{"prompt":"Shot structure: 1 continuous shot, 10s, 16:9 aspect ratio. Style & Mood: Shot on Arri Alexa 65, 35mm. Motivated single warm gold practical low in frame, deep negative fill, near-black void. Kodak Vision3 5219 emulation, rich micro-contrast, soft halation on gold highlights, palette near-black with molten-gold accents only. Dynamic Description: Locked-off camera, no cuts. Fine gold dust particles drift slowly upward through volumetric haze while a faint horizontal band of gold light pulses gently across the lower third like a slow audio waveform, swelling and settling. Motion begins and ends in the same calm resting state for a seamless loop. Static Description: Abstract dark studio void, near-black background, a faint gold horizon line, floating dust, soft golden bokeh. Constraints: avoid jitter, avoid temporal flicker, avoid identity drift, avoid abrupt motion, avoid on-screen text, avoid bright flashes, ensure first and last frames match for a seamless loop."}
```

## Hero studio montage (framed reel in the hero)

A high-end recording-studio montage: **photorealistic, RED camera grade, film
texture, low-key cinematic lighting**, warm amber/gold on near-black to match
the brand. Best made as 4 short clips (one per angle) then stitched, since one
AI clip = one continuous shot. Plays in the framed `HeroReel` (natural color).
Stitch to `public/studio-montage.webm` and set `STUDIO_MONTAGE_SRC` in `hero.tsx`.

### Single 15s multi-shot prompt (Text-to-Video, 16:9, 15s, slow/low motion)

Use this when the tier supports a ~14-15s clip. If duration caps shorter or the
cuts look rough, fall back to the per-shot prompts below and stitch.

NOTE: filter-safe wording. Higgsfield NSFW false-positives trip on "shaft",
"diaphragm", "rim light", "shot/shots" - all swapped out below. If it still
flags, replace the RED line with "Filmed on a cinema camera, RAW, professional
cinema color science" (the token "RED" can read as blood/violence).

```
Photorealistic 15-second cinematic montage of a high-end recording studio, four scenes with hard cuts, low-key cinematic lighting throughout, warm amber practical lights on a near-black scene with molten-gold highlights, deep textured shadows, gentle haze.

[0-4s] Slow dolly forward along a large mixing console, faders and channel lights glinting under a single warm amber key light.
[4-8s] Hard cut to a slow left-to-right pan across a classic studio microphone in a dim vocal recording room, warm edge light on the grille, dark acoustic panels behind.
[8-11s] Hard cut to a slow tilt up a rack of outboard audio gear with glowing meters beside near-field monitor speakers.
[11-15s] Hard cut to a slow orbit around vintage guitars on a dark wall and a grand piano, dust drifting through one warm beam of light.

Filmed on RED V-Raptor 8K, REDCODE RAW, RED IPP2 color science, vintage cine prime lens, fine 35mm film grain and organic texture, shallow depth of field. Slow, smooth camera moves only. No people.
```

### Per-shot prompts (Text-to-Video, 16:9, 4-5s each, slow/low motion) - stitch to ~15s

Avoid: people, on-screen text, fast motion, flicker, warped gear, glass
reflections, plasticky/CGI look.

**Shot 1 - console (slow dolly in):**
```
Photorealistic cinematic scene of a high-end recording studio mixing console, slow dolly forward along the channel strip, faders and channel lights glinting. Low-key cinematic lighting from a single warm amber practical, deep textured shadows, dark wood and acoustic panels, gentle haze. Filmed on RED V-Raptor 8K, REDCODE RAW, RED IPP2 color science, vintage cine prime lens, fine 35mm film grain and organic texture, shallow depth of field, near-black scene with molten-gold highlights. Slow, smooth camera. No people.
```

**Shot 2 - vocal mic (slow left-to-right pan):**
```
Photorealistic cinematic close-up of a classic studio microphone in a dim vocal booth, slow left-to-right pan across the mic, low-key lighting from a single warm amber source, warm edge light on the grille, dark acoustic panels behind, deep shadows. Filmed on RED V-Raptor 8K, REDCODE RAW, RED IPP2 color science, vintage cine prime lens, fine film grain and organic texture, shallow depth of field, near-black background. Slow, smooth camera. No people.
```

**Shot 3 - outboard rack + monitors (slow tilt up):**
```
Photorealistic cinematic scene of a rack of outboard studio gear with glowing VU meters beside near-field monitor speakers, slow tilt up the rack, low-key cinematic lighting, deep shadows, warm amber glow on the meters, gentle haze, near-black scene with molten-gold highlights. Filmed on RED V-Raptor 8K, REDCODE RAW, RED IPP2 color science, vintage cine prime lens, fine 35mm film grain and organic texture, shallow depth of field. Slow, smooth camera. No people.
```

**Shot 4 - instruments (slow orbit):**
```
Photorealistic cinematic scene of vintage guitars on a dark studio wall and a grand piano, slow orbit around the instruments, low-key lighting with one warm beam of light and dust drifting through it, deep textured shadows, molten-gold highlights, near-black background. Filmed on RED V-Raptor 8K, REDCODE RAW, RED IPP2 color science, vintage cine prime lens, fine film grain and organic texture, shallow depth of field. Slow, smooth camera. No people.
```

**Fallback - single clip:**
```
Photorealistic cinematic slow dolly through a dim high-end recording studio: past a large mixing console with glowing faders, toward a classic studio microphone in a small pool of warm amber light. Low-key cinematic lighting, deep textured shadows, dark wood and acoustic panels, gentle haze, near-black scene with molten-gold highlights, shallow depth of field. Filmed on RED V-Raptor 8K, REDCODE RAW, RED IPP2 color science, vintage cine prime lens, fine 35mm film grain and organic texture. Slow, smooth camera, no cuts. No people.
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
