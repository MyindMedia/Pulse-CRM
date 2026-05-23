import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, body, GOLD_GLOW } from "../theme";
import { COPY } from "../copy";

// Song-journey pipeline: a gold line draws left-to-right and lights each
// stage (Idea -> Demo -> ... -> Release) as it passes.
export const JourneyGraphic: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const steps = COPY.journey;
  const n = steps.length;
  const y = height * 0.52;
  const m = width * 0.12;
  const span = width - 2 * m;
  const stepX = (i: number) => m + span * (i / (n - 1));
  const prog = interpolate(f, [10, durationInFrames * 0.85], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const draw = span * (1 - prog);

  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <line x1={m} y1={y} x2={width - m} y2={y} stroke={C.hairline2} strokeWidth={3} />
        <line
          x1={m}
          y1={y}
          x2={width - m}
          y2={y}
          stroke={C.gold}
          strokeWidth={3}
          strokeDasharray={span}
          strokeDashoffset={draw}
          style={{ filter: `drop-shadow(0 0 8px ${C.gold}88)` }}
        />
      </svg>
      {steps.map((s, i) => {
        const active = prog >= i / (n - 1) - 0.001;
        const size = active ? 24 : 14;
        return (
          <div key={s} style={{ position: "absolute", left: stepX(i), top: y, transform: "translate(-50%,-50%)" }}>
            <div
              style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background: active ? C.gold : C.coal2,
                border: `2px solid ${active ? C.gold : C.hairline2}`,
                boxShadow: active ? GOLD_GLOW : undefined,
              }}
            />
            <span
              style={{
                position: "absolute",
                top: 30,
                left: "50%",
                transform: "translateX(-50%)",
                fontFamily: body,
                fontSize: "1.3vw",
                color: active ? C.bone : C.ashDim,
                whiteSpace: "nowrap",
              }}
            >
              {s}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
