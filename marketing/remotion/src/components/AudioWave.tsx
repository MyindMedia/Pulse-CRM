import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "../theme";

// Real audio-reactive gold visualizer. Samples music.mp3 at the *composition*
// frame (so it must live at the top level, outside any Sequence, to stay in
// sync), then draws a symmetric row of gold bars along the bottom — the
// "audio visual" through-line that rides the whole hype cut. Kept low-opacity
// and thin per BrandDNA restraint: it's an accent, not the subject.
export type AudioWaveProps = {
  samples?: number; // power of two; only the low/mid half is used
  heightFrac?: number; // max bar height as fraction of canvas height
  opacity?: number;
};

export const AudioWave: React.FC<AudioWaveProps> = ({ samples = 64, heightFrac = 0.16, opacity = 0.5 }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const audioData = useAudioData(staticFile("music.mp3"));
  if (!audioData) return null;

  const viz = visualizeAudio({ fps, frame, audioData, numberOfSamples: samples });
  // Use the lower half (bass + low-mid carry the musical energy), mirror it
  // around centre so the visualizer reads symmetric.
  const half = viz.slice(0, samples / 2);
  const bars = [...half].reverse().concat(half);
  const maxH = height * heightFrac;
  const baseY = height * 0.93;
  const barW = (width / bars.length) * 0.46;

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {bars.map((v, i) => {
          const amp = Math.min(1, v * 5.5); // lift quiet passages so it stays alive
          const h = 3 + amp * maxH;
          const cx = ((i + 0.5) / bars.length) * width;
          // edges sit lower so the centre reads as the focal swell
          const edgeFade = interpolate(Math.abs(i - bars.length / 2), [0, bars.length / 2], [1, 0.35]);
          return (
            <rect
              key={i}
              x={cx - barW / 2}
              y={baseY - h * edgeFade}
              width={barW}
              height={h * edgeFade}
              rx={barW / 2}
              fill={C.gold}
              style={{ filter: `drop-shadow(0 0 ${6 + amp * 10}px ${C.gold}aa)` }}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
