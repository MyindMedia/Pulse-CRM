"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Home, CalendarDays, Inbox, Receipt, Bell, Plus } from "lucide-react";

/* Mobile counterpart to DashboardSim - the real Pulse UI in a phone, looping
 * through Home / Calendar / Inbox / Pay with a live bottom tab bar, a status
 * bar and a booking toast. Screens mirror the real app: the dashboard KPI
 * labels (dashboard/page.tsx), the day schedule with real rooms, the AI-draft
 * inbox and the payments money summary with real invoice status chips.
 * em-on-cqw sizing scales with the phone width; reduced motion renders the
 * Home screen, static. */

const TABS = [
  { icon: Home, label: "Home" },
  { icon: CalendarDays, label: "Calendar" },
  { icon: Inbox, label: "Inbox" },
  { icon: Receipt, label: "Pay" },
];

const SCREEN_MS = 3000;

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
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

function MiniKpi({ label, value, prefix = "", suffix = "", run }: { label: string; value: number; prefix?: string; suffix?: string; run: boolean }) {
  const v = useCountUp(value, run);
  const display = Number.isInteger(value) ? Math.round(v).toLocaleString() : v.toFixed(1);
  return (
    <div className="flex min-w-0 flex-col gap-[0.25em] rounded-[0.7em] border border-graphite/50 bg-coal/70 p-[0.7em]">
      <span className="truncate font-meta text-[0.58em] uppercase tracking-[0.08em] text-steel/70">{label}</span>
      <span className="truncate font-grotesk text-[1.35em] font-semibold leading-none text-bone">{prefix}{display}{suffix}</span>
    </div>
  );
}

