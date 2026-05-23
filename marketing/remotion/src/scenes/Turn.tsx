import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { GOLD_GLOW } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { Text3D } from "../components/Text3D";
import { COPY } from "../copy";
import { SHOW_CAPTIONS } from "../config";

// Heartbeat snaps in; logo punches on a spring; "Meet Pulse." rises in 3D.
export const Turn: React.FC<{ data?: number[] }> = () => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame: frame - 18, fps, config: { damping: 12, stiffness: 200 } });
  const logoW = interpolate(pop, [0, 1], [0.2, 0.42]) * width;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <PulseLine mode="beat" />
      <Sequence from={16}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "3%" }}>
          <Img
            src={staticFile("pulse-logo.png")}
            style={{ width: logoW, filter: `drop-shadow(${GOLD_GLOW})`, opacity: pop }}
          />
          {SHOW_CAPTIONS ? <Text3D text={COPY.turn} delay={24} sizeVw={6} gold /> : null}
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
