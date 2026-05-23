import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

// Perspective container with a slow camera-style drift, for 3D scenes.
export type Stage3DProps = { children: React.ReactNode; perspective?: number; drift?: number };

export const Stage3D: React.FC<Stage3DProps> = ({ children, perspective = 1500, drift = 6 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const ry = interpolate(frame, [0, durationInFrames], [-drift, drift]);
  const rx = interpolate(frame, [0, durationInFrames], [drift / 2, -drift / 2]);
  return (
    <AbsoluteFill style={{ perspective, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          transformStyle: "preserve-3d",
          transform: `rotateY(${ry}deg) rotateX(${rx}deg)`,
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};
