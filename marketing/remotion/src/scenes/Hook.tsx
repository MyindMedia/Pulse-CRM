import { AbsoluteFill, Sequence } from "remotion";
import { BREATH } from "../theme";
import { KineticHeadline } from "../components/KineticHeadline";
import { COPY } from "../copy";

// Kinetic hook line over the animated gradient backdrop (no photo, no line).
export const Hook: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <Sequence from={BREATH}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "8%" }}>
        <KineticHeadline text={COPY.hook.text} gold={[...COPY.hook.gold]} sizeVw={6} />
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);
