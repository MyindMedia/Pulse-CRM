import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { C, beatFrames } from "../theme";

// A single cinematic/product plate with motion + the brand grade:
//  - slow Ken-Burns push across the whole shot so static AI footage breathes
//  - a subtle beat-synced pop (120bpm) layered on top so cuts feel musical
//  - the "studio at 2am" grade: crushed blacks, warm highlights, desat greens,
//    a legibility vignette, and a faint gold soft-light wash (BrandDNA #4)
export type PlateProps = {
  src: string; // file in public/plates
  durationInFrames: number;
  bpm?: number;
};

// CSS approximation of the BrandDNA grade: lift contrast (crush blacks),
// pull brightness down a touch, desaturate, then warm via sepia + hue nudge.
const GRADE = "contrast(1.16) brightness(0.93) saturate(0.86) sepia(0.12) hue-rotate(-6deg)";

export const Plate: React.FC<PlateProps> = ({ src, durationInFrames, bpm = 120 }) => {
  const frame = useCurrentFrame();

  const push = interpolate(frame, [0, durationInFrames], [1.0, 1.08], { extrapolateRight: "clamp" });
  const beat = beatFrames(bpm);
  const phase = (frame % beat) / beat; // 0..1 within a beat
  const pop = 0.014 * Math.exp(-Math.pow(phase * 7, 2)); // quick decaying bump on each beat
  const scale = push + pop;

  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo
          src={staticFile(`plates/${src}`)}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", filter: GRADE }}
        />
      </AbsoluteFill>
      {/* warm gold wash — punctuation, not decoration */}
      <AbsoluteFill style={{ backgroundColor: C.gold, mixBlendMode: "soft-light", opacity: 0.07 }} />
      {/* legibility + cinematic vignette */}
      <AbsoluteFill style={{ background: "radial-gradient(128% 100% at 50% 46%, transparent 38%, rgba(8,8,10,0.6) 100%)" }} />
    </AbsoluteFill>
  );
};
