import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { C, body, GOLD_GLOW } from "../theme";
import { KineticHeadline } from "../components/KineticHeadline";
import { Text3D } from "../components/Text3D";
import { COPY } from "../copy";

// Clean end card over the gold gradient: logo, kinetic tagline, 3D url. Holds ~1s.
export const CTA: React.FC<{ data?: number[] }> = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "3.5%" }}>
      <Img src={staticFile("pulse-logo.png")} style={{ width: width * 0.36, filter: `drop-shadow(${GOLD_GLOW})` }} />
      <KineticHeadline text={COPY.ctaTagline.text} gold={[...COPY.ctaTagline.gold]} delay={8} sizeVw={3.6} />
      <Text3D text={COPY.ctaUrl} delay={20} sizeVw={3.8} gold depth={9} />
      <div style={{ fontFamily: body, color: C.ash, fontSize: "1.4vw" }}>Pulse · Myind Media</div>
    </AbsoluteFill>
  );
};
