import { SceneKey } from "./cuts";

// Background music (low volume) — THAMYINDxAPOLLO "Rocket" 142 BPM.
export const MUSIC = "music.mp3";

// Per-scene voiceover clips (ElevenLabs, Charlie). Keyed by scene so the same
// clip syncs across all three cuts; played at each scene's start.
export const SCENE_VO: Partial<Record<SceneKey, string>> = {
  hook: "vo/hook.mp3",
  chaos: "vo/chaos.mp3",
  turn: "vo/turn.mp3",
  songs: "vo/songs.mp3",
  automate: "vo/automate.mp3",
  growth: "vo/growth.mp3",
  scale: "vo/scale.mp3",
  payoff: "vo/payoff.mp3",
  cta: "vo/cta.mp3",
};
