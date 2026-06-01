import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, body, beatFrames, GOLD_GLOW } from "../theme";
import { COPY } from "../copy";

// Clean end card: the logo (which already reads "Pulse · by Myind Sound") over
// the gold gradient, with the studio-function options springing in beneath it.
// No tagline, no URL — the logo carries the brand and the options carry the
// pitch: this runs the whole studio. The logo breathes on the beat and the
// chips glow with it, so the card pulses with the music instead of sitting
// static. Beat-synced (not audio-sampled) so it stays in time even though it
// renders inside a transition Sequence with a reparented frame.
export const CTA: React.FC<{ data?: number[]; bpm?: number }> = ({ bpm = 120 }) => {
  const { width, fps } = useVideoConfig();
  const frame = useCurrentFrame();

  const logoP = spring({ frame, fps, config: { damping: 16, stiffness: 140 } });

  // beat pulse: a soft swell that peaks on each downbeat then decays
  const beat = beatFrames(bpm);
  const phase = (frame % beat) / beat;
  const pulse = Math.exp(-Math.pow(phase * 6, 2)); // 1 at the beat, falls off fast
  const logoScale = interpolate(logoP, [0, 1], [0.96, 1]) * (1 + pulse * 0.018);

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "5%" }}>
      <Img
        src={staticFile("pulse-logo.png")}
        style={{
          width: width * 0.36,
          filter: `drop-shadow(0 0 ${18 + pulse * 26}px rgba(253,185,19,${0.25 + pulse * 0.3}))`,
          opacity: logoP,
          transform: `translateY(${interpolate(logoP, [0, 1], [22, 0])}px) scale(${logoScale})`,
        }}
      />

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "1.1vw", maxWidth: "82%" }}>
        {COPY.endCardOptions.map((opt, i) => {
          const p = spring({ frame: frame - 14 - i * 4, fps, config: { damping: 15, stiffness: 170 } });
          // each chip glows on the beat, staggered so the row shimmers L→R
          const chipPhase = ((frame - i * 2) % beat) / beat;
          const glow = Math.exp(-Math.pow(chipPhase * 6, 2));
          return (
            <div
              key={opt}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.7vw",
                padding: "0.85vw 1.6vw",
                borderRadius: 999,
                border: `1px solid ${C.hairline2}`,
                background: C.coal2,
                fontFamily: body,
                fontWeight: 500,
                fontSize: "1.7vw",
                color: C.bone,
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [16, 0])}px)`,
                boxShadow: `0 8px 28px rgba(0,0,0,0.45), 0 0 ${glow * 18}px rgba(253,185,19,${glow * 0.4})`,
              }}
            >
              <span
                style={{
                  width: "0.7vw",
                  height: "0.7vw",
                  borderRadius: "50%",
                  background: C.gold,
                  boxShadow: `0 0 ${8 + glow * 12}px ${C.gold}`,
                  flexShrink: 0,
                }}
              />
              {opt}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
