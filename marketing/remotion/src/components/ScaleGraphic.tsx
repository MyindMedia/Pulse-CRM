import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, display, GOLD_GLOW } from "../theme";

// One studio becomes many: a ring of studio nodes pops in around a central
// Pulse hub, each tethered by a gold line — "one room to an empire."
export const ScaleGraphic: React.FC = () => {
  const f = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const cx = width / 2;
  const cy = height / 2;
  const count = 10;
  const R = Math.min(width, height) * 0.34;

  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {Array.from({ length: count }).map((_, i) => {
          const a = (i / count) * Math.PI * 2 - Math.PI / 2;
          const nx = cx + Math.cos(a) * R;
          const ny = cy + Math.sin(a) * R;
          const p = spring({ frame: f - 10 - i * 4, fps, config: { damping: 16, stiffness: 160 } });
          return <line key={i} x1={cx} y1={cy} x2={cx + (nx - cx) * p} y2={cy + (ny - cy) * p} stroke={C.gold} strokeWidth={2} opacity={p * 0.55} />;
        })}
      </svg>

      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2 - Math.PI / 2;
        const nx = cx + Math.cos(a) * R;
        const ny = cy + Math.sin(a) * R;
        const p = spring({ frame: f - 10 - i * 4, fps, config: { damping: 16, stiffness: 160 } });
        const x = cx + (nx - cx) * p;
        const y = cy + (ny - cy) * p;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: y, transform: "translate(-50%,-50%)", opacity: p }}>
            <div style={{ width: 40, height: 30, borderRadius: 7, background: C.coal2, border: `1px solid ${C.hairline2}` }} />
          </div>
        );
      })}

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 120, height: 120, borderRadius: 28, background: C.ink, border: `2px solid ${C.gold}`, boxShadow: GOLD_GLOW, display: "grid", placeItems: "center" }}>
          <span style={{ fontFamily: display, fontWeight: 800, color: C.gold, fontSize: "2.8vw" }}>P</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