/* The real dashboard KPIs + upcoming sessions, phone-sized. */
function HomeScreen({ run }: { run: boolean }) {
  return (
    <div className="flex h-full flex-col gap-[0.7em]">
      <div>
        <p className="font-meta text-[0.6em] uppercase tracking-[0.12em] text-steel/70">Good morning</p>
        <p className="font-grotesk text-[1.05em] font-semibold text-bone">Myind Sound</p>
      </div>
      <div className="grid grid-cols-2 gap-[0.55em]">
        <MiniKpi label="Revenue MTD" value={28.4} prefix="$" suffix="k" run={run} />
        <MiniKpi label="Sessions MTD" value={42} run={run} />
        <MiniKpi label="Pipeline value" value={39.1} prefix="$" suffix="k" run={run} />
        <MiniKpi label="Outstanding" value={8.6} prefix="$" suffix="k" run={run} />
      </div>
      <div className="flex flex-col gap-[0.4em] rounded-[0.7em] border border-graphite/50 bg-coal/60 p-[0.7em]">
        <span className="font-meta text-[0.6em] uppercase tracking-[0.12em] text-steel/70">Upcoming sessions</span>
        {["Studio A · Tracking · 10:00", "Booth 2 · Vocals · 13:30"].map((r, i) => (
          <div key={r} className="flex items-center gap-[0.5em]">
            <span className="size-[0.5em] rounded-full" style={{ background: i === 0 ? "#fdb913" : "#3c3a3e" }} />
            <span className="truncate text-[0.74em] text-mist/80">{r}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* The day's room bookings - real rooms, real session types. */
function CalendarScreen() {
  const slots = [
    { t: "09:00", b: "Studio A · Setup", g: false },
    { t: "10:00", b: "Studio A · Tracking", g: true },
    { t: "12:00", b: "Open slot", g: false, empty: true },
    { t: "13:30", b: "Booth 2 · Vocals", g: true },
    { t: "16:00", b: "Studio A · Mastering", g: false },
  ];
  return (
    <div className="flex h-full flex-col gap-[0.45em]">
      <p className="font-grotesk text-[0.95em] font-semibold text-bone">Today · Wed 10</p>
      {slots.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="flex items-stretch gap-[0.5em]"
        >
          <span className="w-[2.6em] shrink-0 pt-[0.35em] font-meta text-[0.6em] text-steel/60">{s.t}</span>
          <div
            className="flex-1 truncate rounded-[0.5em] border p-[0.5em] text-[0.72em]"
            style={{
              background: s.empty ? "transparent" : s.g ? "rgba(253,185,19,0.12)" : "rgba(36,36,42,0.7)",
              borderColor: s.empty ? "rgba(60,58,62,0.4)" : s.g ? "rgba(253,185,19,0.5)" : "rgba(60,58,62,0.6)",
              color: s.empty ? "#6c6c76" : "#c9c7cc",
            }}
          >
            {s.b}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

/* The real inbox: AI agent drafts awaiting approval. */
function InboxScreen() {
  const rows = [
    { n: "Lauren Page", m: "Draft reply ready for review", g: true },
    { n: "Marcus Lee", m: "Deposit reminder approved" },
    { n: "Dana Cole", m: "Mix v3 notes received" },
    { n: "Aurora Sky", m: "Re-engagement draft waiting", g: true },
  ];
  return (
    <div className="flex h-full flex-col gap-[0.5em]">
      <p className="font-grotesk text-[0.95em] font-semibold text-bone">Inbox</p>
      {rows.map((r, i) => (
        <motion.div
          key={r.n}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="flex items-center gap-[0.55em] rounded-[0.6em] border border-graphite/40 bg-coal/60 p-[0.6em]"
        >
          <span className="grid size-[1.9em] shrink-0 place-items-center rounded-full bg-graphite/70 font-grotesk text-[0.72em] text-bone">{r.n.charAt(0)}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[0.74em] text-mist/85">{r.n}</span>
            <span className="truncate text-[0.64em] text-steel/60">{r.m}</span>
          </div>
          {r.g && <span className="size-[0.5em] shrink-0 rounded-full bg-gold" />}
        </motion.div>
      ))}
    </div>
  );
}

/* The real payments page: money-summary labels + invoices with the real
 * status chips (Sent / Viewed / Paid from labels.ts INVOICE_STATUS). */
function PayScreen({ run }: { run: boolean }) {
  const collected = useCountUp(12.4, run);
  const invoices = [
    { id: "INV-1041", c: "Lauren Page", a: "$540", s: "Paid" },
    { id: "INV-1042", c: "Marcus Lee", a: "$380", s: "Viewed" },
    { id: "INV-1043", c: "Dana Cole", a: "$620", s: "Sent" },
  ];
  const chip: Record<string, { fg: string; bg: string; bd: string }> = {
    Paid: { fg: "#3ddc91", bg: "rgba(61,220,145,0.1)", bd: "rgba(61,220,145,0.4)" },
    Sent: { fg: "#5db4ff", bg: "rgba(93,180,255,0.1)", bd: "rgba(93,180,255,0.4)" },
    Viewed: { fg: "#5db4ff", bg: "rgba(93,180,255,0.1)", bd: "rgba(93,180,255,0.4)" },
  };
  return (
    <div className="flex h-full flex-col gap-[0.55em]">
      <p className="font-grotesk text-[0.95em] font-semibold text-bone">Payments</p>
      <div className="flex flex-col gap-[0.3em] rounded-[0.8em] border border-gold/40 bg-gold/[0.08] p-[0.8em]">
        <span className="font-meta text-[0.6em] uppercase tracking-[0.1em] text-gold/80">Collected · MTD</span>
        <span className="font-grotesk text-[1.6em] font-semibold leading-none text-bone">${collected.toFixed(1)}k</span>
      </div>
      <div className="grid grid-cols-2 gap-[0.55em]">
        <div className="flex flex-col gap-[0.2em] rounded-[0.6em] border border-graphite/50 bg-coal/70 p-[0.55em]">
          <span className="font-meta text-[0.55em] uppercase tracking-[0.08em] text-steel/70">Outstanding</span>
          <span className="font-grotesk text-[0.95em] font-semibold leading-none text-bone">$8.6k</span>
        </div>
        <div className="flex flex-col gap-[0.2em] rounded-[0.6em] border border-graphite/50 bg-coal/70 p-[0.55em]">
          <span className="font-meta text-[0.55em] uppercase tracking-[0.08em] text-steel/70">Overdue</span>
          <span className="font-grotesk text-[0.95em] font-semibold leading-none text-bone">$2.1k</span>
        </div>
      </div>
      {invoices.map((r, i) => (
        <motion.div
          key={r.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="flex items-center gap-[0.5em] rounded-[0.6em] border border-graphite/40 bg-coal/60 px-[0.6em] py-[0.5em]"
        >
          <span className="min-w-0 flex-1 truncate text-[0.7em] text-mist/80">{r.c}</span>
          <span className="shrink-0 font-grotesk text-[0.7em] font-medium text-bone">{r.a}</span>
          <span
            className="shrink-0 rounded-full border px-[0.5em] py-[0.12em] font-meta text-[0.52em] uppercase tracking-[0.08em]"
            style={{ color: chip[r.s].fg, background: chip[r.s].bg, borderColor: chip[r.s].bd }}
          >
            {r.s}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

const SCREENS: React.ComponentType<{ run: boolean }>[] = [HomeScreen, CalendarScreen, InboxScreen, PayScreen];

export function MobileSim() {
  const reduce = useReducedMotion();
  const [i, setI] = React.useState(0);
  const [toast, setToast] = React.useState(false);

  React.useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((p) => (p + 1) % SCREENS.length), SCREEN_MS);
    return () => clearInterval(id);
  }, [reduce]);

  React.useEffect(() => {
    if (reduce) return;
    let t2: ReturnType<typeof setTimeout>;
    const t1 = setInterval(() => {
      setToast(true);
      t2 = setTimeout(() => setToast(false), 2400);
    }, SCREEN_MS * SCREENS.length);
    return () => {
      clearInterval(t1);
      clearTimeout(t2);
    };
  }, [reduce]);

  const Active = SCREENS[i];
  const Prev = SCREENS[(i + SCREENS.length - 1) % SCREENS.length];

  return (
    <div className="absolute inset-0 flex select-none flex-col bg-obsidian font-grotesk text-[5cqw] leading-tight text-bone">
      {/* Status bar */}
      <div className="flex shrink-0 items-center justify-between px-[1.4em] pb-[0.4em] pt-[0.7em]">
        <span className="font-grotesk text-[0.72em] font-semibold text-bone">9:41</span>
        <div className="flex items-center gap-[0.4em]">
          <span className="h-[0.5em] w-[1.2em] rounded-[0.15em] bg-bone/70" />
          <span className="h-[0.55em] w-[0.9em] rounded-[0.15em] border border-bone/60" />
        </div>
      </div>

      {/* App bar */}
      <header className="flex shrink-0 items-center gap-[0.5em] px-[1em] pb-[0.6em]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pulse-logo-main.png" alt="" aria-hidden draggable={false} className="h-[1.2em] w-auto select-none" />
        <Bell className="ml-auto size-[1.1em] text-steel/70" />
        <span className="size-[1.7em] rounded-full bg-graphite/70" />
      </header>

      {/* Screen body. Previous screen mounted beneath, active one fades in on
          top via pure CSS - no JS animation driver in the visibility path
          (see DashboardSim for why). */}
      <div className="relative min-h-0 flex-1">
        {/* Opaque layers - transparent gaps in screen content would let the
            previous screen show through as a double image. */}
        {!reduce && (
          <div aria-hidden className="absolute inset-0 bg-obsidian px-[1em] pb-[0.6em]">
            <Prev run={false} />
          </div>
        )}
        <div key={i} className="absolute inset-0 bg-obsidian px-[1em] pb-[0.6em] motion-safe:animate-sim-screen-in">
          <Active run={!reduce} />
        </div>

        {/* Floating action */}
        <div className="absolute bottom-[0.6em] right-[0.6em] grid size-[2.4em] place-items-center rounded-full bg-gold text-gold-ink shadow-[0_0.4em_1.2em_rgba(253,185,19,0.35)]">
          <Plus className="size-[1.3em]" />
        </div>

        {/* Booking toast */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.32, ease: "easeOut" }}
              className="absolute inset-x-[0.6em] top-[0.2em] flex items-center gap-[0.5em] rounded-[0.7em] border border-gold/50 bg-coal px-[0.8em] py-[0.6em] shadow-[0_0.6em_2em_rgba(0,0,0,0.6)]"
            >
              <span className="size-[0.5em] rounded-full bg-gold" />
              <span className="font-grotesk text-[0.72em] text-bone">New booking · Studio A</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom tab bar */}
      <nav className="flex shrink-0 items-center justify-around border-t border-graphite/50 bg-obsidian/90 px-[0.6em] pb-[1em] pt-[0.6em]">
        {TABS.map((t, idx) => {
          const active = idx === i;
          return (
            <div key={t.label} className="flex flex-col items-center gap-[0.2em]">
              <t.icon className="size-[1.25em] transition-colors duration-300" style={{ color: active ? "#fdb913" : "#7b7a7c" }} />
              <span className="font-meta text-[0.55em] uppercase tracking-[0.06em]" style={{ color: active ? "#f6f6f5" : "#7b7a7c" }}>{t.label}</span>
            </div>
          );
        })}
      </nav>
    </div>
  );
}
