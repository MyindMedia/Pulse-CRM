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
