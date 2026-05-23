import { AbsoluteFill, Audio, getStaticFiles, staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { C, FPS } from "../theme";
import { appleScale } from "../transitions/appleScale";
import { GradientBG } from "../components/GradientBG";
import { Particles } from "../components/Particles";
import { ColdHook, ScatterCards, DisconnectedApps, StickyChaos, GapsFreeze } from "./chaos";
import { Reveal, SongCentric, Calendar, Pipeline, Payments, SongHub, Agents, Scale } from "./solution";
import { PromoPayoff, PromoEndCard } from "./close";

const TRANSITION = 12;
const s = (sec: number) => Math.round(sec * FPS);

type Beat = { C: React.FC<{ data?: number[] }>; frames: number; vo?: string };

// Scene order, durations (>= each VO clip), and per-scene voiceover.
const BEATS: Beat[] = [
  { C: ColdHook, frames: s(3), vo: "vo/p1.mp3" },
  { C: ScatterCards, frames: s(6.6), vo: "vo/p2.mp3" },
  { C: DisconnectedApps, frames: s(5.2), vo: "vo/p3.mp3" },
  { C: StickyChaos, frames: s(7.2), vo: "vo/p4.mp3" },
  { C: GapsFreeze, frames: s(6.2), vo: "vo/p5.mp3" },
  { C: Reveal, frames: s(5), vo: "vo/p6.mp3" },
  { C: SongCentric, frames: s(11), vo: "vo/p7.mp3" },
  { C: Calendar, frames: s(7), vo: "vo/p8.mp3" },
  { C: Pipeline, frames: s(8.5), vo: "vo/p9.mp3" },
  { C: Payments, frames: s(6.2), vo: "vo/p10.mp3" },
  { C: SongHub, frames: s(6.6), vo: "vo/p11.mp3" },
  { C: Agents, frames: s(8.2), vo: "vo/p12.mp3" },
  { C: Scale, frames: s(6.8), vo: "vo/p13.mp3" },
  { C: PromoPayoff, frames: s(5.6), vo: "vo/p14.mp3" },
  { C: PromoEndCard, frames: s(4.5) },
];

export const promoDuration = () => BEATS.reduce((n, b) => n + b.frames, 0) - TRANSITION * (BEATS.length - 1);

export const Promo: React.FC = () => {
  const files = new Set(getStaticFiles().map((f) => f.name));
  const hasMusic = files.has("music.mp3");
  const children: React.ReactNode[] = [];
  BEATS.forEach((b, i) => {
    const Scene = b.C;
    children.push(
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={b.frames}>
        <>
          {b.vo && files.has(b.vo) ? <Audio src={staticFile(b.vo)} volume={1} /> : null}
          <Scene />
        </>
      </TransitionSeries.Sequence>
    );
    if (i < BEATS.length - 1) {
      children.push(
        <TransitionSeries.Transition key={`t${i}`} presentation={appleScale()} timing={linearTiming({ durationInFrames: TRANSITION })} />
      );
    }
  });
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <GradientBG />
      <Particles />
      {hasMusic ? <Audio src={staticFile("music.mp3")} volume={0.16} /> : null}
      <TransitionSeries>{children}</TransitionSeries>
    </AbsoluteFill>
  );
};
