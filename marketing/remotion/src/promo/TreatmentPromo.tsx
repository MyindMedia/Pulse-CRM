import { AbsoluteFill, Audio, getStaticFiles, staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { C, FPS } from "../theme";
import { appleScale } from "../transitions/appleScale";
import { GradientBG } from "../components/GradientBG";
import { Particles } from "../components/Particles";
import {
  RhythmOpen, ChaosBuild, PainPoints, SongBuried, PulseReveal, SongCentric,
  Montage, Calendar, TreatmentEndCard, Pipeline, Payments, SongHub, Agents, Scale,
} from "./treatment";

const TRANSITION = 12;
const s = (sec: number) => Math.round(sec * FPS);

type Beat = { C: React.FC<{ data?: number[] }>; frames: number; vo?: string };

// 13 director-cut beats + a real-UI montage. Durations clear each VO clip.
const BEATS: Beat[] = [
  { C: RhythmOpen, frames: s(2.8), vo: "vo/t_rhythm.mp3" },
  { C: ChaosBuild, frames: s(4.2), vo: "vo/t_chaos.mp3" },
  { C: PainPoints, frames: s(7.6), vo: "vo/t_pain.mp3" },
  { C: SongBuried, frames: s(6.4), vo: "vo/t_buried.mp3" },
  { C: PulseReveal, frames: s(3.6), vo: "vo/t_reveal.mp3" },
  { C: SongCentric, frames: s(8.8), vo: "vo/t_centric.mp3" },
  { C: SongHub, frames: s(12.2), vo: "vo/t_orbit.mp3" },
  { C: Montage, frames: s(7.8), vo: "vo/t_montage.mp3" },
  { C: Calendar, frames: s(9.6), vo: "vo/t_booking.mp3" },
  { C: Pipeline, frames: s(8), vo: "vo/t_pipeline.mp3" },
  { C: Payments, frames: s(7.8), vo: "vo/t_payments.mp3" },
  { C: Agents, frames: s(9.3), vo: "vo/t_agents.mp3" },
  { C: Scale, frames: s(7.2), vo: "vo/t_scale.mp3" },
  { C: TreatmentEndCard, frames: s(8.2), vo: "vo/t_end.mp3" },
];

export const treatmentDuration = () => BEATS.reduce((n, b) => n + b.frames, 0) - TRANSITION * (BEATS.length - 1);

export const TreatmentPromo: React.FC = () => {
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
