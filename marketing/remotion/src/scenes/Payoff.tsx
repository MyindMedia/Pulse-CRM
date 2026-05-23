import { AbsoluteFill } from "remotion";
import { ImageLayer } from "../components/ImageLayer";
import { PulseLine } from "../components/PulseLine";
import { KineticHeadline } from "../components/KineticHeadline";
import { COPY } from "../copy";

// Payoff: kinetic "Less chaos. More music." over the studio, calm heartbeat.
export const Payoff: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
    <ImageLayer src="studio-2am.png" zoom={1.14} pan={[20, 0]} overlay={0.64} />
    <PulseLine mode="beat" strokeWidth={3} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "8%" }}>
      <KineticHeadline text={COPY.payoff.text} gold={[...COPY.payoff.gold]} delay={6} sizeVw={6.5} />
    </AbsoluteFill>
  </AbsoluteFill>
);
