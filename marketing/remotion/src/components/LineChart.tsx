import { interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

// Gold area/line that draws in via stroke-dashoffset. Illustrative values.
export type LineChartProps = { values: number[]; delay?: number; width?: number; height?: number };

export const LineChart: React.FC<LineChartProps> = ({ values, delay = 0, width = 560, height = 260 }) => {
  const frame = useCurrentFrame();
  const max = Math.max(...values);
  const stepX = width / (values.length - 1);
  const pts = values.map((v, i) => [i * stepX, height - (v / max) * (height - 20)] as const);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]} ${p[1]}`).join(" ");
  const len = 2000;
  const draw = interpolate(frame - delay, [0, 40], [len, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <svg width={width} height={height}>
      <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={`${C.gold}18`} />
      <path
        d={d}
        fill="none"
        stroke={C.gold}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={len}
        strokeDashoffset={draw}
        style={{ filter: `drop-shadow(0 0 10px ${C.gold}88)` }}
      />
    </svg>
  );
};
