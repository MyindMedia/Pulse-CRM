import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, GOLD_GLOW } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Heartbeat snaps in; logo punches on a spring; "Meet Pulse." rises.
export const Turn: React.FC<{ data?: number[] }> = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame: frame - 18, fps, config: { damping: 12, stiffness: 200 } });
  const logoW = interpolate(pop, [0, 1], [0.2, 0.42]) * width;
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
      <PulseLine mode="beat" />
      <Sequence from={16}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "3%" }}>
          <Img
            src={staticFile("pulse-logo.png")}
            style={{ width: logoW, filter: `drop-shadow(${GOLD_GLOW})`, opacity: pop }}
          />
          <KineticText text={COPY.turn} delay={24} sizeVw={6} gold />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
