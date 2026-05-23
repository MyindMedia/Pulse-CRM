import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, body, display, GOLD_GLOW } from "../theme";
import { Text3D } from "../components/Text3D";
import { Stage3D } from "../components/Stage3D";
import { Window3D } from "../components/Window3D";
import { JourneyGraphic } from "../components/JourneyGraphic";
import { ScaleGraphic } from "../components/ScaleGraphic";
import { StatCounter } from "../components/StatCounter";

// Small gold caption used across solution scenes (lower third).
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

// s6 — Introducing Pulse (gold reveal + logo punch).
export const Reveal: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const pop = spring({ frame: f - 8, fps, config: { damping: 12, stiffness: 200 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "3%" }}>
      <Img src={staticFile("pulse-logo.png")} style={{ width: interpolate(pop, [0, 1], [0.22, 0.4]) * width, filter: `drop-shadow(${GOLD_GLOW})`, opacity: pop }} />
      <Text3D text="Introducing Pulse" delay={16} sizeVw={3.6} gold depth={10} />
    </AbsoluteFill>
  );
};

// s7 — song-centric: dashboard window over the song-journey pipeline.
export const SongCentric: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <Stage3D drift={4}>
      <div style={{ position: "absolute", left: "29%", top: "8%", width: "100%" }}>
        <Window3D shot="dashboard.png" delay={6} rotateY={-10} rotateX={4} z={120} widthFrac={0.42} />
      </div>
    </Stage3D>
    <JourneyGraphic />
    <Caption text="Run the studio around the song." delay={40} />
  </AbsoluteFill>
);

// s8 — shared calendar / booking (real bookings UI in 3D over gradient).
export const Calendar: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <Stage3D drift={5}>
      <div style={{ position: "absolute", left: "27%", top: "12%", width: "100%" }}>
        <Window3D shot="bookings.png" delay={6} rotateY={-12} rotateX={4} z={150} widthFrac={0.46} />
      </div>
    </Stage3D>
    <Caption text="Shared calendar. Public booking. Rooms and gear." delay={28} />
  </AbsoluteFill>
);

