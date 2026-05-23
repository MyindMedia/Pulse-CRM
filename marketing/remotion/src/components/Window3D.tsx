import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, GOLD_GLOW } from "../theme";

// A UI screenshot posed as a glass panel in 3D space, with a gentle float.
export type Window3DProps = {
  shot: string;
  delay?: number;
  x?: number;
  y?: number;
  z?: number;
  rotateY?: number;
  rotateX?: number;
  widthFrac?: number;
  dim?: number; // multiplies final opacity (for back-stack depth layers)
};

export const Window3D: React.FC<Window3DProps> = ({
  shot,
  delay = 0,
  x = 0,
  y = 0,
  z = 0,
  rotateY = 0,
  rotateX = 0,
  widthFrac = 0.5,
  dim = 1,
}) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const enter = interpolate(t, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const float = Math.sin((frame + delay) / 30) * 6;
  const scale = interpolate(enter, [0, 1], [0.9, 1]);
  return (
    <div
      style={{
        position: "absolute",
        width: `${widthFrac * 100}%`,
        transform: `translate3d(${x}px, ${y + float}px, ${z * enter}px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${scale})`,
        opacity: enter * dim,
        borderRadius: 16,
        overflow: "hidden",
        border: `1px solid ${C.hairline2}`,
        boxShadow: GOLD_GLOW,
        background: C.coal2,
        transformStyle: "preserve-3d",
      }}
    >
      <Img src={staticFile(`shots/${shot}`)} style={{ width: "100%", display: "block" }} />
    </div>
  );
};
