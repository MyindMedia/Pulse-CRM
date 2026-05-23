import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

// Animated gradient backdrop: two gold radial glows drift across the ink base
// and pulse gently (~every 2 beats at 142bpm), plus a dark vignette for depth.
export const GradientBG: React.FC = () => {
  const f = useCurrentFrame();
  const x1 = 30 + Math.sin(f / 70) * 16;
  const y1 = 32 + Math.cos(f / 85) * 12;
  const x2 = 68 + Math.cos(f / 60) * 16;
  const y2 = 66 + Math.sin(f / 95) * 12;
  const pulse = interpolate(Math.sin((f / 25.3) * Math.PI * 2), [-1, 1], [0.07, 0.15]);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.ink,
        backgroundImage:
          `radial-gradient(42% 38% at ${x1}% ${y1}%, rgba(253,185,19,${pulse}), transparent 70%),` +
          `radial-gradient(46% 42% at ${x2}% ${y2}%, rgba(201,138,0,${pulse * 0.7}), transparent 72%),` +
          `radial-gradient(130% 120% at 50% 125%, rgba(8,8,10,0.65), transparent 60%)`,
      }}
    />
  );
};
