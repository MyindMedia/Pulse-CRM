import { interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

// Gold bars that grow in, staggered. Values are illustrative, not a real KPI.
export type BarChartProps = { values: number[]; delay?: number; width?: number; height?: number };

export const BarChart: React.FC<BarChartProps> = ({ values, delay = 0, width = 520, height = 280 }) => {
  const frame = useCurrentFrame();
  const max = Math.max(...values);
  const bw = width / (values.length * 1.6);
  return (
    <svg width={width} height={height}>
      {values.map((v, i) => {
        const g = interpolate(frame - delay - i * 3, [0, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const h = (v / max) * (height - 20) * g;
        return <rect key={i} x={i * bw * 1.6 + bw * 0.3} y={height - h} width={bw} height={h} rx={4} fill={C.gold} opacity={0.9} />;
      })}
    </svg>
  );
};
