import { interpolate, useCurrentFrame } from "remotion";
import { C, display } from "../theme";

// Sparingly used. Counts 0 -> value. Caller supplies an honest suffix label.
export type CountUpProps = {
  value: number;
  suffix?: string;
  delay?: number;
  sizeVw?: number;
};

export const CountUp: React.FC<CountUpProps> = ({ value, suffix = "", delay = 0, sizeVw = 9 }) => {
  const frame = useCurrentFrame();
  const n = Math.round(interpolate(frame - delay, [0, 24], [0, value], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }));
  return (
    <span style={{ fontFamily: display, fontWeight: 700, color: C.gold, fontSize: `${sizeVw}vw`, letterSpacing: "-0.02em" }}>
      {n}
      {suffix}
    </span>
  );
};
