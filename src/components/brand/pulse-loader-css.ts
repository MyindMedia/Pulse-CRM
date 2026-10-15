import { ARCS, PULSE_POINTS } from "./pulse-logo-data";

/* The loop, built as CSS keyframes at module load (no runtime cost per render).
 *
 * Timeline, mirroring pulse-native LaunchScreen.swift but looped:
 *   draw   1.30s  easeInOut   the trace draws itself along the centreline
 *   beats  2 x 0.95s          lub-dub: rest, lub, back, dub, settle (easeOut)
 *   erase  0.55s  easeIn      the trace wipes out left to right
 *   gap    0.10s              empty, then it draws again
 * Total 3.85s. The wordmark fades in once, after the first draw, and stays.
 */

export const DRAW = 1.3;
export const BEAT_PHASES = [
  { name: "rest", dur: 0.1, scale: 1, glow: 0.42 },
  { name: "lub", dur: 0.13, scale: 1.075, glow: 0.85 },
  { name: "back", dur: 0.16, scale: 1, glow: 0.5 },
  { name: "dub", dur: 0.12, scale: 1.035, glow: 0.62 },
  { name: "settle", dur: 0.44, scale: 1, glow: 0.42 },
] as const;
export const BEAT = BEAT_PHASES.reduce((s, p) => s + p.dur, 0); // 0.95
export const BEATS = 2;
export const ERASE = 0.55;
export const GAP = 0.1;
export const CYCLE = DRAW + BEAT * BEATS + ERASE + GAP;

/** Centreline sub-paths in icon pixels: the pulse polyline, then three arcs. */
export function centrelinePaths(): { d: string; length: number }[] {
  let pl = 0;
  for (let i = 1; i < PULSE_POINTS.length; i++) {
    pl += Math.hypot(
      PULSE_POINTS[i][0] - PULSE_POINTS[i - 1][0],
      PULSE_POINTS[i][1] - PULSE_POINTS[i - 1][1],
    );
  }
  const out = [
    { d: "M" + PULSE_POINTS.map((p) => `${p[0]} ${p[1]}`).join("L"), length: pl },
  ];
  for (const a of ARCS) {
    const s = (a.from * Math.PI) / 180;
    const e = (a.to * Math.PI) / 180;
    const sx = a.cx + a.r * Math.cos(s);
    const sy = a.cy + a.r * Math.sin(s);
    const ex = a.cx + a.r * Math.cos(e);
    const ey = a.cy + a.r * Math.sin(e);
    const large = a.to - a.from > 180 ? 1 : 0;
    out.push({
      d: `M${sx.toFixed(2)} ${sy.toFixed(2)}A${a.r} ${a.r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`,
      length: a.r * (e - s),
    });
  }
  return out;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));
const easeIn = (t: number) => t * t;

const pct = (sec: number) => `${((sec / CYCLE) * 100).toFixed(3)}%`;

/** Local progress (0..1) of sub-path i when the whole line is at global g. */
function local(g: number, i: number, lengths: number[]) {
  const total = lengths.reduce((s, l) => s + l, 0);
  const start = lengths.slice(0, i).reduce((s, l) => s + l, 0);
  return Math.min(1, Math.max(0, (g * total - start) / lengths[i]));
}

/** Keyframes for one sub-path's dash offset + visibility over the cycle. */
export function pathKeyframes(i: number, lengths: number[]): string {
  const steps = 22;
  const frames: string[] = [];
  // hidden through the gap and the very start of the draw
  for (let s = 0; s <= steps; s++) {
    const t = (s / steps) * DRAW;
    const l = local(easeInOut(s / steps), i, lengths);
    frames.push(
      `${pct(t)}{stroke-dashoffset:${(1 - l).toFixed(4)};opacity:${l > 0 ? 1 : 0}}`,
    );
  }
  const eraseStart = DRAW + BEAT * BEATS;
  frames.push(`${pct(eraseStart)}{stroke-dashoffset:0;opacity:1}`);
  for (let s = 1; s <= steps; s++) {
    const t = eraseStart + (s / steps) * ERASE;
    const e = local(easeIn(s / steps), i, lengths);
    frames.push(
      `${pct(t)}{stroke-dashoffset:${(-e).toFixed(4)};opacity:${e < 1 ? 1 : 0}}`,
    );
  }
  frames.push(`100%{stroke-dashoffset:1;opacity:0}`);
  return `@keyframes pl-trace-${i}{${frames.join("")}}`;
}

const glowFilter = (g: number) =>
  `drop-shadow(0 0 calc(var(--pl-k,1)*${(18 * (g / 0.5)).toFixed(1)}px) rgba(253,206,1,${g.toFixed(2)}))`;

/** Scale + glow: rises with the draw, lub-dub through the beats, fades on erase. */
export function markKeyframes(): string {
  const f: string[] = [];
  f.push(`0%{transform:scale(1);filter:${glowFilter(0)}}`);
  // glow swells in over the draw (iOS: easeInOut 1.0s delayed 0.5s)
  f.push(`${pct(0.5)}{transform:scale(1);filter:${glowFilter(0)}}`);
  f.push(`${pct(DRAW)}{transform:scale(1);filter:${glowFilter(0.42)}}`);
  let t = DRAW;
  for (let b = 0; b < BEATS; b++) {
    for (const p of BEAT_PHASES) {
      t += p.dur;
      f.push(
        `${pct(t)}{transform:scale(${p.scale});filter:${glowFilter(p.glow)};animation-timing-function:cubic-bezier(0,0,.2,1)}`,
      );
    }
  }
  f.push(`${pct(DRAW + BEAT * BEATS + ERASE)}{transform:scale(1);filter:${glowFilter(0)}}`);
  f.push(`100%{transform:scale(1);filter:${glowFilter(0)}}`);
  return `@keyframes pl-mark{${f.join("")}}`;
}

export function loaderCss(): string {
  const paths = centrelinePaths();
  const lengths = paths.map((p) => p.length);
  const trace = paths.map((_, i) => pathKeyframes(i, lengths)).join("");
  return [
    `.pl-mark{will-change:transform,filter;transform-origin:50% 50%}`,
    `.pl-word{opacity:1}`,
    `@media (prefers-reduced-motion:no-preference){`,
    trace,
    markKeyframes(),
    `@keyframes pl-word{from{opacity:0}to{opacity:1}}`,
    `.pl-mark{animation:pl-mark ${CYCLE}s linear infinite}`,
    paths
      .map((_, i) => `.pl-t${i}{animation:pl-trace-${i} ${CYCLE}s linear infinite}`)
      .join(""),
    `.pl-word{animation:pl-word 1.2s cubic-bezier(.42,0,.58,1) ${DRAW}s both}`,
    `}`,
    `@media (prefers-reduced-motion:reduce){`,
    `@keyframes pl-calm{0%,100%{opacity:1}50%{opacity:.82}}`,
    `.pl-mark{animation:pl-calm 3.2s ease-in-out infinite}`,
    `}`,
  ].join("");
}
