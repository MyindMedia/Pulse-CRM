import { AbsoluteFill, Audio, getStaticFiles, staticFile } from "remotion";
import { linearTiming, TransitionSeries, TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { clockWipe } from "@remotion/transitions/clock-wipe";
import { flip } from "@remotion/transitions/flip";
import { CUTS, CutId, SceneKey, TRANSITION } from "./cuts";
import { MUSIC, SCENE_VO } from "./audio";
import { GradientBG } from "./components/GradientBG";
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

// Varied, motivated transitions cycle through scene boundaries for dynamism.
function presentationFor(i: number, w: number, h: number): TransitionPresentation<Record<string, unknown>> {
  const seq = [
    slide({ direction: "from-right" }),
    wipe({ direction: "from-bottom-right" }),
    clockWipe({ width: w, height: h }),
    slide({ direction: "from-left" }),
    flip(),
    wipe({ direction: "from-top-left" }),
    slide({ direction: "from-bottom" }),
    fade(),
  ];
  return seq[i % seq.length] as TransitionPresentation<Record<string, unknown>>;
}

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
          presentation={presentationFor(i, config.width, config.height)}
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
