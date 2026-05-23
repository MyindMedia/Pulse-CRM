import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { C, body, display, GOLD_GLOW } from "../theme";
import { KineticText } from "../components/KineticText";
import { COPY } from "../copy";

// Logo + tagline + url. Holds ~1s at the end (durationInFrames covers it).
export const CTA: React.FC<{ data?: number[] }> = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "4%" }}>
      <Img src={staticFile("pulse-logo.png")} style={{ width: width * 0.4, filter: `drop-shadow(${GOLD_GLOW})` }} />
      <KineticText text={COPY.ctaTagline} delay={10} sizeVw={3.4} />
      <div style={{ fontFamily: display, fontWeight: 700, color: C.gold, fontSize: "3.6vw", letterSpacing: "0.02em" }}>
        {COPY.ctaUrl}
      </div>
      <div style={{ fontFamily: body, color: C.ash, fontSize: "1.6vw" }}>Pulse · Myind Media</div>
    </AbsoluteFill>
  );
};
