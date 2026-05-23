import { AbsoluteFill } from "remotion";
import { ConvergeGraphic } from "../components/ConvergeGraphic";

// Converge infographic over the animated gradient: scattered sources get
// pulled into the Pulse hub.
export const Chaos: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <ConvergeGraphic />
  </AbsoluteFill>
);
