import { AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import type { TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { C, FPS } from "./theme";
import { appleScale } from "./transitions/appleScale";
import { Plate } from "./components/Plate";
import { AudioWave } from "./components/AudioWave";
import { GradientBG } from "./components/GradientBG";
import { Particles } from "./components/Particles";
import { CTA } from "./scenes/CTA";

// The Higgsfield AI hype cut, rebuilt in Remotion so every layer is under code
// control: beat-synced punch-ins + brand grade per plate (Plate.tsx), real
// audio-reactive gold waveform riding the whole cut (AudioWave), premium
// scene transitions, a music bed that fades out over the tail, and an animated
// end card that resolves to black. Replaces the ffmpeg assemble.sh pipeline.
const PLATE_F = 105; // 3.5s @ 30fps — 7 beats at 120bpm
const END_F = 120; // 4s end card: ~2s hold with music, then resolve
const T = 14; // transition length

// plate, then the transition that follows it (the last has none)
const PLATES: { src: string; next?: "apple" | "fade" }[] = [
  { src: "cine1.mp4", next: "apple" }, // cinematic -> product: zoom in
  { src: "product-dashboard.mp4", next: "fade" },
  { src: "cine2.mp4", next: "apple" }, // cinematic -> product: zoom in
  { src: "prod2.mp4", next: "fade" },
  { src: "cine3.mp4", next: "fade" }, // -> end card
];

export const hypeDuration = () => PLATES.length * PLATE_F + END_F - PLATES.length * T;

const presentationFor = (kind: "apple" | "fade"): TransitionPresentation<Record<string, unknown>> =>
  (kind === "apple" ? appleScale() : fade()) as TransitionPresentation<Record<string, unknown>>;

export const Hype: React.FC = () => {
  const frame = useCurrentFrame();
  const D = hypeDuration();

  // music: quick fade-in, hold, then fade out over the last 1.6s of the tail
  const fadeOutStart = D - Math.round(1.6 * FPS);
  const volume = (f: number) => {
    const up = interpolate(f, [0, 10], [0, 0.85], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const down = interpolate(f, [fadeOutStart, D], [0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return Math.min(up, down);
  };

  // resolve to black over the final second
  const blackOut = interpolate(frame, [D - FPS, D], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const children: React.ReactNode[] = [];
  PLATES.forEach((p, i) => {
    children.push(
      <TransitionSeries.Sequence key={`p${i}`} durationInFrames={PLATE_F}>
        <Plate src={p.src} durationInFrames={PLATE_F} />
      </TransitionSeries.Sequence>
    );
    children.push(
      <TransitionSeries.Transition
        key={`t${i}`}
        presentation={presentationFor(p.next ?? "fade")}
        timing={linearTiming({ durationInFrames: T })}
      />
    );
  });
  // animated end card scene
  children.push(
    <TransitionSeries.Sequence key="end" durationInFrames={END_F}>
      <AbsoluteFill style={{ backgroundColor: C.ink }}>
        <GradientBG />
        <Particles />
        <CTA />
      </AbsoluteFill>
    </TransitionSeries.Sequence>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <TransitionSeries>{children}</TransitionSeries>
      {/* real audio-reactive waveform across the whole cut */}
      <AudioWave />
      <Audio src={staticFile("music.mp3")} volume={volume} />
      {/* resolve to black */}
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: blackOut }} />
    </AbsoluteFill>
  );
};
