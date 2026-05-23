import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, body } from "../theme";

// Tilted Pulse nav panel; items stagger-pop forward on translateZ. One active.
export type Menu3DProps = { items: string[]; delay?: number; activeIndex?: number };

export const Menu3D: React.FC<Menu3DProps> = ({ items, delay = 0, activeIndex = -1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        transform: "rotateY(-20deg) rotateX(4deg)",
        transformStyle: "preserve-3d",
        background: `${C.coal}cc`,
        border: `1px solid ${C.hairline2}`,
        borderRadius: 14,
        padding: "1.4vw 1.2vw",
        backdropFilter: "blur(8px)",
      }}
    >
      {items.map((it, i) => {
        const p = spring({ frame: frame - delay - i * 4, fps, config: { damping: 14, stiffness: 180 } });
        const active = i === activeIndex;
        return (
          <div
            key={it}
            style={{
              fontFamily: body,
              fontWeight: active ? 700 : 500,
              color: active ? C.gold : C.bone,
              fontSize: "1.6vw",
              padding: "0.7vw 1vw",
              marginBottom: 4,
              borderRadius: 8,
              background: active ? `${C.gold}22` : "transparent",
              opacity: p,
              transform: `translateZ(${interpolate(p, [0, 1], [0, 30])}px)`,
            }}
          >
            {it}
          </div>
        );
      })}
    </div>
  );
};
