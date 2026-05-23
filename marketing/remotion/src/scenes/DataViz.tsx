import { AbsoluteFill, useVideoConfig } from "remotion";
import { C } from "../theme";
import { Stage3D } from "../components/Stage3D";
import { BarChart } from "../components/BarChart";
import { LineChart } from "../components/LineChart";
import { Text3D } from "../components/Text3D";
import { COPY } from "../copy";

// A 3D-tilted data panel: gold bars grow + a gold area/line draws in.
export const DataViz: React.FC<{ data?: number[] }> = () => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: portrait ? "16%" : "9%" }}>
        <Text3D text={COPY.dataViz.headline} sizeVw={portrait ? 5 : 3.2} gold depth={12} />
      </AbsoluteFill>
      <Stage3D drift={4} perspective={1800}>
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: portrait ? "58%" : "62%",
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
          <BarChart values={[...COPY.dataViz.bars]} delay={6} />
          <LineChart values={[...COPY.dataViz.line]} delay={10} />
        </div>
      </Stage3D>
    </AbsoluteFill>
  );
};
