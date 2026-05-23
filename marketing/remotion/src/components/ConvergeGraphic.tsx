import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, body, display, GOLD_GLOW } from "../theme";
import { COPY } from "../copy";

// Scattered "chaos" sources orbit, then get pulled along gold connector lines
// into a single Pulse hub — the visual thesis of the whole ad.
export const ConvergeGraphic: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const cx = width / 2;
  const cy = height / 2;
  const nodes = COPY.chaosNodes;
  const R = Math.min(width, height) * 0.36;
  const conv = interpolate(f, [durationInFrames * 0.42, durationInFrames * 0.82], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const hubIn = interpolate(conv, [0.2, 0.7], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {nodes.map((_, i) => {
          const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const nx = cx + Math.cos(a) * R;
          const ny = cy + Math.sin(a) * R;
          const lx = interpolate(conv, [0, 1], [nx, cx]);
          const ly = interpolate(conv, [0, 1], [ny, cy]);
          return <line key={i} x1={lx} y1={ly} x2={cx} y2={cy} stroke={C.gold} strokeWidth={2} opacity={conv * 0.5} />;
        })}
      </svg>

      {nodes.map((label, i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const nx = cx + Math.cos(a) * R;
        const ny = cy + Math.sin(a) * R;
        const x = interpolate(conv, [0, 1], [nx, cx]);
        const y = interpolate(conv, [0, 1], [ny, cy]);
        const fade = interpolate(conv, [0.6, 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={label} style={{ position: "absolute", left: x, top: y, transform: "translate(-50%,-50%)", opacity: fade, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: C.coal2, border: `1px solid ${C.hairline2}`, display: "grid", placeItems: "center" }}>
              <div style={{ width: 16, height: 16, borderRadius: 4, background: C.ash }} />
            </div>
            <span style={{ fontFamily: body, fontSize: "1.3vw", color: C.ash }}>{label}</span>
          </div>
        );
      })}

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: interpolate(hubIn, [0, 1], [64, 116]),
            height: interpolate(hubIn, [0, 1], [64, 116]),
            borderRadius: 26,
            background: C.ink,
            border: `2px solid ${C.gold}`,
            boxShadow: GOLD_GLOW,
            display: "grid",
            placeItems: "center",
            opacity: hubIn,
          }}
        >
          <span style={{ fontFamily: display, fontWeight: 800, color: C.gold, fontSize: "2.6vw" }}>P</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
