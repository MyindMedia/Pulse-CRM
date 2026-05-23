import { AbsoluteFill } from "remotion";
import { ImageLayer } from "../components/ImageLayer";
import { ConvergeGraphic } from "../components/ConvergeGraphic";

// Desaturated chaos-desk under the converge infographic: scattered sources
// get pulled into the Pulse hub.
export const Chaos: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <ImageLayer src="chaos-desk.png" zoom={1.1} overlay={0.72} grayscale={0.85} />
    <ConvergeGraphic />
  </AbsoluteFill>
);
