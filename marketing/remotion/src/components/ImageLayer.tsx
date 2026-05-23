import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

// Full-bleed cinematic image with a slow Ken Burns push + a dark vignette/
// gradient overlay so foreground type and graphics stay legible.
export type ImageLayerProps = {
  src: string; // filename in public/img
  zoom?: number; // end scale for the push
  pan?: [number, number]; // end translate in px
  overlay?: number; // 0..1 darkening
  grayscale?: number; // 0..1 (for the cold chaos beat)
};

export const ImageLayer: React.FC<ImageLayerProps> = ({ src, zoom = 1.12, pan = [0, 0], overlay = 0.55, grayscale = 0 }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = interpolate(f, [0, durationInFrames], [1, zoom]);
  const tx = interpolate(f, [0, durationInFrames], [0, pan[0]]);
  const ty = interpolate(f, [0, durationInFrames], [0, pan[1]]);
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `scale(${s}) translate(${tx}px, ${ty}px)`,
          filter: grayscale ? `grayscale(${grayscale}) brightness(0.78) contrast(1.05)` : undefined,
        }}
      >
        <Img src={staticFile(`img/${src}`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            `radial-gradient(120% 100% at 50% 45%, transparent 28%, rgba(8,8,10,${overlay}) 100%),` +
            `linear-gradient(180deg, rgba(8,8,10,${overlay * 0.65}) 0%, rgba(8,8,10,${overlay}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