// s9 — pipeline kanban: a card advances Inquiry -> Booked -> Delivered -> Upsell.
export const Pipeline: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const cols = ["Inquiry", "Booked", "Delivered", "Upsell"];
  const stage = interpolate(f, [20, 140], [0, 3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", gap: "2vw" }}>
        {cols.map((c, i) => (
          <div key={c} style={{ width: "16vw", minHeight: "26vh", background: `${C.coal}cc`, border: `1px solid ${C.hairline2}`, borderRadius: 14, padding: "1vw" }}>
            <div style={{ fontFamily: body, fontSize: "1.1vw", color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.8vw" }}>{c}</div>
            {[0, 1].map((k) => (
              <div key={k} style={{ height: "3.4vh", borderRadius: 8, background: C.coal2, border: `1px solid ${C.hairline}`, marginBottom: "0.6vw", opacity: 0.5 }} />
            ))}
          </div>
        ))}
      </div>
      {/* the live gold card sliding across columns */}
      <div
        style={{
          position: "absolute",
          left: `${50 + (Math.round(stage) - 1.5) * 18}%`,
          top: "44%",
          transform: "translate(-50%,-50%)",
          width: "14vw",
          padding: "1vw",
          borderRadius: 10,
          background: C.ink,
          border: `2px solid ${C.gold}`,
          boxShadow: GOLD_GLOW,
          fontFamily: body,
          color: C.bone,
          fontSize: "1.1vw",
        }}
      >
        Paradise — full album
        <div style={{ color: C.gold, fontSize: "0.95vw", marginTop: 4 }}>{cols[Math.round(stage)]}</div>
      </div>
      <Caption text="Pipeline visibility from inquiry to revenue." delay={28} />
    </AbsoluteFill>
  );
};

// s10 — payments: invoice flips to PAID + revenue count-up.
export const Payments: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const paid = f > 55;
  const stamp = spring({ frame: f - 55, fps: 30, config: { damping: 10, stiffness: 180 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: "5vw", flexDirection: "row" }}>
      <div style={{ width: "26vw", padding: "2vw", borderRadius: 16, background: `${C.coal}dd`, border: `1px solid ${paid ? C.gold : C.hairline2}`, boxShadow: paid ? GOLD_GLOW : undefined, position: "relative" }}>
        <div style={{ fontFamily: body, color: C.ash, fontSize: "1.1vw" }}>Invoice #1042</div>
        <div style={{ fontFamily: display, color: C.bone, fontSize: "2.6vw", fontWeight: 700, margin: "0.4vw 0" }}>$2,500</div>
        <div style={{ fontFamily: body, color: paid ? C.positive : C.ash, fontSize: "1.2vw" }}>{paid ? "Paid" : "Deposit requested"}</div>
        {paid ? (
          <div style={{ position: "absolute", right: "1.5vw", top: "1.5vw", transform: `rotate(-12deg) scale(${stamp})`, border: `3px solid ${C.gold}`, color: C.gold, fontFamily: display, fontWeight: 800, fontSize: "1.6vw", padding: "0.2vw 0.8vw", borderRadius: 8 }}>PAID</div>
        ) : null}
      </div>
      <StatCounter value={48} prefix="$" suffix="k" label="revenue this month" delay={20} sizeVw={4.5} />
      <Caption text="Deposits. Milestones. Invoices. Auto-reminders." delay={28} />
    </AbsoluteFill>
  );
};

// s11 — song hub: a central song record with everything attached.
export const SongHub: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const sats = ["Sessions", "Split sheets", "Revisions", "Deliverables", "Eng. logs", "Release"];
  const cx = width / 2;
  const cy = height / 2;
  const R = Math.min(width, height) * 0.32;
  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {sats.map((_, i) => {
          const a = (i / sats.length) * Math.PI * 2 - Math.PI / 2;
          const p = spring({ frame: f - 10 - i * 4, fps, config: { damping: 16, stiffness: 150 } });
          return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(a) * R * p} y2={cy + Math.sin(a) * R * p} stroke={C.gold} strokeWidth={2} opacity={p * 0.5} />;
        })}
      </svg>
      {sats.map((s, i) => {
        const a = (i / sats.length) * Math.PI * 2 - Math.PI / 2;
        const p = spring({ frame: f - 10 - i * 4, fps, config: { damping: 16, stiffness: 150 } });
        return (
          <div key={s} style={{ position: "absolute", left: cx + Math.cos(a) * R * p, top: cy + Math.sin(a) * R * p, transform: "translate(-50%,-50%)", opacity: p, background: C.coal2, border: `1px solid ${C.hairline2}`, borderRadius: 10, padding: "0.6vw 1vw", fontFamily: body, fontSize: "1.15vw", color: C.bone, whiteSpace: "nowrap" }}>{s}</div>
        );
      })}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ background: C.ink, border: `2px solid ${C.gold}`, boxShadow: GOLD_GLOW, borderRadius: 16, padding: "1.4vw 2vw", textAlign: "center" }}>
          <div style={{ fontFamily: body, color: C.ash, fontSize: "1vw", letterSpacing: "0.1em" }}>SONG</div>
          <div style={{ fontFamily: display, color: C.gold, fontWeight: 800, fontSize: "2vw" }}>Paradise</div>
        </div>
      </AbsoluteFill>
      <Caption text="Everything tied to the track." delay={30} />
    </AbsoluteFill>
  );
};

// s12 — AI operations agents with human approval.
export const Agents: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const agents = ["Booking", "Pipeline", "Collections", "Client Success", "Ops Analyst"];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", gap: "1.4vw", flexWrap: "wrap", justifyContent: "center", maxWidth: "82%" }}>
        {agents.map((a, i) => {
          const p = spring({ frame: f - 8 - i * 6, fps, config: { damping: 15, stiffness: 160 } });
          return (
            <div key={a} style={{ width: "15vw", opacity: p, transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px)`, background: `${C.coal}dd`, border: `1px solid ${C.hairline2}`, borderRadius: 14, padding: "1.1vw" }}>
              <div style={{ fontFamily: body, color: C.ash, fontSize: "0.9vw", letterSpacing: "0.1em", textTransform: "uppercase" }}>Agent</div>
              <div style={{ fontFamily: display, color: C.bone, fontWeight: 700, fontSize: "1.5vw", margin: "0.3vw 0 0.8vw" }}>{a}</div>
              <div style={{ display: "inline-block", background: C.gold, color: C.goldInk, fontFamily: body, fontWeight: 700, fontSize: "0.95vw", padding: "0.3vw 0.9vw", borderRadius: 999 }}>Approve</div>
            </div>
          );
        })}
      </div>
      <Caption text="AI operations, with human approval." delay={36} />
    </AbsoluteFill>
  );
};

// s13 — scale: one room to an agency network.
export const Scale: React.FC<{ data?: number[] }> = () => (
  <AbsoluteFill>
    <ScaleGraphic />
    <Caption text="One studio or fifty. One operating system." delay={30} />
  </AbsoluteFill>
);
