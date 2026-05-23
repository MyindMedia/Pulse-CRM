import { AbsoluteFill } from "remotion";
import { KineticHeadline } from "../components/KineticHeadline";
import { COPY } from "../copy";

// Payoff: kinetic "Less chaos. More music." over the gradient backdrop.
export const Payoff: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "8%" }}>
    <KineticHeadline text={COPY.payoff.text} gold={[...COPY.payoff.gold]} delay={6} sizeVw={6.5} />
  </AbsoluteFill>
);
