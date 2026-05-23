import { interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";

// from/to are [x%, y%] of the parent. Cursor glides start->clickAt, then ripples.
export type ClickCursorProps = { from: [number, number]; to: [number, number]; start?: number; clickAt: number };

export const ClickCursor: React.FC<ClickCursorProps> = ({ from, to, start = 0, clickAt }) => {
  const frame = useCurrentFrame();
  const px = interpolate(frame, [start, clickAt], [from[0], to[0]], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const py = interpolate(frame, [start, clickAt], [from[1], to[1]], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const press = interpolate(frame, [clickAt - 2, clickAt, clickAt + 4], [1, 0.8, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ripple = interpolate(frame, [clickAt, clickAt + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: `${px}%`, top: `${py}%`, transform: "translate(-50%,-50%)", zIndex: 10 }}>
      {frame >= clickAt ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: "translate(-50%,-50%)",
            width: 60 * ripple,
            height: 60 * ripple,
            borderRadius: "50%",
            border: `2px solid ${C.gold}`,
            opacity: 1 - ripple,
          }}
        />
      ) : null}
      <div style={{ width: 22, height: 22, transform: `scale(${press})` }}>
        <svg viewBox="0 0 24 24" width="22" height="22">
          <path d="M4 2l16 9-7 2-3 7z" fill={C.bone} stroke={C.ink} strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
};
