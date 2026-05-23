import { AbsoluteFill, useVideoConfig } from "remotion";
import { C } from "../theme";
import { Stage3D } from "../components/Stage3D";
import { BarChart } from "../components/BarChart";
import { LineChart } from "../components/LineChart";
import { StatCounter } from "../components/StatCounter";
import { COPY } from "../copy";

// Growth: count-up stats up top, a 3D-tilted chart panel below.
export const DataViz: React.FC<{ data?: number[] }> = () => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: portrait ? "8%" : "6%",
          paddingTop: portrait ? "13%" : "8%",
        }}
      >
        {COPY.growth.stats.map((s, i) => (
          <StatCounter
            key={s.label}
            value={s.value}
            prefix={s.prefix}
            suffix={s.suffix}
            label={s.label}
            delay={8 + i * 8}
            sizeVw={portrait ? 7 : 4}
          />
        ))}
      </AbsoluteFill>
      <Stage3D drift={4} perspective={1800}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: portrait ? "62%" : "66%",
            transform: "translate(-50%,-50%) rotateY(-14deg) rotateX(6deg)",
            transformStyle: "preserve-3d",
            display: "flex",
            flexDirection: portrait ? "column" : "row",
            gap: 40,
            alignItems: "flex-end",
            background: `${C.coal}aa`,
            border: `1px solid ${C.hairline2}`,
            borderRadius: 16,
            padding: 28,
          }}
        >
          <BarChart values={[...COPY.growth.bars]} delay={6} />
          <LineChart values={[...COPY.growth.line]} delay={10} />
        </div>
      </Stage3D>
    </AbsoluteFill>
  );
};
