import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { GOLD_GLOW } from "../theme";

// The turn: the Pulse logo punches in on a spring over the gradient backdrop.
// (No pulsating line on the reveal.)
export const Turn: React.FC<{ data?: number[] }> = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame: frame - 6, fps, config: { damping: 12, stiffness: 200 } });
  const logoW = interpolate(pop, [0, 1], [0.2, 0.42]) * width;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Img
        src={staticFile("pulse-logo.png")}
        style={{ width: logoW, filter: `drop-shadow(${GOLD_GLOW})`, opacity: pop }}
      />
    </AbsoluteFill>
  );
};
