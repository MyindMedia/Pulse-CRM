import { AbsoluteFill } from "remotion";
import { GradientBG } from "./components/GradientBG";
import { Particles } from "./components/Particles";
import { CTA } from "./scenes/CTA";

// Standalone end card (logo + kinetic tagline + URL) over the animated
// backdrop — used to close the Higgsfield AI hype clip with a crisp,
// on-brand, correct-URL outro.
export const EndCard: React.FC = () => (
  <AbsoluteFill>
    <GradientBG />
    <Particles />
    <CTA />
  </AbsoluteFill>
);
