import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { C, body, GOLD_GLOW } from "../theme";
import { KineticText } from "../components/KineticText";
import { Text3D } from "../components/Text3D";
import { COPY } from "../copy";

// Logo + tagline + 3D url. Holds ~1s at the end (durationInFrames covers it).
export const CTA: React.FC<{ data?: number[] }> = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "4%" }}>
      <Img src={staticFile("pulse-logo.png")} style={{ width: width * 0.4, filter: `drop-shadow(${GOLD_GLOW})` }} />
      <KineticText text={COPY.ctaTagline} delay={10} sizeVw={3.2} />
      <Text3D text={COPY.ctaUrl} delay={18} sizeVw={4} gold depth={9} />
      <div style={{ fontFamily: body, color: C.ash, fontSize: "1.6vw" }}>Pulse · Myind Media</div>
    </AbsoluteFill>
  );
};
