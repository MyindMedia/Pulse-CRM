import { AbsoluteFill, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, display, GOLD_GLOW } from "../theme";
import { Chip, ColdLine, ColdBase } from "./chaos";
import { PulseLine } from "../components/PulseLine";
import { ConvergeGraphic } from "../components/ConvergeGraphic";
import { JourneyGraphic } from "../components/JourneyGraphic";
import { Stage3D } from "../components/Stage3D";
import { Window3D } from "../components/Window3D";
import { Text3D } from "../components/Text3D";

// Reused feature graphics from the solution set.
export { Pipeline, Payments, SongHub, Agents, Scale } from "./solution";

const Caption: React.FC<{ text: string; delay?: number }> = ({ text, delay = 0 }) => {
  const f = useCurrentFrame();
  const o = interpolate(f - delay, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(f - delay, [0, 12], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "6%" }}>
      <div style={{ opacity: o, transform: `translateY(${y}px)`, fontFamily: display, fontWeight: 700, letterSpacing: "-0.02em", color: C.bone, fontSize: "2.4vw", textAlign: "center" }}>{text}</div>
    </AbsoluteFill>
  );
};

const FloatWindow: React.FC<{ shot: string; delay?: number; left?: string; widthFrac?: number; rotateY?: number }> = ({ shot, delay = 6, left = "27%", widthFrac = 0.46, rotateY = -12 }) => (
  <Stage3D drift={5}>
    <div style={{ position: "absolute", left, top: "13%", width: "100%" }}>
      <Window3D shot={shot} delay={delay} rotateY={rotateY} rotateX={4} z={150} widthFrac={widthFrac} />
    </div>
  </Stage3D>
);

// 1 — rhythm open: gold waveform breathing in darkness.
export const RhythmOpen: React.FC<{ data?: number[] }> = () => (
  <ColdBase>
    <PulseLine mode="flat" />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <ColdLine text="Every studio has a rhythm." sizeVw={5} />
    </AbsoluteFill>
  </ColdBase>
);

// 2 — chaos build: out of sync.
export const ChaosBuild: React.FC<{ data?: number[] }> = () => (
  <ColdBase>
    <Chip label="3 unread" x={24} y={26} delay={2} />
    <Chip label="double-booked" x={74} y={24} delay={6} flag={C.critical} />
    <Chip label="where's the file?" x={28} y={72} delay={10} />
    <Chip label="invoice overdue" x={74} y={70} delay={14} flag={C.critical} />
    <Chip label="reschedule?" x={50} y={50} delay={18} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "8%" }}>
      <ColdLine text="Out of sync." sizeVw={4.2} danger delay={20} />
    </AbsoluteFill>
  </ColdBase>
);

// 3 — pain points: kinetic keywords.
export const PainPoints: React.FC<{ data?: number[] }> = () => (
  <ColdBase>
    <Chip label="text threads" x={26} y={30} delay={2} />
    <Chip label="random folders" x={72} y={32} delay={6} />
    <Chip label="splits — TBD" x={28} y={66} delay={10} flag={C.critical} />
    <Chip label="follow up later" x={72} y={68} delay={14} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <ColdLine text="Bookings. Files. Splits. Payments." sizeVw={4.4} delay={6} />
    </AbsoluteFill>
  </ColdBase>
);

// 4 — the song gets buried.
export const SongBuried: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const bury = interpolate(f, [10, 80], [0, 1], { extrapolateRight: "clamp" });
  const labels = ["DM", "invoice", "note", "file", "alert", "calendar", "mix?", "split"];
  return (
    <ColdBase>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - bury * 0.7 }}>
        <PulseLine mode="beat" color={C.goldDeep} />
      </AbsoluteFill>
      {labels.map((l, i) => {
        const a = (i / labels.length) * Math.PI * 2;
        const startR = 60;
        const r = interpolate(bury, [0, 1], [38, 6]);
        return <Chip key={l} label={l} x={50 + Math.cos(a) * r} y={50 + Math.sin(a) * r * 0.8} delay={i * 3} flag={i % 3 === 0 ? C.critical : undefined} />;
      })}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "8%" }}>
        <ColdLine text="The song gets buried." sizeVw={4} danger delay={30} />
      </AbsoluteFill>
    </ColdBase>
  );
};

// 5 — Pulse reveal: clutter snaps into the gold hub.
export const PulseReveal: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <ConvergeGraphic />
    <Sequence from={64}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "10%" }}>
        <Text3D text="Introducing Pulse" sizeVw={3.6} gold depth={10} />
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);

// 6 — built around the song (real Songs UI + journey).
export const SongCentric: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <Stage3D drift={4}>
      <div style={{ position: "absolute", left: "29%", top: "8%", width: "100%" }}>
        <Window3D shot="songs.png" delay={6} rotateY={-10} rotateX={4} z={120} widthFrac={0.42} />
      </div>
    </Stage3D>
    <JourneyGraphic />
    <Caption text="Built around the song." delay={40} />
  </AbsoluteFill>
);

// 8 — real-UI montage: every surface flashes by.
export const Montage: React.FC<{ data?: number[] }> = () => {
  const { durationInFrames } = useVideoConfig();
  const shots = ["studio.png", "roster.png", "inventory.png", "releases.png", "licensing.png", "dashboard.png"];
  const each = Math.floor(durationInFrames / shots.length);
  return (
    <AbsoluteFill>
      {shots.map((shot, i) => (
        <Sequence key={shot} from={i * each} durationInFrames={each + 8}>
          <FloatWindow shot={shot} delay={0} left={i % 2 ? "30%" : "24%"} widthFrac={0.5} rotateY={i % 2 ? 10 : -12} />
        </Sequence>
      ))}
      <Caption text="One command center for the whole studio." delay={20} />
    </AbsoluteFill>
  );
};

// 9 — bookings / calendar (real Calendar UI).
export const Calendar: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <FloatWindow shot="calendar.png" widthFrac={0.5} />
    <Caption text="Bookings that move straight into the pipeline." delay={28} />
  </AbsoluteFill>
);

// 14 — end card.
export const TreatmentEndCard: React.FC<{ data?: number[] }> = () => {
  const { width } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "2.4%" }}>
      <Img src={staticFile("pulse-logo.png")} style={{ width: width * 0.34, filter: `drop-shadow(${GOLD_GLOW})` }} />
      <Text3D text="Run the studio around the song." delay={8} sizeVw={3.2} gold depth={8} />
      <div style={{ fontFamily: display, color: C.ash, fontSize: "1.3vw", letterSpacing: "0.03em", maxWidth: "74%", textAlign: "center", fontWeight: 500 }}>
        Bookings · Calendars · Clients · Payments · Splits · Releases · AI operations
      </div>
      <Text3D text="studiopulse.tech" delay={22} sizeVw={3} gold depth={8} />
      <div style={{ fontFamily: display, color: C.gold, fontSize: "1.5vw", fontWeight: 700 }}>Get early access</div>
    </AbsoluteFill>
  );
};
