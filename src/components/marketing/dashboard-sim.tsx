"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  LayoutDashboard,
  GitBranch,
  CalendarDays,
  Inbox,
  CreditCard,
  Search,
  Bell,
  MousePointer2,
  TrendingUp,
} from "lucide-react";

/* Live, looping "simulated app navigation" that plays inside the hero monitor.
 * A cursor steps down the sidebar while the main panel cross-fades between the
 * Dashboard, Pipeline, Calendar and Inbox screens; KPIs count up and a booking
 * toast lands. Built from the real chrome palette so it reads as the actual
 * Pulse UI (no AI hallucination). All sizing is em off a single cqw root, so it
 * scales with the monitor width. Reduced-motion renders the dashboard, static. */

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: GitBranch, label: "Pipeline" },
  { icon: CalendarDays, label: "Calendar" },
  { icon: Inbox, label: "Inbox" },
  { icon: CreditCard, label: "Payments" },
];

const SCREEN_MS = 3200;

function useCountUp(target: number, run: boolean, ms = 900) {
  const [v, setV] = React.useState(run ? 0 : target);
  React.useEffect(() => {
    if (!run) {
      setV(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

function Kpi({ label, value, prefix = "", suffix = "", run }: { label: string; value: number; prefix?: string; suffix?: string; run: boolean }) {
  const v = useCountUp(value, run);
  const display = value >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
  return (
    <div className="flex flex-col gap-[0.3em] rounded-[0.7em] border border-graphite/50 bg-coal/70 p-[0.8em]">
      <span className="font-meta text-[0.62em] uppercase tracking-[0.12em] text-steel/70">{label}</span>
      <span className="font-grotesk text-[1.5em] font-semibold leading-none text-bone">
        {prefix}{display}{suffix}
      </span>
    </div>
  );
}

function Sparkline({ run }: { run: boolean }) {
  const d = "M0,46 L14,44 L28,45 L42,40 L56,41 L70,33 L84,35 L98,22 L112,26 L126,12 L140,16 L154,6";
  return (
    <svg viewBox="0 0 154 52" className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sim-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fdb913" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#fdb913" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={`${d} L154,52 L0,52 Z`}
        fill="url(#sim-spark)"
        initial={run ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke="#fdb913"
        strokeWidth="1.5"
        strokeLinecap="round"
        initial={run ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      />
    </svg>
  );
}

function DashboardScreen({ run }: { run: boolean }) {
  return (
    <div className="flex h-full flex-col gap-[0.8em]">
      <div className="grid grid-cols-4 gap-[0.7em]">
        <Kpi label="Revenue MTD" value={28.2} prefix="$" suffix="k" run={run} />
        <Kpi label="Sessions" value={142} run={run} />
        <Kpi label="Pipeline" value={39.1} prefix="$" suffix="k" run={run} />
        <Kpi label="Utilization" value={82} suffix="%" run={run} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-[0.7em]">
        <div className="flex flex-col gap-[0.5em] rounded-[0.7em] border border-graphite/50 bg-coal/70 p-[0.8em]">
          <div className="flex items-center justify-between">
            <span className="font-meta text-[0.62em] uppercase tracking-[0.12em] text-steel/70">Revenue · 12 mo</span>
            <span className="flex items-center gap-[0.3em] text-[0.66em] font-medium text-gold"><TrendingUp className="size-[1em]" />+18%</span>
          </div>
          <div className="min-h-0 flex-1"><Sparkline run={run} /></div>
        </div>
        <div className="flex flex-col gap-[0.45em] rounded-[0.7em] border border-graphite/50 bg-coal/70 p-[0.8em]">
          <span className="font-meta text-[0.62em] uppercase tracking-[0.12em] text-steel/70">Today</span>
          {["Studio A · Mixing", "Booth 2 · Vocals", "Studio A · Master"].map((r, i) => (
            <div key={r} className="flex items-center gap-[0.5em]">
              <span className="size-[0.5em] rounded-full" style={{ background: i === 0 ? "#fdb913" : "#3c3a3e" }} />
              <span className="truncate text-[0.72em] text-mist/80">{r}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PipelineScreen() {
  const cols = [
    { h: "New", n: 4, tint: "#7b7a7c" },
    { h: "Quoted", n: 3, tint: "#5db4ff" },
    { h: "Booked", n: 5, tint: "#fdb913" },
  ];
  return (
    <div className="grid h-full grid-cols-3 gap-[0.7em]">
      {cols.map((c) => (
        <div key={c.h} className="flex flex-col gap-[0.5em] rounded-[0.7em] border border-graphite/50 bg-coal/50 p-[0.7em]">
          <div className="flex items-center justify-between">
            <span className="font-meta text-[0.6em] uppercase tracking-[0.12em] text-steel/70">{c.h}</span>
            <span className="font-meta text-[0.6em] text-steel/60">{c.n}</span>
          </div>
          {Array.from({ length: c.n }).map((_, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 * i, duration: 0.3 }}
              className="flex flex-col gap-[0.35em] rounded-[0.5em] border border-graphite/40 bg-obsidian/80 p-[0.55em]"
            >
              <span className="h-[0.55em] w-[70%] rounded-full bg-steel/30" />
              <div className="flex items-center justify-between">
                <span className="h-[0.5em] w-[40%] rounded-full bg-steel/20" />
                <span className="size-[1em] rounded-full" style={{ background: c.tint, opacity: 0.8 }} />
              </div>
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarScreen() {
  const days = ["M", "T", "W", "T", "F", "S"];
  const blocks = [
    { c: 0, r: 1, h: 2, g: true },
    { c: 1, r: 0, h: 1 },
    { c: 2, r: 2, h: 2, g: true },
    { c: 3, r: 1, h: 1 },
    { c: 4, r: 0, h: 2 },
    { c: 5, r: 2, h: 1, g: true },
  ];
  return (
    <div className="flex h-full flex-col gap-[0.5em] rounded-[0.7em] border border-graphite/50 bg-coal/40 p-[0.8em]">
      <div className="grid grid-cols-6 gap-[0.5em]">
        {days.map((d, i) => (
          <span key={i} className="font-meta text-[0.6em] uppercase tracking-[0.1em] text-steel/60">{d}</span>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-6 grid-rows-4 gap-[0.4em]">
        {blocks.map((b, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scaleY: 0.6 }}
            animate={{ opacity: 1, scaleY: 1 }}
            transition={{ delay: 0.05 * i, duration: 0.3 }}
            className="rounded-[0.4em] border"
            style={{
              gridColumn: `${b.c + 1} / span 1`,
              gridRow: `${b.r + 1} / span ${b.h}`,
              background: b.g ? "rgba(253,185,19,0.14)" : "rgba(36,36,42,0.8)",
              borderColor: b.g ? "rgba(253,185,19,0.5)" : "rgba(60,58,62,0.6)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function InboxScreen() {
  const rows = [
    { n: "Lauren · Paradise Static", g: true },
    { n: "Marcus · First Light" },
    { n: "Dana · Golden Hour" },
    { n: "Aurora Sky · session" },
    { n: "Theo · re-master" },
  ];
  return (
    <div className="flex h-full flex-col gap-[0.45em]">
      {rows.map((r, i) => (
        <motion.div
          key={r.n}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="flex items-center gap-[0.6em] rounded-[0.6em] border border-graphite/40 bg-coal/60 p-[0.6em]"
        >
          <span className="grid size-[1.7em] shrink-0 place-items-center rounded-full bg-graphite/70 font-grotesk text-[0.7em] text-bone">
            {r.n.charAt(0)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[0.25em]">
            <span className="truncate text-[0.74em] text-mist/85">{r.n}</span>
            <span className="h-[0.45em] w-[60%] rounded-full bg-steel/20" />
          </div>
          {r.g && <span className="size-[0.55em] shrink-0 rounded-full bg-gold" />}
        </motion.div>
      ))}
    </div>
  );
}

const SCREENS = [DashboardScreen, PipelineScreen, CalendarScreen, InboxScreen];

export function DashboardSim({ start = 0 }: { start?: number }) {
  const reduce = useReducedMotion();
  const [i, setI] = React.useState(start % SCREENS.length);
  const [toast, setToast] = React.useState(false);

  React.useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((p) => (p + 1) % SCREENS.length), SCREEN_MS);
    return () => clearInterval(id);
  }, [reduce]);

  // Booking toast lands periodically.
  React.useEffect(() => {
    if (reduce) return;
    let t2: ReturnType<typeof setTimeout>;
    const t1 = setInterval(() => {
      setToast(true);
      t2 = setTimeout(() => setToast(false), 2600);
    }, SCREEN_MS * SCREENS.length);
    return () => {
      clearInterval(t1);
      clearTimeout(t2);
    };
  }, [reduce]);

  const Active = SCREENS[i];
  // Cursor rides to the active nav row (each row ~2.5em tall, starting below logo).
  const cursorTop = `${5.1 + i * 2.5}em`;

  return (
    <div className="absolute inset-0 flex select-none bg-obsidian font-grotesk text-[1.7cqw] leading-tight text-bone">
      {/* Sidebar */}
      <aside className="flex w-[22%] flex-col gap-[0.4em] border-r border-graphite/50 bg-obsidian/90 p-[0.8em]">
        <div className="mb-[0.6em] flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pulse-logo-main.png" alt="" aria-hidden draggable={false} className="h-[1.15em] w-auto select-none" />
        </div>
        {NAV.map((item, idx) => {
          const active = idx === i;
          return (
            <div
              key={item.label}
              className="flex h-[2.1em] items-center gap-[0.5em] rounded-[0.55em] border px-[0.6em] transition-colors duration-300"
              style={{
                background: active ? "rgba(253,185,19,0.12)" : "transparent",
                borderColor: active ? "rgba(253,185,19,0.5)" : "transparent",
              }}
            >
              <item.icon className="size-[1.05em] shrink-0" style={{ color: active ? "#fdb913" : "#8a8a8a" }} />
              <span className="font-meta text-[0.66em] uppercase tracking-[0.06em]" style={{ color: active ? "#f6f6f5" : "#a2a2a2" }}>
                {item.label}
              </span>
            </div>
          );
        })}
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-[2.6em] shrink-0 items-center gap-[0.6em] border-b border-graphite/50 bg-obsidian/80 px-[0.9em]">
          <div className="flex flex-col">
            <span className="font-meta text-[0.55em] uppercase tracking-[0.12em] text-steel/70">Lunar Recording Co.</span>
            <span className="font-grotesk text-[0.8em] font-semibold text-bone">{NAV[i].label}</span>
          </div>
          <div className="ml-auto flex items-center gap-[0.5em]">
            <div className="flex h-[1.8em] items-center gap-[0.4em] rounded-[0.5em] border border-graphite/60 bg-coal/60 px-[0.6em]">
              <Search className="size-[0.85em] text-steel/70" />
              <span className="font-meta text-[0.6em] text-steel/60">Search</span>
            </div>
            <Bell className="size-[1em] text-steel/70" />
            <span className="size-[1.6em] rounded-full bg-graphite/70" />
          </div>
        </header>

        {/* Screen body */}
        <div className="relative min-h-0 flex-1 p-[0.9em]">
          <AnimatePresence mode="wait">
            <motion.div
              key={i}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="h-full"
            >
              <Active run={i === 0 && !reduce} />
            </motion.div>
          </AnimatePresence>

          {/* Booking toast */}
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: 14, x: 8 }}
                animate={{ opacity: 1, y: 0, x: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="absolute bottom-[0.9em] right-[0.9em] flex items-center gap-[0.55em] rounded-[0.6em] border border-gold/50 bg-coal px-[0.8em] py-[0.6em] shadow-[0_0.6em_2em_rgba(0,0,0,0.6)]"
              >
                <span className="size-[0.55em] rounded-full bg-gold" />
                <span className="font-grotesk text-[0.72em] text-bone">New booking · Studio A</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Cursor */}
      {!reduce && (
        <motion.div
          className="pointer-events-none absolute left-[14.5%] z-10"
          animate={{ top: cursorTop, scale: [1, 0.8, 1] }}
          transition={{ top: { duration: 0.5, ease: "easeInOut" }, scale: { duration: 0.4, times: [0, 0.5, 1] } }}
        >
          <MousePointer2 className="size-[1.4em] fill-bone text-obsidian drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" style={{ fontSize: "1.5cqw" }} />
        </motion.div>
      )}
    </div>
  );
}
