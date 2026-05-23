import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, GOLD_GLOW } from "../theme";

// Frames a UI screenshot in Pulse glass with a slow parallax drift + scale-in.
// 2D fallback used in compact cuts where full 3D is overkill.
export type GlassFrameProps = {
  shot: string; // filename in public/shots, e.g. "dashboard.png"
  delay?: number;
  widthFrac?: number; // frame width as fraction of canvas width
  drift?: number; // px of parallax over the scene
};

export const GlassFrame: React.FC<GlassFrameProps> = ({
  shot,
  delay = 0,
  widthFrac = 0.62,
  drift = 24,
}) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const scale = interpolate(t, [0, 16], [0.96, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const opacity = interpolate(t, [0, 10], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const y = interpolate(t, [0, 120], [drift, -drift], { extrapolateLeft: "clamp" });
  return (
    <div
      style={{
        position: "relative",
        width: `${widthFrac * 100}%`,
        transform: `translateY(${y}px) scale(${scale})`,
        opacity,
        borderRadius: 18,
        overflow: "hidden",
        border: `1px solid ${C.hairline2}`,
        boxShadow: GOLD_GLOW,
        background: C.coal2,
      }}
    >
      <Img src={staticFile(`shots/${shot}`)} style={{ width: "100%", display: "block" }} />
    </div>
  );
};
