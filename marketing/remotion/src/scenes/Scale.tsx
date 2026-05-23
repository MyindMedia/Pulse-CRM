import { AbsoluteFill } from "remotion";
import { ScaleGraphic } from "../components/ScaleGraphic";

// "One room to an empire": studio nodes pop in around a central Pulse hub.
export const Scale: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <ScaleGraphic />
  </AbsoluteFill>
);
