import { Composition } from "remotion";
import { Ad } from "./Ad";
import { EndCard } from "./EndCard";
import { CUTS, seriesFrames } from "./cuts";

export const Root: React.FC = () => (
  <>
    <Composition id="EndCard" component={EndCard} durationInFrames={105} fps={30} width={1920} height={1080} />
    <Composition
      id="Hook"
      component={Ad}
      durationInFrames={seriesFrames(CUTS.hook)}
      fps={CUTS.hook.fps}
      width={CUTS.hook.width}
      height={CUTS.hook.height}
      defaultProps={{ cut: "hook" as const }}
    />
    <Composition
      id="Social"
      component={Ad}
      durationInFrames={seriesFrames(CUTS.social)}
      fps={CUTS.social.fps}
      width={CUTS.social.width}
      height={CUTS.social.height}
      defaultProps={{ cut: "social" as const }}
    />
    <Composition
      id="Hero"
      component={Ad}
      durationInFrames={seriesFrames(CUTS.hero)}
      fps={CUTS.hero.fps}
      width={CUTS.hero.width}
      height={CUTS.hero.height}
      defaultProps={{ cut: "hero" as const }}
    />
  </>
);
