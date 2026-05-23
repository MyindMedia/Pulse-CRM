import { interpolate, useCurrentFrame } from "remotion";
import { C, display } from "../theme";

// Linear-interpolate two hex colors (for the extrusion fade to black).
function lerpHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Extruded 3D text: a stack of offset shadow layers fading to ink gives real
// depth; a perspective rotateY tilts the face. Entrance: rotate-in + rise.
export type Text3DProps = {
  text: string;
  delay?: number;
  sizeVw?: number;
  gold?: boolean;
  depth?: number;
  align?: "left" | "center";
};

export const Text3D: React.FC<Text3DProps> = ({
  text,
  delay = 0,
  sizeVw = 7,
  gold = true,
  depth = 16,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const enter = interpolate(t, [0, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ry = interpolate(enter, [0, 1], [-26, -7]);
  const y = interpolate(enter, [0, 1], [16, 0]);

  const front = gold ? C.gold : C.bone;
  const deep = gold ? C.goldDeep : "#4a4a52";
  const layers: string[] = [];
  for (let i = 1; i <= depth; i++) {
    layers.push(`${i}px ${i}px 0 ${lerpHex(deep, C.ink, i / depth)}`);
  }

  return (
    <div style={{ perspective: 800, opacity: enter }}>
      <div
        style={{
          fontFamily: display,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          color: front,
          fontSize: `${sizeVw}vw`,
          lineHeight: 1.05,
          textAlign: align,
          maxWidth: "88%",
          transform: `translateY(${y}px) rotateY(${ry}deg)`,
          transformOrigin: "center",
          textShadow: layers.join(", "),
        }}
      >
        {text}
      </div>
    </div>
  );
};
