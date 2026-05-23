import { AbsoluteFill, Sequence } from "remotion";
import { BREATH } from "../theme";
import { ImageLayer } from "../components/ImageLayer";
import { PulseLine } from "../components/PulseLine";
import { KineticHeadline } from "../components/KineticHeadline";
import { COPY } from "../copy";

// Cinematic studio-at-2am push, gold pulse-line, then the kinetic hook line.
export const Hook: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <ImageLayer src="studio-2am.png" zoom={1.14} pan={[-30, 0]} overlay={0.62} />
    <PulseLine mode="flat" />
    <Sequence from={BREATH}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "8%" }}>
        <KineticHeadline text={COPY.hook.text} gold={[...COPY.hook.gold]} sizeVw={6} />
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);
