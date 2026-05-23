import { AbsoluteFill, Audio, getStaticFiles, staticFile } from "remotion";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { CUTS, CutId, SceneKey, TRANSITION } from "./cuts";
import { C } from "./theme";
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
  const hasMusic = getStaticFiles().some((f) => f.name === "music.mp3");

  // TransitionSeries requires Sequence/Transition as direct children — build a flat array.
  const children: React.ReactNode[] = [];
  config.scenes.forEach((sc, i) => {
    const Scene = SCENES[sc.key];
    children.push(
      <TransitionSeries.Sequence key={`s${i}`} durationInFrames={sc.frames}>
        <Scene data={sc.data} />
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
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {hasMusic ? <Audio src={staticFile("music.mp3")} volume={0.7} /> : null}
      <TransitionSeries>{children}</TransitionSeries>
    </AbsoluteFill>
  );
};
