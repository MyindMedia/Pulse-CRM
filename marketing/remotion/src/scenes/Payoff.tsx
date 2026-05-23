import { AbsoluteFill } from "remotion";
import { PulseLine } from "../components/PulseLine";
import { Text3D } from "../components/Text3D";
import { COPY } from "../copy";
import { SHOW_CAPTIONS } from "../config";

// The summary line in 3D over a calm heartbeat (line hidden when captions off).
export const Payoff: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <PulseLine mode="beat" strokeWidth={3} />
    {SHOW_CAPTIONS ? (
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Text3D text={COPY.payoff} delay={8} sizeVw={5} gold depth={12} />
      </AbsoluteFill>
    ) : null}
  </AbsoluteFill>
);
