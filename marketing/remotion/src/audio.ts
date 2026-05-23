import { SceneKey } from "./cuts";

// Background music (low volume) — THAMYINDxAPOLLO "Rocket" 142 BPM.
export const MUSIC = "music.mp3";

// Per-scene voiceover clips (ElevenLabs). Keyed by scene so the same clip
// syncs across all three cuts. Played at each scene's start.
export const SCENE_VO: Partial<Record<SceneKey, string>> = {
  coldOpen: "vo/coldopen.mp3",
  chaos: "vo/chaos.mp3",
  turn: "vo/turn.mp3",
  augmentedShowcase: "vo/showcase.mp3",
  dataViz: "vo/dataviz.mp3",
  payoff: "vo/payoff.mp3",
  cta: "vo/cta.mp3",
};
