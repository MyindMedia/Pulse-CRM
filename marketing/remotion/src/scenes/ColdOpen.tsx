import { AbsoluteFill, Sequence } from "remotion";
import { BREATH } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { Text3D } from "../components/Text3D";
import { COPY } from "../copy";

// Breath: pulse-line draws (frames 0-20), 3D headline rises after BREATH (36).
export const ColdOpen: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <PulseLine mode="flat" />
    <Sequence from={BREATH}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Text3D text={COPY.coldOpen} sizeVw={7} gold />
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);
