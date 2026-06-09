# Pulse landing — video prompts (Higgsfield / Seedance)

Looping, muted clips for the chrome/Dylanbrouwer redesign. Match the reference's
look + motion: monolithic chrome, black→fog gradient void, slow confident camera,
shallow depth of field, **gold #FDB913 as the only accent** (no orange), seamless
loop. Render in Higgsfield Motion (Loop ON, audio OFF) or Seedance 2.0.

> Note on the literal dashboard: AI video can't faithfully render the real Pulse
> UI (it hallucinates UI). For the monitor screen, the highest-fidelity option is
> a real **screen recording** of the dashboard composited into the monitor. The
> prompts below give a strong AI alternative — cinematic *studio* b-roll that
> reads as "what Pulse runs" — plus an abstract gold data-motion fallback.

---

## 1. HERO MONITOR LOOP (16:9) — studio in motion
What plays inside the 3D-tilted monitor in the hero. Premium, calm, on-brand.

```json
{"prompt":"Shot structure: 1 continuous shot, 10s, 16:9 aspect ratio. Style & Mood: Shot on Arri Alexa 65, 35mm. Motivated practical light from studio monitors and a single warm gold key, deep negative fill, near-black room. Kodak Vision3 5219 emulation, rich micro-contrast, soft halation on the gold sources, achromatic palette with one warm gold accent. Dynamic Description: Slow dolly-in across a darkened recording studio control room, a large mixing console with channel lights glowing faint gold, fader caps catching light, a microphone and acoustic panels softening into shallow-focus bokeh behind. The move is smooth, locked and confident, settling without stopping for a seamless loop. Static Description: Pro studio control room, console, monitor speakers, cabling, acoustic foam, dust motes drifting in the key light. Constraints: avoid jitter, avoid temporal flicker, avoid text on screens, avoid readable UI, avoid identity drift, avoid morphing geometry, avoid any color other than warm gold accents."}
```

## 2. AMBIENT SITE BACKDROP LOOP (16:9) — molten gold on black
Sits fixed behind the whole site, very subtle, must stay text-safe.

```json
{"prompt":"Shot structure: 1 continuous shot, 12s, 16:9 aspect ratio. Style & Mood: Shot on Panavision Millennium DXL2, 50mm macro. Single raking gold key into deep black, heavy negative fill. Kodak Vision3 5219 emulation, gentle halation, almost monochrome black with molten-gold highlights only. Dynamic Description: Extremely slow drift across a dark liquid-metal surface, soft gold light blooming and ebbing like molten metal cooling, low contrast, no hard edges, motion barely perceptible so headline text stays readable on top. Loops seamlessly. Static Description: Abstract dark fluid-metal field, fine grain, soft volumetric glow, no objects, no horizon. Constraints: avoid jitter, avoid temporal flicker, avoid bright flashes, avoid high contrast, avoid recognizable shapes, avoid any color other than gold, keep center low-contrast for text legibility."}
```

## 3. WORK LAPTOP LOOP (16:9) — a session running
For the light "work" section laptop mockup. Reads as studio operations.

```json
{"prompt":"Shot structure: 1 continuous shot, 8s, 16:9 aspect ratio. Style & Mood: Shot on Arri Alexa 65, 50mm. Soft daylight key from frame left, clean bright bounce, airy. Kodak Vision3 5219 emulation, natural tones, light and premium, achromatic with subtle gold accents. Dynamic Description: Slow push-in over a bright minimal desk as a recording session is underway in the background, a hand resting near a keyboard, a coffee and a small studio plant in shallow-focus foreground, calm and unhurried, settling for a seamless loop. Static Description: Bright modern studio office, light desk, laptop (screen angled away from camera, no readable UI), warm neutral surfaces. Constraints: avoid jitter, avoid temporal flicker, avoid readable screen text, avoid logos, avoid identity drift, avoid extra fingers, avoid any color other than soft gold accents."}
```

## 4. WORK PHONE LOOP (9:16) — booking notification
For the phone mockup; vertical. Calm, premium, gold accent.

```json
{"prompt":"Shot structure: 1 continuous shot, 6s, 9:16 aspect ratio. Style & Mood: Shot on Arri Alexa 65, 85mm. Soft window key, shallow depth of field. Kodak Vision3 5219 emulation, clean natural tones, achromatic with one gold accent. Dynamic Description: A phone held in one hand in a bright studio lounge, slow gentle handheld-stabilized float, a soft gold glow pulses once at the top edge of the device as if a booking lands, foreground and background dropping into creamy bokeh. Loops seamlessly. Static Description: Bright studio lounge, light couch, blurred acoustic panels, phone with screen angled to avoid readable UI. Constraints: avoid jitter, avoid temporal flicker, avoid readable UI text, avoid identity drift, avoid extra fingers, avoid wardrobe changes, avoid any color other than gold."}
```

---

## Higgsfield render settings
- **Loop:** ON · **Audio:** OFF/muted · **Duration:** as noted · **Motion:** low/medium.
- Export `.webm` (or `.mp4`), drop into `public/`:
  - `public/hero-monitor.webm` → hero monitor
  - `public/bg-loop.webm` → SiteBackdrop (swap `DEFAULT_SRC` in `hls-video.tsx`)
  - `public/work-laptop.webm`, `public/work-phone.webm` → work section
- Keep each under ~6 MB; grayscale/gold-tint is applied in CSS, so render natural.
