import { AbsoluteFill, Audio, getStaticFiles, staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { CUTS, CutId, SceneKey, TRANSITION } from "./cuts";
import { MUSIC, SCENE_VO } from "./audio";
import { appleScale } from "./transitions/appleScale";
import { GradientBG } from "./components/GradientBG";
import { Particles } from "./components/Particles";
import { Hook } from "./scenes/Hook";
import { Chaos } from "./scenes/Chaos";
import { Turn } from "./scenes/Turn";
import { Songs } from "./scenes/Songs";
import { AugmentedShowcase } from "./scenes/AugmentedShowcase";
import { DataViz } from "./scenes/DataViz";
import { Scale } from "./scenes/Scale";
import { Payoff } from "./scenes/Payoff";
import { CTA } from "./scenes/CTA";

const SCENES: Record<SceneKey, React.FC<{ data?: number[] }>> = {
  hook: Hook,
  chaos: Chaos,
  turn: Turn,
  songs: Songs,
  automate: AugmentedShowcase,
  growth: DataViz,
  scale: Scale,
  payoff: Payoff,
  cta: CTA,
};

export type AdProps = { cut: CutId };

export const Ad: React.FC<AdProps> = ({ cut }) => {
  const config = CUTS[cut];
  const files = new Set(getStaticFiles().map((f) => f.name));
  const hasMusic = files.has(MUSIC);

  const children: React.ReactNode[] = [];
  config.scenes.forEach((sc, i) => {
    const Scene = SCENES[sc.key];
    const vo = SCENE_VO[sc.key];
    children.push(
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={sc.frames}>
        <>
          {vo && files.has(vo) ? <Audio src={staticFile(vo)} volume={0.95} /> : null}
          <Scene data={sc.data} />
        </>
      </TransitionSeries.Sequence>
    );
    if (i < config.scenes.length - 1) {
      children.push(
        <TransitionSeries.Transition
          key={`t${i}`}
          presentation={appleScale()}
          timing={linearTiming({ durationInFrames: TRANSITION })}
        />
      );
    }
  });

  return (
    <AbsoluteFill>
      {/* Animated gradient + drifting gold particles — the only backdrop. */}
      <GradientBG />
      <Particles />
      {hasMusic ? <Audio src={staticFile(MUSIC)} volume={0.16} /> : null}
      <TransitionSeries>{children}</TransitionSeries>
    </AbsoluteFill>
  );
};
