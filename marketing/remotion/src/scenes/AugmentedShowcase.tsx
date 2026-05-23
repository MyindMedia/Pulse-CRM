import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Stage3D } from "../components/Stage3D";
import { Window3D } from "../components/Window3D";
import { Menu3D } from "../components/Menu3D";
import { ClickCursor } from "../components/ClickCursor";
import { Text3D } from "../components/Text3D";
import { COPY } from "../copy";

// Each beat: a smaller focal UI window floats in front of a dimmed back-stack
// of two deeper windows (depth), the 3D menu shows the matching item active,
// a cursor glides to it and clicks (gold ripple), and a readable 3D label.
export const AugmentedShowcase: React.FC<{ data?: number[] }> = ({ data = [0] }) => {
  const { durationInFrames, width, height } = useVideoConfig();
  const each = Math.floor(durationInFrames / data.length);
  const portrait = height > width;
  const n = COPY.windows.length;
  return (
    <AbsoluteFill>
      {data.map((idx, i) => {
        const win = COPY.windows[idx];
        const back1 = COPY.windows[(idx + 1) % n];
        const back2 = COPY.windows[(idx + 2) % n];
        const menuActive = Math.min(idx, COPY.menu.length - 1);
        const clickAt = Math.round(each * 0.2);
        return (
          <Sequence key={idx} from={i * each} durationInFrames={each}>
            <Stage3D drift={5}>
              {/* dimmed back-stack for depth */}
              <div style={{ position: "absolute", left: portrait ? "30%" : "52%", top: portrait ? "30%" : "14%", width: "100%" }}>
                <Window3D shot={back1.shot} delay={4} rotateY={-16} rotateX={4} z={40} widthFrac={portrait ? 0.5 : 0.3} dim={0.35} />
              </div>
              <div style={{ position: "absolute", left: portrait ? "20%" : "30%", top: portrait ? "55%" : "44%", width: "100%" }}>
                <Window3D shot={back2.shot} delay={2} rotateY={-8} rotateX={2} z={70} widthFrac={portrait ? 0.46 : 0.28} dim={0.25} />
              </div>
              {/* 3D nav menu */}
              <div style={{ position: "absolute", left: portrait ? "7%" : "8%", top: portrait ? "9%" : "26%" }}>
                <Menu3D items={[...COPY.menu]} activeIndex={menuActive} delay={2} />
              </div>
              {/* smaller focal window */}
              <div style={{ position: "absolute", left: portrait ? "20%" : "40%", top: portrait ? "32%" : "22%", width: "100%" }}>
                <Window3D shot={win.shot} delay={8} rotateY={-12} rotateX={3} z={170} widthFrac={portrait ? 0.6 : 0.4} />
              </div>
              <ClickCursor
                from={portrait ? [70, 80] : [60, 80]}
                to={portrait ? [22, 18 + menuActive * 7] : [15, 32 + menuActive * 5]}
                start={0}
                clickAt={clickAt}
              />
            </Stage3D>
            <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: portrait ? "12% 7%" : "6% 7%" }}>
              <Text3D text={win.label} delay={clickAt + 4} sizeVw={portrait ? 4.4 : 2.7} gold depth={10} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
