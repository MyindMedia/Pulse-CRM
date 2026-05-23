import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { C, body } from "../theme";
import { COPY } from "../copy";

// Fast desaturated word-flashes of the pain. No gold (withheld for the Turn).
export const Chaos: React.FC<{ data?: number[] }> = () => {
  const { durationInFrames } = useVideoConfig();
  const each = Math.floor(durationInFrames / COPY.chaos.length);
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, filter: "grayscale(1)" }}>
      {COPY.chaos.map((word, i) => (
        <Sequence key={word} from={i * each} durationInFrames={each}>
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontFamily: body, fontWeight: 700, color: C.ash, fontSize: "8vw", letterSpacing: "-0.02em" }}>
              {word}
            </div>
          </AbsoluteFill>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
