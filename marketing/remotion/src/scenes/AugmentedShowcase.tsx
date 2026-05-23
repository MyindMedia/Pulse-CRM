import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { C } from "../theme";
import { Stage3D } from "../components/Stage3D";
import { Window3D } from "../components/Window3D";
import { Menu3D } from "../components/Menu3D";
import { ClickCursor } from "../components/ClickCursor";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Each beat: a 3D-posed UI window floats in, the 3D menu shows the matching
// item active, a cursor glides to that item and clicks (gold ripple), gold label.
export const AugmentedShowcase: React.FC<{ data?: number[] }> = ({ data = [0] }) => {
  const { durationInFrames, width, height } = useVideoConfig();
  const each = Math.floor(durationInFrames / data.length);
  const portrait = height > width;
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {data.map((idx, i) => {
        const win = COPY.windows[idx];
        const menuActive = Math.min(idx, COPY.menu.length - 1);
        const clickAt = Math.round(each * 0.2);
        return (
          <Sequence key={idx} from={i * each} durationInFrames={each}>
            <Stage3D drift={5}>
              <div style={{ position: "absolute", left: portrait ? "8%" : "9%", top: portrait ? "10%" : "26%" }}>
                <Menu3D items={[...COPY.menu]} activeIndex={menuActive} delay={2} />
              </div>
              <div style={{ position: "absolute", left: portrait ? "11%" : "38%", top: portrait ? "42%" : "20%", width: "100%" }}>
                <Window3D shot={win.shot} delay={8} rotateY={-12} rotateX={3} z={140} widthFrac={portrait ? 0.78 : 0.5} />
              </div>
              <ClickCursor
                from={portrait ? [70, 80] : [60, 80]}
                to={portrait ? [24, 18 + menuActive * 7] : [16, 32 + menuActive * 5]}
                start={0}
                clickAt={clickAt}
              />
            </Stage3D>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: portrait ? "flex-start" : "flex-end", padding: "7%" }}>
              <KineticText text={win.label} delay={clickAt + 4} sizeVw={portrait ? 5 : 3} gold />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
