# Pulse Launch Ad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Remotion project at `pulse/marketing/remotion/` that renders three cuts (15s 9:16 hook, 30s 1:1 social, 75s 16:9 hero) of a brand-hype Pulse launch ad sharing one scene system.

**Architecture:** One `<Ad cut=...>` component composes responsive scenes (ColdOpen→Chaos→Turn→AugmentedShowcase→DataViz→Payoff→CTA) via `@remotion/transitions`. AugmentedShowcase renders real UI as 3D-posed augmented windows with a tilted 3D menu and animated button-click cursor; DataViz renders animated gold charts. A single `cuts.ts` config decides which scenes appear and for how many frames per cut. Scenes read `useVideoConfig()` so the same code serves all three aspect ratios. A recurring gold pulse-line motif threads the piece. Brand tokens come verbatim from `pulse/src/app/globals.css`.

**Tech Stack:** Remotion 4.0.465, React 18, `@remotion/cli`/`transitions`/`google-fonts`/`media`, TypeScript 5. Node 22 required for all Remotion commands (`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`).

**Critical gotchas (from `reference_remotion_setup` memory):**
- All `<Composition>` prop types declared with `type`, never `interface`.
- Every Remotion command needs Node 22 on PATH; system Node 25 fails.

---

## File Structure

```
pulse/marketing/remotion/
  package.json
  remotion.config.ts
  tsconfig.json
  copy-assets.mjs
  public/                 # populated by copy-assets.mjs (logo + screenshots)
  out/                    # render output (gitignored)
  .gitignore
  src/
    index.ts              # registerRoot(Root)
    Root.tsx              # 3 Compositions -> <Ad cut=...>
    theme.ts              # tokens + pacing constants + fonts
    cuts.ts               # per-cut scene/timing config
    Ad.tsx                # scene composer (TransitionSeries)
    copy.ts               # all on-screen copy strings + menu items + chart data
    components/
      PulseLine.tsx
      KineticText.tsx
      GlassFrame.tsx       # 2D glass frame (compact cuts)
      CountUp.tsx
      Stage3D.tsx          # perspective container + camera drift
      Window3D.tsx         # screenshot posed as a 3D glass panel
      Menu3D.tsx           # tilted nav panel, items stagger-pop
      ClickCursor.tsx      # cursor glide + gold press ripple
      BarChart.tsx         # animated gold bars
      LineChart.tsx        # gold area/line path draw
    scenes/
      ColdOpen.tsx
      Chaos.tsx
      Turn.tsx
      AugmentedShowcase.tsx  # 3D windows + menu + button clicks
      DataViz.tsx            # animated charts
      Payoff.tsx
      CTA.tsx
  VO-SCRIPT.md
```

All commands below assume CWD `pulse/marketing/remotion/` and `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` already run in the shell.

---

## Task 1: Scaffold the project

**Files:**
- Create: `pulse/marketing/remotion/package.json`
- Create: `pulse/marketing/remotion/tsconfig.json`
- Create: `pulse/marketing/remotion/remotion.config.ts`
- Create: `pulse/marketing/remotion/.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pulse-launch-ad",
  "version": "1.0.0",
  "private": true,
  "description": "Brand-hype launch ad for Pulse, three cuts, Remotion.",
  "scripts": {
    "copy-assets": "node copy-assets.mjs",
    "studio": "remotion studio",
    "still": "remotion still",
    "render:hook": "remotion render src/index.ts Hook out/pulse-hook.mp4",
    "render:social": "remotion render src/index.ts Social out/pulse-social.mp4",
    "render:hero": "remotion render src/index.ts Hero out/pulse-hero.mp4",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@remotion/cli": "4.0.465",
    "@remotion/google-fonts": "4.0.465",
    "@remotion/media": "4.0.465",
    "@remotion/transitions": "4.0.465",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "remotion": "4.0.465"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "^5.5.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "remotion.config.ts"]
}
```

- [ ] **Step 3: Create `remotion.config.ts`**

```ts
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// H.264 mp4 by default; quality bump for hero crispness.
Config.setCodec("h264");
Config.setCrf(18);
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
out/
public/pulse-logo.png
public/shots/
```

> Screenshots + logo are copied from the parent app at build time, so they are not committed in this subfolder (they already live in the Pulse repo).

- [ ] **Step 5: Install + verify lockstep**

```bash
cd "pulse/marketing/remotion" && npm install
npx remotion versions
```
Expected: "All packages have the correct version." at 4.0.465.

- [ ] **Step 6: Commit**

```bash
git add pulse/marketing/remotion/package.json pulse/marketing/remotion/package-lock.json pulse/marketing/remotion/tsconfig.json pulse/marketing/remotion/remotion.config.ts pulse/marketing/remotion/.gitignore
git commit -m "chore(ad): scaffold Pulse launch-ad Remotion project"
```

---

## Task 2: Asset copy script + theme tokens

**Files:**
- Create: `pulse/marketing/remotion/copy-assets.mjs`
- Create: `pulse/marketing/remotion/src/theme.ts`

- [ ] **Step 1: Create `copy-assets.mjs`**

```js
// Copies the Pulse logo + UI screenshots from the parent app into public/
// so the Remotion project is self-contained at render time.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");          // pulse/
const pub = join(here, "public");
const shotsOut = join(pub, "shots");
mkdirSync(shotsOut, { recursive: true });

copyFileSync(join(repo, "public", "pulse-logo.png"), join(pub, "pulse-logo.png"));

const shots = ["dashboard", "bookings", "inventory", "studio", "agency", "book", "live"];
for (const s of shots) {
  const src = join(repo, ".shots", `${s}.png`);
  if (existsSync(src)) copyFileSync(src, join(shotsOut, `${s}.png`));
  else console.warn(`warn: missing shot ${src}`);
}
console.log("assets copied -> public/");
```

