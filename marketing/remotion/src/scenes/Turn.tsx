import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { GOLD_GLOW } from "../theme";
import { ImageLayer } from "../components/ImageLayer";
import { PulseLine } from "../components/PulseLine";

// The turn: gold soundwave + heartbeat snaps in, logo punches on a spring.
export const Turn: React.FC<{ data?: number[] }> = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame: frame - 12, fps, config: { damping: 12, stiffness: 200 } });
  const logoW = interpolate(pop, [0, 1], [0.18, 0.4]) * width;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <ImageLayer src="hero-soundwave.png" zoom={1.16} overlay={0.42} />
      <PulseLine mode="beat" />
      <Sequence from={8}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Img src={staticFile("pulse-logo.png")} style={{ width: logoW, filter: `drop-shadow(${GOLD_GLOW})`, opacity: pop }} />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
