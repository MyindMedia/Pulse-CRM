import { AbsoluteFill, Sequence } from "remotion";
import { C, BREATH } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Breath: pulse-line draws (frames 0-20), headline rises after BREATH (36).
export const ColdOpen: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
    <PulseLine mode="flat" />
    <Sequence from={BREATH}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <KineticText text={COPY.coldOpen} sizeVw={7} gold />
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);
