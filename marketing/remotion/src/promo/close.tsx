import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { C, body, GOLD_GLOW } from "../theme";
import { KineticHeadline } from "../components/KineticHeadline";
import { Text3D } from "../components/Text3D";

// s14 — payoff line.
export const PromoPayoff: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: "8%" }}>
    <KineticHeadline text="Turn studio chaos into a system." gold={["system"]} delay={6} sizeVw={6} />
  </AbsoluteFill>
);

// s15 — end card (logo + tagline + features + URL + beta CTA).
export const PromoEndCard: React.FC<{ data?: number[] }> = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "2.4%" }}>
      <Img src={staticFile("pulse-logo.png")} style={{ width: width * 0.34, filter: `drop-shadow(${GOLD_GLOW})` }} />
      <KineticHeadline text="Run the studio around the song." gold={["song"]} delay={8} sizeVw={3.2} />
      <div style={{ fontFamily: body, color: C.ash, fontSize: "1.3vw", letterSpacing: "0.03em", maxWidth: "72%", textAlign: "center" }}>
        Bookings · Calendars · Clients · Payments · Splits · Releases · AI operations
      </div>
      <Text3D text="studiopulse.tech" delay={22} sizeVw={3} gold depth={8} />
      <div style={{ fontFamily: body, color: C.gold, fontSize: "1.4vw" }}>Join the invite-only beta</div>
    </AbsoluteFill>
  );
};
