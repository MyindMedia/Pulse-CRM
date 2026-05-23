import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";

// Slow-drifting gold dust above the gradient — a living, premium backdrop.
// Deterministic per-index positions so renders are stable.
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export const Particles: React.FC<{ count?: number }> = ({ count = 48 }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  return (
    <AbsoluteFill>
      {Array.from({ length: count }).map((_, i) => {
        const rx = rand(i, 1);
        const ry = rand(i, 2);
        const x = rx * width;
        const speed = 0.15 + rx * 0.45;
        const y = height - (((f * speed + ry * height) % (height + 60)) - 30);
        const size = 1.5 + rand(i, 3) * 3.5;
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(f / 22 + i));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: "50%",
              background: C.gold,
              opacity: tw * 0.45,
              filter: "blur(0.5px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};
