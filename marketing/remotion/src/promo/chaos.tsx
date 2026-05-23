import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, body, display } from "../theme";

// ---- Act 1 "old way": cold, grey, jittery motion graphics (no gold). ----

const COLD_BG = "#0b0b0e";

// Cold grey title line, fades + rises, faint nervous jitter.
export const ColdLine: React.FC<{ text: string; delay?: number; sizeVw?: number; danger?: boolean }> = ({ text, delay = 0, sizeVw = 4, danger = false }) => {
  const f = useCurrentFrame();
  const t = f - delay;
  const o = interpolate(t, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const y = interpolate(t, [0, 10], [16, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const jx = Math.sin(f / 5) * 0.6;
  return (
    <div style={{ opacity: o, transform: `translate(${jx}px, ${y}px)`, fontFamily: display, fontWeight: 700, letterSpacing: "-0.02em", color: danger ? C.critical : C.ash, fontSize: `${sizeVw}vw`, textAlign: "center", maxWidth: "84%" }}>
      {text}
    </div>
  );
};

// A scattered labeled chip with per-index drift + jitter.
export const Chip: React.FC<{ label: string; x: number; y: number; delay?: number; tone?: string; flag?: string }> = ({ label, x, y, delay = 0, tone = C.ash, flag }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: f - delay, fps, config: { damping: 18, stiffness: 120 } });
  const jx = Math.sin(f / 7 + x) * 4;
  const jy = Math.cos(f / 6 + y) * 4;
  return (
    <div
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        transform: `translate(-50%,-50%) translate(${jx}px,${jy}px) scale(${interpolate(p, [0, 1], [0.85, 1])})`,
        opacity: p,
        background: C.coal2,
        border: `1px solid ${flag ?? C.hairline2}`,
        borderRadius: 10,
        padding: "0.7vw 1vw",
        fontFamily: body,
        fontSize: "1.25vw",
        color: flag ?? C.ash,
        whiteSpace: "nowrap",
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      {label}
    </div>
  );
};

export const ColdBase: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ backgroundColor: COLD_BG }}>
    <AbsoluteFill style={{ background: "radial-gradient(120% 120% at 50% 50%, rgba(40,44,55,0.25), transparent 60%)" }} />
    {children}
  </AbsoluteFill>
);

// s1 — "Every studio knows the feeling."
export const ColdHook: React.FC<{ data?: number[] }> = () => (
  <ColdBase>
    {["3 unread", "missed call", "where's the file?", "room booked?"].map((l, i) => (
      <Chip key={l} label={l} x={[22, 76, 30, 70][i]} y={[28, 30, 74, 72][i]} delay={i * 4} />
    ))}
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <ColdLine text="Every studio knows the feeling." sizeVw={5} danger={false} />
    </AbsoluteFill>
  </ColdBase>
);

// s2 — booked but room not ready / paid but no invoice.
export const ScatterCards: React.FC<{ data?: number[] }> = () => (
  <ColdBase>
    <Chip label="Session booked ✓" x={26} y={26} delay={2} />
    <Chip label="Room not ready ✕" x={72} y={24} delay={6} flag={C.critical} />
    <Chip label="Deposit paid ✓" x={24} y={70} delay={10} />
    <Chip label="Invoice — ???" x={74} y={72} delay={14} flag={C.critical} />
    <Chip label="mix_final.wav" x={40} y={48} delay={18} />
    <Chip label="mix_final_2.wav" x={56} y={52} delay={20} />
    <Chip label="mix_REAL_final.wav" x={48} y={62} delay={22} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "8%" }}>
      <ColdLine text="Bookings. Files. Payments. Deadlines." delay={26} sizeVw={3.4} />
    </AbsoluteFill>
  </ColdBase>
);

// s3 — the song moves, the business scatters. (lone gold waveform amid grey app tiles)
export const DisconnectedApps: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const apps = ["Calendar", "Notes", "Email", "Spreadsheet", "Drive", "Payments"];
  return (
    <ColdBase>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <svg width={width * 0.5} height={120}>
          <path
            d={`M0 60 ${Array.from({ length: 40 }).map((_, i) => `L${i * (width * 0.5 / 40)} ${60 + Math.sin(i / 2 + f / 4) * (i % 3 === 0 ? 34 : 14)}`).join(" ")}`}
            fill="none"
            stroke={C.gold}
            strokeWidth={3}
            style={{ filter: `drop-shadow(0 0 8px ${C.gold}88)` }}
          />
        </svg>
      </AbsoluteFill>
      {apps.map((a, i) => {
        const ang = (i / apps.length) * Math.PI * 2 - Math.PI / 2;
        const R = Math.min(width, height) * 0.36;
        return <Chip key={a} label={a} x={50 + (Math.cos(ang) * R) / width * 100} y={50 + (Math.sin(ang) * R) / height * 100} delay={i * 4} />;
      })}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "8%" }}>
        <ColdLine text="Scattered tools slow down great work." delay={24} sizeVw={3.4} />
      </AbsoluteFill>
    </ColdBase>
  );
};

// s4 — sticky notes, group chats, forgotten splits.
export const StickyChaos: React.FC<{ data?: number[] }> = () => (
  <ColdBase>
    <Chip label="“Who has the latest mix?”" x={30} y={26} delay={2} />
    <Chip label="splits — TBD" x={72} y={30} delay={6} flag={C.critical} />
    <Chip label="call the client back" x={24} y={54} delay={10} />
    <Chip label="INVOICE OVERDUE" x={74} y={58} delay={14} flag={C.critical} />
    <Chip label="reschedule Tue?" x={42} y={74} delay={18} />
    <Chip label="deposit?" x={60} y={76} delay={20} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "8%" }}>
      <ColdLine text="The old way was never built for modern studios." delay={24} sizeVw={3.2} />
    </AbsoluteFill>
  </ColdBase>
);

// s5 — everyone in a different place, momentum disappears.
export const GapsFreeze: React.FC<{ data?: number[] }> = () => {
  const f = useCurrentFrame();
  const drift = interpolate(f, [0, 90], [0, 60], { extrapolateRight: "clamp" });
  const lanes = ["Engineer A", "Engineer B", "Artist", "Client"];
  return (
    <ColdBase>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "3.5vh" }}>
        {lanes.map((l, i) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 12, transform: `translateX(${(i % 2 ? 1 : -1) * drift}px)`, opacity: interpolate(f, [i * 5, i * 5 + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
            <span style={{ fontFamily: body, color: C.ashDim, fontSize: "1.3vw", width: 120, textAlign: "right" }}>{l}</span>
            <div style={{ width: 220, height: 10, borderRadius: 5, background: C.coal2, border: `1px solid ${C.hairline}` }} />
            <div style={{ width: 30 }} />
            <div style={{ width: 120, height: 10, borderRadius: 5, background: C.coal2, border: `1px solid ${C.hairline}` }} />
          </div>
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", padding: "8%" }}>
        <ColdLine text="Momentum gets lost in the gaps." delay={24} sizeVw={3.6} danger />
      </AbsoluteFill>
    </ColdBase>
  );
};
