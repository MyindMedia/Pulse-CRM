import { AbsoluteFill, Audio, getStaticFiles, staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { CUTS, CutId, SceneKey, TRANSITION } from "./cuts";
import { MUSIC, SCENE_VO } from "./audio";
import { GradientBG } from "./components/GradientBG";
import { ColdOpen } from "./scenes/ColdOpen";
import { Chaos } from "./scenes/Chaos";
import { Turn } from "./scenes/Turn";
import { AugmentedShowcase } from "./scenes/AugmentedShowcase";
import { DataViz } from "./scenes/DataViz";
import { Payoff } from "./scenes/Payoff";
import { CTA } from "./scenes/CTA";

const SCENES: Record<SceneKey, React.FC<{ data?: number[] }>> = {
  coldOpen: ColdOpen,
  chaos: Chaos,
  turn: Turn,
  augmentedShowcase: AugmentedShowcase,
  dataViz: DataViz,
  payoff: Payoff,
  cta: CTA,
};

export type AdProps = { cut: CutId };

export const Ad: React.FC<AdProps> = ({ cut }) => {
  const config = CUTS[cut];
  const files = new Set(getStaticFiles().map((f) => f.name));
  const hasMusic = files.has(MUSIC);

  // TransitionSeries requires Sequence/Transition as direct children — build a flat array.
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
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION })}
        />
      );
    }
  });

  return (
    <AbsoluteFill>
      <GradientBG />
      {hasMusic ? <Audio src={staticFile(MUSIC)} volume={0.16} /> : null}
      <TransitionSeries>{children}</TransitionSeries>
    </AbsoluteFill>
  );
};
