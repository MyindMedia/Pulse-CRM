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

// Crossfade length between scenes (frames). Shared by Ad.tsx + duration math.
export const TRANSITION = 8;

export const totalFrames = (c: CutConfig) => c.scenes.reduce((n, sc) => n + sc.frames, 0);

// TransitionSeries overlaps each transition, so the real timeline is shorter
// than the sum of sequence durations. Use this for the Composition length.
export const seriesFrames = (c: CutConfig) =>
  totalFrames(c) - TRANSITION * Math.max(0, c.scenes.length - 1);
