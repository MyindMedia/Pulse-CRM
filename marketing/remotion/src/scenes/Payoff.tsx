import { AbsoluteFill } from "remotion";
import { C } from "../theme";
import { PulseLine } from "../components/PulseLine";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// The summary line over a calm heartbeat.
export const Payoff: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center" }}>
    <PulseLine mode="beat" strokeWidth={3} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <KineticText text={COPY.payoff} delay={8} sizeVw={5.4} gold />
    </AbsoluteFill>
  </AbsoluteFill>
);
