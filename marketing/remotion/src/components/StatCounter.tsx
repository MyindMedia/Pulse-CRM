import { interpolate, useCurrentFrame } from "remotion";
import { C, body, display } from "../theme";

// Count-up stat with a label. Figures are illustrative (no real KPIs).
export type StatCounterProps = {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  delay?: number;
  sizeVw?: number;
};

export const StatCounter: React.FC<StatCounterProps> = ({ value, prefix = "", suffix = "", label, delay = 0, sizeVw = 4 }) => {
  const f = useCurrentFrame();
  const n = Math.round(interpolate(f - delay, [0, 30], [0, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const opacity = interpolate(f - delay, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity }}>
      <span style={{ fontFamily: display, fontWeight: 800, color: C.gold, fontSize: `${sizeVw}vw`, letterSpacing: "-0.02em" }}>
        {prefix}
        {n}
        {suffix}
      </span>
      <span style={{ fontFamily: body, fontSize: `${sizeVw * 0.32}vw`, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
    </div>
  );
};
