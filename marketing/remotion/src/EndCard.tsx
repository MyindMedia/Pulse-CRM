import { AbsoluteFill } from "remotion";
import { GradientBG } from "./components/GradientBG";
import { Particles } from "./components/Particles";
import { CTA } from "./scenes/CTA";

// Standalone end card (logo + studio-function options) over the animated
// backdrop — closes the Higgsfield AI hype clip with a crisp, on-brand outro
// that leads with what the platform runs, not a tagline or URL.
export const EndCard: React.FC = () => (
  <AbsoluteFill>
    <GradientBG />
    <Particles />
    <CTA />
  </AbsoluteFill>
);
