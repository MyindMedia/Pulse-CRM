import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, beatFrames } from "../theme";

// The recurring gold heartbeat. mode="flat" draws a calm line that
// progressively reveals; mode="beat" pulses an ECG-style spike on each beat.
export type PulseLineProps = {
  mode?: "flat" | "beat";
  bpm?: number;
  strokeWidth?: number;
  color?: string;
  heightFrac?: number; // vertical span as fraction of canvas height
};

export const PulseLine: React.FC<PulseLineProps> = ({
  mode = "flat",
  bpm = 120,
  strokeWidth = 4,
  color = C.gold,
  heightFrac = 0.18,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const midY = height / 2;
  const amp = (height * heightFrac) / 2;
  const beat = beatFrames(bpm);

  // Flat reveal: dash offset animates a left-to-right draw over 20 frames.
  const reveal = interpolate(frame, [0, 20], [width, 0], {
    extrapolateRight: "clamp",
  });

  // ECG path: flat with a spike centered, repeating each beat.
  const phase = (frame % beat) / beat; // 0..1 within a beat
  const spikeY =
    mode === "beat"
      ? midY -
        amp *
          Math.exp(-Math.pow((phase - 0.5) * 10, 2)) *
          Math.sin(phase * Math.PI * 2)
      : midY;

  const d =
    mode === "beat"
      ? `M0 ${midY} L${width * 0.42} ${midY} L${width * 0.46} ${spikeY} L${
          width * 0.5
        } ${midY + (midY - spikeY)} L${width * 0.54} ${midY} L${width} ${midY}`
      : `M0 ${midY} L${width} ${midY}`;

  return (
    <svg
      width={width}
      height={height}
      style={{ position: "absolute", inset: 0 }}
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={mode === "flat" ? width : undefined}
        strokeDashoffset={mode === "flat" ? reveal : undefined}
        style={{ filter: `drop-shadow(0 0 12px ${color}88)` }}
      />
    </svg>
  );
};