- [ ] **Step 2: Run it**

```bash
npm run copy-assets
ls public public/shots
```
Expected: `pulse-logo.png` in `public/`, 5–7 png files in `public/shots/`.

- [ ] **Step 3: Create `src/theme.ts`**

```ts
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";

export const inter = loadInter();
export const grotesk = loadGrotesk();

// Pulse tokens — verbatim from pulse/src/app/globals.css.
export const C = {
  ink: "#08080a",
  coal: "#141417",
  coal2: "#1a1a1f",
  hairline: "#2b2b32",
  hairline2: "#383840",
  gold: "#fdb913",
  goldBright: "#ffd24a",
  goldDeep: "#c98a00",
  goldInk: "#241900",
  bone: "#f6f6f5",
  ash: "#a3a3ad",
  critical: "#ff5d5d",
} as const;

export const display = grotesk.fontFamily; // headlines
export const body = inter.fontFamily; // supporting

export const FPS = 30;
export const BREATH = 36; // held frames before first motion (brand-dna principle 5)

// beat length in frames for a given bpm (cuts land on beats)
export const beatFrames = (bpm = 120) => Math.round((60 / bpm) * FPS);

export const GOLD_GLOW =
  "0 0 0 1px rgba(253,185,19,.35), 0 10px 40px rgba(253,185,19,.18)";
export const BRUTAL_GOLD = `5px 5px 0 0 ${C.gold}`;
```

- [ ] **Step 4: Commit**

```bash
git add pulse/marketing/remotion/copy-assets.mjs pulse/marketing/remotion/src/theme.ts
git commit -m "feat(ad): asset copy script + Pulse theme tokens/fonts"
```

---

## Task 3: PulseLine motif component

**Files:**
- Create: `pulse/marketing/remotion/src/components/PulseLine.tsx`

- [ ] **Step 1: Create `PulseLine.tsx`**

```tsx
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, beatFrames } from "../theme";

// The recurring gold heartbeat. mode="flat" draws a calm line that
// progressively reveals; mode="beat" pulses an ECG-style spike on each beat.
export type PulseLineProps = {
  mode?: "flat" | "beat";
  bpm?: number;
  strokeWidth?: number;
  color?: string;
  heightFrac?: number; // vertical span as fraction of canvas height
};

export const PulseLine: React.FC<PulseLineProps> = ({
  mode = "flat",
  bpm = 120,
  strokeWidth = 4,
  color = C.gold,
  heightFrac = 0.18,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const midY = height / 2;
  const amp = (height * heightFrac) / 2;
  const beat = beatFrames(bpm);

  // Flat reveal: dash offset animates a left-to-right draw over 20 frames.
  const reveal = interpolate(frame, [0, 20], [width, 0], {
    extrapolateRight: "clamp",
  });

  // ECG path: flat with a spike centered, repeating each beat.
  const phase = (frame % beat) / beat; // 0..1 within a beat
  const spikeY =
    mode === "beat"
      ? midY -
        amp *
          Math.exp(-Math.pow((phase - 0.5) * 10, 2)) *
          Math.sin(phase * Math.PI * 2)
      : midY;

  const d =
    mode === "beat"
      ? `M0 ${midY} L${width * 0.42} ${midY} L${width * 0.46} ${spikeY} L${
          width * 0.5
        } ${midY + (midY - spikeY)} L${width * 0.54} ${midY} L${width} ${midY}`
      : `M0 ${midY} L${width} ${midY}`;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0 }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={mode === "flat" ? width : undefined}
        strokeDashoffset={mode === "flat" ? reveal : undefined}
        style={{ filter: `drop-shadow(0 0 12px ${color}88)` }}
      />
    </svg>
  );
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors. (If `SpaceGrotesk` import path errors, confirm the package export with `ls node_modules/@remotion/google-fonts/dist/` and adjust the import name.)

- [ ] **Step 3: Commit**

```bash
git add pulse/marketing/remotion/src/components/PulseLine.tsx
git commit -m "feat(ad): gold pulse-line motif component"
```

---

## Task 4: KineticText, GlassFrame, CountUp components

**Files:**
- Create: `pulse/marketing/remotion/src/components/KineticText.tsx`
- Create: `pulse/marketing/remotion/src/components/GlassFrame.tsx`
- Create: `pulse/marketing/remotion/src/components/CountUp.tsx`

- [ ] **Step 1: Create `KineticText.tsx`**

```tsx
import { interpolate, useCurrentFrame } from "remotion";
import { C, display } from "../theme";

// Fade + 2px rise (brand-dna motion rule). Gold key words via <b>.
export type KineticTextProps = {
  text: string;
  delay?: number;
  sizeVw?: number; // font-size as % of viewport width
  align?: "left" | "center";
  gold?: boolean;
};

export const KineticText: React.FC<KineticTextProps> = ({
  text,
  delay = 0,
  sizeVw = 6,
  align = "center",
  gold = false,
}) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const opacity = interpolate(t, [0, 8], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const y = interpolate(t, [0, 8], [12, 0], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        fontFamily: display,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color: gold ? C.gold : C.bone,
        fontSize: `${sizeVw}vw`,
        lineHeight: 1.05,
        textAlign: align,
        maxWidth: "84%",
      }}
    >
      {text}
    </div>
  );
};
```

- [ ] **Step 2: Create `GlassFrame.tsx`**

```tsx
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, GOLD_GLOW } from "../theme";

