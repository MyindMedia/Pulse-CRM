import { FPS } from "./theme";

export type SceneKey =
  | "hook"
  | "chaos"
  | "turn"
  | "songs"
  | "automate"
  | "growth"
  | "scale"
  | "payoff"
  | "cta";
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

// Per-scene min duration must clear that scene's VO clip across every cut.
export const CUTS: Record<CutId, CutConfig> = {
  hook: {
    id: "hook",
    width: 1080,
    height: 1920,
    fps: FPS,
    scenes: [
      { key: "hook", frames: s(3.5) },
      { key: "turn", frames: s(2.5) },
      { key: "songs", frames: s(5) },
      { key: "cta", frames: s(4.5) },
    ],
  },
  social: {
    id: "social",
    width: 1080,
    height: 1080,
    fps: FPS,
    scenes: [
      { key: "hook", frames: s(4) },
      { key: "chaos", frames: s(5) },
      { key: "turn", frames: s(3) },
      { key: "automate", frames: s(6), data: [1, 3] },
      { key: "growth", frames: s(4.5) },
      { key: "payoff", frames: s(3) },
      { key: "cta", frames: s(4.5) },
    ],
  },
  hero: {
    id: "hero",
    width: 1920,
    height: 1080,
    fps: FPS,
    scenes: [
      { key: "hook", frames: s(5.5) },
      { key: "chaos", frames: s(6.5) },
      { key: "turn", frames: s(4) },
      { key: "songs", frames: s(6.5) },
      { key: "automate", frames: s(7), data: [1, 3] },
      { key: "growth", frames: s(7) },
      { key: "scale", frames: s(6) },
      { key: "payoff", frames: s(4.5) },
      { key: "cta", frames: s(6.5) },
    ],
  },
};

// Crossfade/transition length between scenes (frames). Constant so the
// composition-duration math stays exact regardless of transition type.
export const TRANSITION = 12;

export const totalFrames = (c: CutConfig) => c.scenes.reduce((n, sc) => n + sc.frames, 0);

export const seriesFrames = (c: CutConfig) =>
  totalFrames(c) - TRANSITION * Math.max(0, c.scenes.length - 1);
