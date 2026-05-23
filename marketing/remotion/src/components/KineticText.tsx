import { interpolate, useCurrentFrame } from "remotion";
import { C, display } from "../theme";

// Fade + 2px rise (brand-dna motion rule). Gold key words via the gold flag.
export type KineticTextProps = {
  text: string;
  delay?: number;
  sizeVw?: number; // font-size as % of viewport width
  align?: "left" | "center";
  gold?: boolean;
};

export const KineticText: React.FC<KineticTextProps> = ({
  text,
  delay = 0,
  sizeVw = 6,
  align = "center",
  gold = false,
}) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const opacity = interpolate(t, [0, 8], [0, 1], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  const y = interpolate(t, [0, 8], [12, 0], { extrapolateRight: "clamp", extrapolateLeft: "clamp" });
  return (
    <div
      style={{
        opacity,
        transform: `translateY(${y}px)`,
        fontFamily: display,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        color: gold ? C.gold : C.bone,
        fontSize: `${sizeVw}vw`,
        lineHeight: 1.05,
        textAlign: align,
        maxWidth: "84%",
      }}
    >
      {text}
    </div>
  );
};