// Frames a UI screenshot in Pulse glass with a slow parallax drift + scale-in.
export type GlassFrameProps = {
  shot: string; // filename in public/shots, e.g. "dashboard.png"
  delay?: number;
  widthFrac?: number; // frame width as fraction of canvas width
  drift?: number; // px of parallax over the scene
};

export const GlassFrame: React.FC<GlassFrameProps> = ({
  shot,
  delay = 0,
  widthFrac = 0.62,
  drift = 24,
}) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const scale = interpolate(t, [0, 16], [0.96, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const opacity = interpolate(t, [0, 10], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const y = interpolate(t, [0, 120], [drift, -drift], { extrapolateLeft: "clamp" });
  return (
    <div
      style={{
        position: "relative",
        width: `${widthFrac * 100}%`,
        transform: `translateY(${y}px) scale(${scale})`,
        opacity,
        borderRadius: 18,
        overflow: "hidden",
        border: `1px solid ${C.hairline2}`,
        boxShadow: GOLD_GLOW,
        background: C.coal2,
      }}
    >
      <Img src={staticFile(`shots/${shot}`)} style={{ width: "100%", display: "block" }} />
    </div>
  );
};
```

- [ ] **Step 3: Create `CountUp.tsx`**

```tsx
import { interpolate, useCurrentFrame } from "remotion";
import { C, display } from "../theme";

// Sparingly used. Counts 0 -> value. Caller supplies an honest suffix label.
export type CountUpProps = {
  value: number;
  suffix?: string;
  delay?: number;
  sizeVw?: number;
};

export const CountUp: React.FC<CountUpProps> = ({ value, suffix = "", delay = 0, sizeVw = 9 }) => {
  const frame = useCurrentFrame();
  const n = Math.round(interpolate(frame - delay, [0, 24], [0, value], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  return (
    <span style={{ fontFamily: display, fontWeight: 700, color: C.gold, fontSize: `${sizeVw}vw`, letterSpacing: "-0.02em" }}>
      {n}
      {suffix}
    </span>
  );
};
```

- [ ] **Step 4: Typecheck + commit**

```bash
npm run typecheck
git add pulse/marketing/remotion/src/components/
git commit -m "feat(ad): kinetic text, glass frame, count-up components"
```

---

## Task 4b: 3D + chart + cursor components

**Files:**
- Create: `pulse/marketing/remotion/src/components/Stage3D.tsx`
- Create: `pulse/marketing/remotion/src/components/Window3D.tsx`
- Create: `pulse/marketing/remotion/src/components/Menu3D.tsx`
- Create: `pulse/marketing/remotion/src/components/ClickCursor.tsx`
- Create: `pulse/marketing/remotion/src/components/BarChart.tsx`
- Create: `pulse/marketing/remotion/src/components/LineChart.tsx`

- [ ] **Step 1: Create `Stage3D.tsx`** (perspective container + slow camera drift)

```tsx
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

export type Stage3DProps = { children: React.ReactNode; perspective?: number; drift?: number };

export const Stage3D: React.FC<Stage3DProps> = ({ children, perspective = 1500, drift = 6 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const ry = interpolate(frame, [0, durationInFrames], [-drift, drift]);
  const rx = interpolate(frame, [0, durationInFrames], [drift / 2, -drift / 2]);
  return (
    <AbsoluteFill style={{ perspective, alignItems: "center", justifyContent: "center" }}>
      <div style={{ transformStyle: "preserve-3d", transform: `rotateY(${ry}deg) rotateX(${rx}deg)`, position: "relative", width: "100%", height: "100%" }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Create `Window3D.tsx`** (screenshot posed as a 3D glass panel, gentle float)

```tsx
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, GOLD_GLOW } from "../theme";

export type Window3DProps = {
  shot: string;
  delay?: number;
  x?: number; y?: number; z?: number;
  rotateY?: number; rotateX?: number;
  widthFrac?: number;
};

export const Window3D: React.FC<Window3DProps> = ({ shot, delay = 0, x = 0, y = 0, z = 0, rotateY = 0, rotateX = 0, widthFrac = 0.5 }) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const enter = interpolate(t, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const float = Math.sin((frame + delay) / 30) * 6;
  const scale = interpolate(enter, [0, 1], [0.9, 1]);
  return (
    <div style={{
      position: "absolute",
      width: `${widthFrac * 100}%`,
      transform: `translate3d(${x}px, ${y + float}px, ${z * enter}px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${scale})`,
      opacity: enter,
      borderRadius: 16,
      overflow: "hidden",
      border: `1px solid ${C.hairline2}`,
      boxShadow: GOLD_GLOW,
      background: C.coal2,
      transformStyle: "preserve-3d",
    }}>
      <Img src={staticFile(`shots/${shot}`)} style={{ width: "100%", display: "block" }} />
    </div>
  );
};
```

- [ ] **Step 3: Create `Menu3D.tsx`** (tilted nav, items stagger-pop on translateZ, one active)

```tsx
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, body } from "../theme";

export type Menu3DProps = { items: string[]; delay?: number; activeIndex?: number };

export const Menu3D: React.FC<Menu3DProps> = ({ items, delay = 0, activeIndex = -1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{
      position: "absolute", transform: "rotateY(-20deg) rotateX(4deg)", transformStyle: "preserve-3d",
      background: `${C.coal}cc`, border: `1px solid ${C.hairline2}`, borderRadius: 14, padding: "1.4vw 1.2vw", backdropFilter: "blur(8px)",
    }}>
      {items.map((it, i) => {
        const p = spring({ frame: frame - delay - i * 4, fps, config: { damping: 14, stiffness: 180 } });
        const active = i === activeIndex;
        return (
          <div key={it} style={{
            fontFamily: body, fontWeight: active ? 700 : 500,
            color: active ? C.gold : C.bone, fontSize: "1.6vw",
            padding: "0.7vw 1vw", marginBottom: 4, borderRadius: 8,
            background: active ? `${C.gold}22` : "transparent",
            opacity: p, transform: `translateZ(${interpolate(p, [0, 1], [0, 30])}px)`,
          }}>{it}</div>
        );
      })}
    </div>
  );
};
```

- [ ] **Step 4: Create `ClickCursor.tsx`** (cursor glides to a target, gold press ripple)

```tsx
import { interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

// from/to are [x%, y%] of the parent. Cursor glides start->clickAt, then ripples.
export type ClickCursorProps = { from: [number, number]; to: [number, number]; start?: number; clickAt: number };

export const ClickCursor: React.FC<ClickCursorProps> = ({ from, to, start = 0, clickAt }) => {
  const frame = useCurrentFrame();
  const px = interpolate(frame, [start, clickAt], [from[0], to[0]], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const py = interpolate(frame, [start, clickAt], [from[1], to[1]], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const press = interpolate(frame, [clickAt - 2, clickAt, clickAt + 4], [1, 0.8, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ripple = interpolate(frame, [clickAt, clickAt + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: `${px}%`, top: `${py}%`, transform: "translate(-50%,-50%)", zIndex: 10 }}>
      {frame >= clickAt ? (
        <div style={{ position: "absolute", left: 0, top: 0, transform: "translate(-50%,-50%)", width: 60 * ripple, height: 60 * ripple, borderRadius: "50%", border: `2px solid ${C.gold}`, opacity: 1 - ripple }} />
      ) : null}
      <div style={{ width: 22, height: 22, transform: `scale(${press})` }}>
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l16 9-7 2-3 7z" fill={C.bone} stroke={C.ink} strokeWidth="1.5" /></svg>
      </div>
    </div>
  );
};
```

- [ ] **Step 5: Create `BarChart.tsx`** (gold bars grow)

```tsx
import { interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

export type BarChartProps = { values: number[]; delay?: number; width?: number; height?: number };

export const BarChart: React.FC<BarChartProps> = ({ values, delay = 0, width = 520, height = 280 }) => {
  const frame = useCurrentFrame();
  const max = Math.max(...values);
  const bw = width / (values.length * 1.6);
  return (
    <svg width={width} height={height}>
      {values.map((v, i) => {
        const g = interpolate(frame - delay - i * 3, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const h = (v / max) * (height - 20) * g;
        return <rect key={i} x={i * bw * 1.6 + bw * 0.3} y={height - h} width={bw} height={h} rx={4} fill={C.gold} opacity={0.9} />;
      })}
    </svg>
  );
};
```

- [ ] **Step 6: Create `LineChart.tsx`** (gold area/line draws in)

```tsx
import { interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

export type LineChartProps = { values: number[]; delay?: number; width?: number; height?: number };

export const LineChart: React.FC<LineChartProps> = ({ values, delay = 0, width = 560, height = 260 }) => {
  const frame = useCurrentFrame();
  const max = Math.max(...values);
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - (v / max) * (height - 20)] as const);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
  const len = 2000;
  const draw = interpolate(frame - delay, [0, 40], [len, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <svg width={width} height={height}>
      <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={`${C.gold}18`} />
      <path d={d} fill="none" stroke={C.gold} strokeWidth={4} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={draw} style={{ filter: `drop-shadow(0 0 10px ${C.gold}88)` }} />
    </svg>
  );
};
```

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add pulse/marketing/remotion/src/components/
git commit -m "feat(ad): 3D stage/window/menu, click cursor, bar + line charts"
```

---

## Task 5: copy.ts, cuts.ts, Ad.tsx, Root.tsx, index.ts (renderable skeleton)

**Files:**
- Create: `pulse/marketing/remotion/src/copy.ts`
- Create: `pulse/marketing/remotion/src/cuts.ts`
- Create: `pulse/marketing/remotion/src/Ad.tsx`
- Create: `pulse/marketing/remotion/src/Root.tsx`
- Create: `pulse/marketing/remotion/src/index.ts`

This task wires everything with placeholder scene bodies (a labeled `AbsoluteFill`) so Studio runs and all three compositions register; real scenes land in Tasks 6–11.

- [ ] **Step 1: Create `copy.ts`**

```ts
// All on-screen copy in one place.
export const COPY = {
  coldOpen: "Your studio runs on chaos.",
  chaos: ["Spreadsheets.", "Unpaid invoices.", "Lost files.", "Endless DMs."],
  turn: "Meet Pulse.",
  // 3D nav menu shown in the augmented showcase.
  menu: ["Songs", "Sessions", "Releases", "Payments", "Roster"],
  // Augmented windows: which screenshot floats at which 3D pose, + its label.
  windows: [
    { shot: "dashboard.png", label: "Every song, one pipeline." },
    { shot: "bookings.png", label: "Every session, booked." },
    { shot: "studio.png", label: "Every release, on track." },
    { shot: "inventory.png", label: "Every dollar, accounted for." },
    { shot: "agency.png", label: "Every studio, one roof." },
  ],
  dataViz: {
    headline: "Watch the catalog grow.",
    bars: [3, 5, 4, 7, 6, 9, 8, 11],   // illustrative, not a real KPI
    line: [2, 3, 3, 5, 6, 6, 8, 10, 12],
  },
  payoff: "One place. Every song. Every session. Every dollar.",
  ctaTagline: "The studio CRM built for producers, not spreadsheets.",
  ctaUrl: "pulse.studio",
} as const;
```

- [ ] **Step 2: Create `cuts.ts`**

```ts
import { FPS } from "./theme";

export type SceneKey = "coldOpen" | "chaos" | "turn" | "augmentedShowcase" | "dataViz" | "payoff" | "cta";
export type CutId = "hook" | "social" | "hero";

export type SceneSpec = { key: SceneKey; frames: number; data?: number[] };
export type CutConfig = {
  id: CutId;
  width: number;
  height: number;
  fps: number;
  scenes: SceneSpec[];
};

const s = (sec: number) => Math.round(sec * FPS);

// data on augmentedShowcase = indices into COPY.windows to feature.
export const CUTS: Record<CutId, CutConfig> = {
  hook: {
    id: "hook",
    width: 1080,
    height: 1920,
    fps: FPS,
    scenes: [
      { key: "coldOpen", frames: s(3) },
      { key: "turn", frames: s(2.5) },
      { key: "augmentedShowcase", frames: s(6.5), data: [0] },
      { key: "cta", frames: s(3) },
    ],
  },
  social: {
    id: "social",
    width: 1080,
    height: 1080,
    fps: FPS,
    scenes: [
      { key: "coldOpen", frames: s(3.5) },
      { key: "chaos", frames: s(3.5) },
      { key: "turn", frames: s(3.5) },
      { key: "augmentedShowcase", frames: s(9), data: [0, 1, 3] },
      { key: "dataViz", frames: s(3.5) },
      { key: "payoff", frames: s(3) },
      { key: "cta", frames: s(4) },
    ],
  },
  hero: {
    id: "hero",
    width: 1920,
    height: 1080,
    fps: FPS,
    scenes: [
      { key: "coldOpen", frames: s(6) },
      { key: "chaos", frames: s(8) },
      { key: "turn", frames: s(6) },
      { key: "augmentedShowcase", frames: s(28), data: [0, 1, 2, 3, 4] },
      { key: "dataViz", frames: s(9) },
      { key: "payoff", frames: s(7) },
      { key: "cta", frames: s(11) },
    ],
  },
};

export const totalFrames = (c: CutConfig) => c.scenes.reduce((n, sc) => n + sc.frames, 0);
```

- [ ] **Step 3: Create `Ad.tsx`**

```tsx
import { AbsoluteFill } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { CUTS, CutId, SceneKey } from "./cuts";
import { C } from "./theme";
import { ColdOpen } from "./scenes/ColdOpen";
import { Chaos } from "./scenes/Chaos";
import { Turn } from "./scenes/Turn";
import { AugmentedShowcase } from "./scenes/AugmentedShowcase";
import { DataViz } from "./scenes/DataViz";
import { Payoff } from "./scenes/Payoff";
import { CTA } from "./scenes/CTA";

const SCENES: Record<SceneKey, React.FC<{ data?: number[] }>> = {
  coldOpen: ColdOpen,
  chaos: Chaos,
  turn: Turn,
  augmentedShowcase: AugmentedShowcase,
  dataViz: DataViz,
  payoff: Payoff,
  cta: CTA,
};

export type AdProps = { cut: CutId };

export const Ad: React.FC<AdProps> = ({ cut }) => {
  const config = CUTS[cut];
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <TransitionSeries>
        {config.scenes.map((sc, i) => {
          const Scene = SCENES[sc.key];
          return (
            <>
              <TransitionSeries.Sequence key={`s${i}`} durationInFrames={sc.frames}>
                <Scene data={sc.data} />
              </TransitionSeries.Sequence>
              {i < config.scenes.length - 1 ? (
                <TransitionSeries.Transition
                  key={`t${i}`}
                  presentation={fade()}
                  timing={linearTiming({ durationInFrames: 8 })}
                />
              ) : null}
            </>
          );
        })}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
```

> Note: `TransitionSeries` children must alternate Sequence/Transition. The fragment-with-keys pattern above is valid; if Remotion complains about fragments, flatten into an array built before the return.

- [ ] **Step 4: Create placeholder scenes so the skeleton renders**

Create each of `src/scenes/{ColdOpen,Chaos,Turn,AugmentedShowcase,DataViz,Payoff,CTA}.tsx` with this minimal body (substitute the name):

```tsx
import { AbsoluteFill } from "remotion";
import { C, display } from "../theme";

export const ColdOpen: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", backgroundColor: C.ink }}>
    <div style={{ fontFamily: display, color: C.ash, fontSize: "3vw" }}>ColdOpen</div>
  </AbsoluteFill>
);
```

- [ ] **Step 5: Create `Root.tsx`**

```tsx
import { Composition } from "remotion";
import { Ad } from "./Ad";
import { CUTS, totalFrames } from "./cuts";

export const Root: React.FC = () => (
  <>
    <Composition
      id="Hook"
      component={Ad}
      durationInFrames={totalFrames(CUTS.hook)}
      fps={CUTS.hook.fps}
      width={CUTS.hook.width}
      height={CUTS.hook.height}
      defaultProps={{ cut: "hook" as const }}
    />
    <Composition
      id="Social"
      component={Ad}
      durationInFrames={totalFrames(CUTS.social)}
      fps={CUTS.social.fps}
      width={CUTS.social.width}
      height={CUTS.social.height}
      defaultProps={{ cut: "social" as const }}
    />
    <Composition
      id="Hero"
      component={Ad}
      durationInFrames={totalFrames(CUTS.hero)}
      fps={CUTS.hero.fps}
      width={CUTS.hero.width}
      height={CUTS.hero.height}
      defaultProps={{ cut: "hero" as const }}
    />
  </>
);
```

- [ ] **Step 6: Create `index.ts`**

```ts
import { registerRoot } from "remotion";
import { Root } from "./Root";

registerRoot(Root);
```

- [ ] **Step 7: Typecheck + still snapshot of each composition**

```bash
npm run typecheck
npx remotion still src/index.ts Hook out/hook-skel.png --frame=10
npx remotion still src/index.ts Social out/social-skel.png --frame=10
npx remotion still src/index.ts Hero out/hero-skel.png --frame=10
```
Expected: tsc clean; three pngs produced showing placeholder labels on ink background.

- [ ] **Step 8: Commit**

```bash
git add pulse/marketing/remotion/src/
git commit -m "feat(ad): renderable skeleton — copy, cuts, Ad composer, 3 compositions"
```

---

## Task 6: ColdOpen scene

**Files:**
- Modify: `pulse/marketing/remotion/src/scenes/ColdOpen.tsx`

- [ ] **Step 1: Replace ColdOpen with the real scene**

```tsx
import { AbsoluteFill, Sequence } from "remotion";
import { C } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Breath: pulse-line draws (frames 0-20), headline rises after BREATH (36).
export const ColdOpen: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
    <PulseLine mode="flat" />
    <Sequence from={36}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <KineticText text={COPY.coldOpen} sizeVw={7} gold />
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);
```

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npx remotion still src/index.ts Hero out/coldopen.png --frame=50
```
Expected: tsc clean; png shows a gold flat line + gold headline on ink.

- [ ] **Step 3: Commit**

```bash
git add pulse/marketing/remotion/src/scenes/ColdOpen.tsx
git commit -m "feat(ad): ColdOpen scene — breath + pulse-line + headline"
```

---

## Task 7: Chaos scene

**Files:**
- Modify: `pulse/marketing/remotion/src/scenes/Chaos.tsx`

- [ ] **Step 1: Replace Chaos with the real scene**

```tsx
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { C, body } from "../theme";
import { COPY } from "../copy";

// Fast desaturated word-flashes of the pain. No gold (withheld for the Turn).
export const Chaos: React.FC<{ data?: number[] }> = () => {
  const { durationInFrames } = useVideoConfig();
  const each = Math.floor(durationInFrames / COPY.chaos.length);
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, filter: "grayscale(1)" }}>
      {COPY.chaos.map((word, i) => (
        <Sequence key={word} from={i * each} durationInFrames={each}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: body, fontWeight: 700, color: C.ash, fontSize: "8vw", letterSpacing: "-0.02em" }}>
              {word}
            </div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npx remotion still src/index.ts Hero out/chaos.png --frame=200
git add pulse/marketing/remotion/src/scenes/Chaos.tsx
git commit -m "feat(ad): Chaos scene — desaturated pain flashes"
```

---

## Task 8: Turn scene (heartbeat snap + logo hit)

**Files:**
- Modify: `pulse/marketing/remotion/src/scenes/Turn.tsx`

- [ ] **Step 1: Replace Turn with the real scene**

```tsx
import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, GOLD_GLOW } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Heartbeat snaps in; logo punches on a spring; "Meet Pulse." rises.
export const Turn: React.FC<{ data?: number[] }> = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame: frame - 18, fps, config: { damping: 12, stiffness: 200 } });
  const logoW = interpolate(pop, [0, 1], [0.2, 0.42]) * width;
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
      <PulseLine mode="beat" />
      <Sequence from={16}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "3%" }}>
          <Img
            src={staticFile("pulse-logo.png")}
            style={{ width: logoW, filter: `drop-shadow(${GOLD_GLOW})`, opacity: pop }}
          />
          <KineticText text={COPY.turn} delay={24} sizeVw={6} gold />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npx remotion still src/index.ts Social out/turn.png --frame=240
git add pulse/marketing/remotion/src/scenes/Turn.tsx
git commit -m "feat(ad): Turn scene — heartbeat snap + logo hit"
```

---

## Task 9: AugmentedShowcase scene (3D windows + menu + button clicks)

**Files:**
- Modify: `pulse/marketing/remotion/src/scenes/AugmentedShowcase.tsx`

- [ ] **Step 1: Replace AugmentedShowcase with the real scene**

```tsx
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { C } from "../theme";
import { Stage3D } from "../components/Stage3D";
import { Window3D } from "../components/Window3D";
import { Menu3D } from "../components/Menu3D";
import { ClickCursor } from "../components/ClickCursor";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Each beat: a 3D-posed UI window floats in, the 3D menu shows the matching
// item active, a cursor glides to that item and clicks (gold ripple), gold label.
export const AugmentedShowcase: React.FC<{ data?: number[] }> = ({ data = [0] }) => {
  const { durationInFrames, width, height } = useVideoConfig();
  const each = Math.floor(durationInFrames / data.length);
  const portrait = height > width;
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {data.map((idx, i) => {
        const win = COPY.windows[idx];
        const menuActive = Math.min(idx, COPY.menu.length - 1);
        const clickAt = Math.round(each * 0.2);
        return (
          <Sequence key={idx} from={i * each} durationInFrames={each}>
            <Stage3D drift={5}>
              <div style={{ position: "absolute", left: portrait ? "8%" : "9%", top: portrait ? "10%" : "26%" }}>
                <Menu3D items={[...COPY.menu]} activeIndex={menuActive} delay={2} />
              </div>
              <div style={{ position: "absolute", left: portrait ? "11%" : "38%", top: portrait ? "42%" : "20%", width: "100%" }}>
                <Window3D shot={win.shot} delay={8} rotateY={-12} rotateX={3} z={140} widthFrac={portrait ? 0.78 : 0.5} />
              </div>
              <ClickCursor
                from={portrait ? [70, 80] : [60, 80]}
                to={portrait ? [24, 18 + menuActive * 7] : [16, 32 + menuActive * 5]}
                start={0}
                clickAt={clickAt}
              />
            </Stage3D>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: portrait ? "flex-start" : "flex-end", padding: "7%" }}>
              <KineticText text={win.label} delay={clickAt + 4} sizeVw={portrait ? 5 : 3} gold />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
```

> Cursor `to` coordinates are approximate menu-item positions (good enough for a brand cut). If the click visibly misses the active item after first render, nudge the `to` percentages.

- [ ] **Step 2: Verify (all three ratios) + commit**

```bash
npm run typecheck
npx remotion still src/index.ts Hero out/showcase-hero.png --frame=780
npx remotion still src/index.ts Hook out/showcase-hook.png --frame=180
git add pulse/marketing/remotion/src/scenes/AugmentedShowcase.tsx
git commit -m "feat(ad): AugmentedShowcase — 3D windows, 3D menu, button clicks"
```

---

## Task 9b: DataViz scene (animated charts)

**Files:**
- Modify: `pulse/marketing/remotion/src/scenes/DataViz.tsx`

- [ ] **Step 1: Replace DataViz with the real scene**

```tsx
import { AbsoluteFill, useVideoConfig } from "remotion";
import { C } from "../theme";
import { Stage3D } from "../components/Stage3D";
import { BarChart } from "../components/BarChart";
import { LineChart } from "../components/LineChart";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// A 3D-tilted data panel: gold bars grow + a gold area/line draws in.
export const DataViz: React.FC<{ data?: number[] }> = () => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "4%" }}>
      <KineticText text={COPY.dataViz.headline} sizeVw={portrait ? 5.4 : 3.4} gold />
      <Stage3D drift={4} perspective={1800}>
        <div style={{
          position: "absolute", left: "50%", top: "54%",
          transform: "translate(-50%,-50%) rotateY(-14deg) rotateX(6deg)", transformStyle: "preserve-3d",
          display: "flex", flexDirection: portrait ? "column" : "row", gap: 40, alignItems: "flex-end",
          background: `${C.coal}aa`, border: `1px solid ${C.hairline2}`, borderRadius: 16, padding: 28,
        }}>
          <BarChart values={[...COPY.dataViz.bars]} delay={6} />
          <LineChart values={[...COPY.dataViz.line]} delay={10} />
        </div>
      </Stage3D>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npx remotion still src/index.ts Hero out/dataviz.png --frame=1500
git add pulse/marketing/remotion/src/scenes/DataViz.tsx
git commit -m "feat(ad): DataViz scene — animated gold bar + line charts"
```

---

## Task 10: Payoff scene

**Files:**
- Modify: `pulse/marketing/remotion/src/scenes/Payoff.tsx`

- [ ] **Step 1: Replace Payoff with the real scene**

```tsx
import { AbsoluteFill } from "remotion";
import { C } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// The summary line over a calm heartbeat.
export const Payoff: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
    <PulseLine mode="beat" strokeWidth={3} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <KineticText text={COPY.payoff} delay={8} sizeVw={5.4} gold />
    </AbsoluteFill>
  </AbsoluteFill>
);
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npx remotion still src/index.ts Hero out/payoff.png --frame=1700
git add pulse/marketing/remotion/src/scenes/Payoff.tsx
git commit -m "feat(ad): Payoff scene"
```

---

## Task 11: CTA scene (held end card)

**Files:**
- Modify: `pulse/marketing/remotion/src/scenes/CTA.tsx`

- [ ] **Step 1: Replace CTA with the real scene**

```tsx
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { C, body, display, GOLD_GLOW } from "../theme";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Logo + tagline + url. Holds ~1s at the end (durationInFrames covers it).
export const CTA: React.FC<{ data?: number[] }> = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "4%" }}>
      <Img src={staticFile("pulse-logo.png")} style={{ width: width * 0.4, filter: `drop-shadow(${GOLD_GLOW})` }} />
      <KineticText text={COPY.ctaTagline} delay={10} sizeVw={3.4} />
      <div style={{ fontFamily: display, fontWeight: 700, color: C.gold, fontSize: "3.6vw", letterSpacing: "0.02em" }}>
        {COPY.ctaUrl}
      </div>
      <div style={{ fontFamily: body, color: C.ash, fontSize: "1.6vw" }}>Pulse · Myind Media</div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify + commit**

```bash
npm run typecheck
npx remotion still src/index.ts Social out/cta.png --frame=860
git add pulse/marketing/remotion/src/scenes/CTA.tsx
git commit -m "feat(ad): CTA end card"
```

---

## Task 12: Audio wiring (guarded) + beat note

**Files:**
- Modify: `pulse/marketing/remotion/src/Ad.tsx`

- [ ] **Step 1: Add guarded music to `Ad.tsx`**

Add imports:
```tsx
import { Audio, staticFile, getStaticFiles } from "remotion";
```

Inside `Ad`, before the `<TransitionSeries>`, add:
```tsx
  const hasMusic = getStaticFiles().some((f) => f.name === "music.mp3");
```

And as the first child of the outer `<AbsoluteFill>`:
```tsx
      {hasMusic ? <Audio src={staticFile("music.mp3")} volume={0.7} /> : null}
```

- [ ] **Step 2: Verify (renders silent without music.mp3)**

```bash
npm run typecheck
npx remotion still src/index.ts Hook out/audio-check.png --frame=10
```
Expected: tsc clean; no crash when `public/music.mp3` is absent.

- [ ] **Step 3: Commit**

```bash
git add pulse/marketing/remotion/src/Ad.tsx
git commit -m "feat(ad): optional BPM-synced music bed (guarded)"
```

> Drop a licensed `public/music.mp3` (≈120 bpm) before final render to score the cut. Scene frame counts in `cuts.ts` already sit on whole-second boundaries; nudge them to `beatFrames(bpm)` multiples if you want hard beat-locked cuts.

---

## Task 13: VO script

**Files:**
- Create: `pulse/marketing/remotion/VO-SCRIPT.md`

- [ ] **Step 1: Write the optional VO script**

```markdown
# Pulse Launch Ad — Optional VO Script

Read in Lawrence's voice (big-sibling, peer-to-peer, no hype). The ad works
silent; record these only if you want a voiced version. Timings are guides.

## Hero (75s)
- (cold open) "Your studio runs on chaos."
- (chaos) "Spreadsheets. Unpaid invoices. Lost files. A hundred open DMs."
- (turn) "Meet Pulse."
- (value) "Every song lives in one pipeline. Every session, booked. Every
  release, on track. Every dollar, accounted for. Every studio, under one roof."
- (payoff) "One place. Every song, every session, every dollar."
- (cta) "Pulse. The studio CRM built for producers, not spreadsheets. pulse.studio."

## Social (30s)
- "Your studio runs on chaos. Spreadsheets, invoices, lost files. Meet Pulse.
  Every song, every session, every dollar, in one place. Pulse dot studio."

## Hook (15s)
- "Your studio runs on chaos. Meet Pulse. Everything in one place. Pulse dot studio."
```

- [ ] **Step 2: Commit**

```bash
git add pulse/marketing/remotion/VO-SCRIPT.md
git commit -m "docs(ad): optional VO script for all three cuts"
```

---

## Task 14: Render all three + final verification

**Files:** none (produces `out/*.mp4`).

- [ ] **Step 1: Final typecheck**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 2: Render all three cuts**

```bash
npm run render:hook
npm run render:social
npm run render:hero
```
Expected: `out/pulse-hook.mp4` (~15s), `out/pulse-social.mp4` (~30s), `out/pulse-hero.mp4` (~75s).

- [ ] **Step 3: brand-dna self-check (eyeball each mp4)**

Confirm: one accent (gold) per frame; 60%+ negative space on text scenes; emotion-first cold open; crushed blacks (ink #08080a); ~1.2s breath before first motion; headline ≥3× body; no em dashes in copy; logo crisp.

- [ ] **Step 4: Surface the deliverables**

Report the three mp4 paths to the user. (Do not commit `out/` — it is gitignored.)

---

## Self-Review

- **Spec coverage:** ColdOpen/Chaos/Turn/AugmentedShowcase/DataViz/Payoff/CTA (spec arc 1–6) = Tasks 6–11. 3D augmented windows + 3D menu + button clicks (new requirement) = Task 9 (`Stage3D`/`Window3D`/`Menu3D`/`ClickCursor`, built Task 4b). Data visualizations (new requirement) = Task 9b (`BarChart`/`LineChart`, built Task 4b). Three cuts/ratios = `cuts.ts` + `Root.tsx` (Task 5). Gold pulse-line motif = Task 3, used in ColdOpen/Turn/Payoff. Pulse tokens verbatim = Task 2 `theme.ts`. Music-led + breath-before-beat = Task 12 + `BREATH`/`beatFrames`. Optional VO = Task 13. Node-22 + `type`-not-`interface` gotchas = header + every prop type uses `type`. Honesty (no fake KPIs) = chart values labeled illustrative in `COPY.dataViz`.
- **Placeholder scan:** none — every step ships real code/commands. `GlassFrame`/`CountUp` are built (Task 4) but the 3D cut prefers `Window3D`/charts; kept as compact-cut fallbacks, not placeholders.
- **Type consistency:** `AdProps.cut: CutId`; `CUTS` keyed by `CutId`; scenes typed `React.FC<{ data?: number[] }>` consistently across `Ad.tsx` and all seven scene files; `SceneKey` union (`coldOpen|chaos|turn|augmentedShowcase|dataViz|payoff|cta`) matches `SCENES` map keys and `cuts.ts` scene keys. `staticFile("shots/<file>")` matches `copy-assets.mjs` output dir and `COPY.windows[].shot` filenames. Chart components take `number[]`; `COPY.dataViz` readonly tuples are spread (`[...]`) at call sites.
