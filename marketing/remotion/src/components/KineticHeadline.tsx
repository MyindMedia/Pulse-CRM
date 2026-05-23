import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, display } from "../theme";

// Word-by-word kinetic typography: each word springs up + rotates into place,
// flagged words render gold. Used for the hook, payoff, and CTA moments.
export type KineticHeadlineProps = {
  text: string;
  gold?: string[];
  delay?: number;
  sizeVw?: number;
};

const norm = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "");

export const KineticHeadline: React.FC<KineticHeadlineProps> = ({ text, gold = [], delay = 0, sizeVw = 6 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  const goldSet = new Set(gold.map(norm));
  // Block + inline-block spans so word spacing (marginRight em) resolves
  // against each span's own font-size, and words wrap + center naturally.
  return (
    <div style={{ textAlign: "center", maxWidth: "88%", perspective: 700 }}>
      {words.map((w, i) => {
        const p = spring({ frame: frame - delay - i * 3, fps, config: { damping: 14, stiffness: 160 } });
        const isGold = goldSet.has(norm(w));
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              marginRight: "0.28em",
              fontFamily: display,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              fontSize: `${sizeVw}vw`,
              lineHeight: 1.12,
              color: isGold ? C.gold : C.bone,
              opacity: p,
              transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px) rotateX(${interpolate(p, [0, 1], [-70, 0])}deg)`,
              transformOrigin: "bottom",
              textShadow: "0 6px 24px rgba(0,0,0,0.6)",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};
