"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  LayoutDashboard,
  Sparkles,
  Music2,
  Users,
  KanbanSquare,
  Inbox,
  CalendarDays,
  Ticket,
  Receipt,
  BarChart3,
  Search,
  Bell,
  MousePointer2,
  TrendingUp,
} from "lucide-react";

/* Live, looping "simulated app navigation" that plays inside the hero monitor.
 * Mirrors the REAL Pulse app: the sidebar lists the actual nav (labels + icons
 * from src/lib/nav.ts) and the panel cross-fades between the real Dashboard,
 * Pipeline, Inbox, Calendar and Payments screens while a cursor rides to the
 * matching nav row. KPI labels, pipeline stages and invoice statuses come from
 * the real pages (dashboard/page.tsx, labels.ts, money-summary.tsx). All
 * sizing is em off a single cqw root, so it scales with the monitor width.
 * Reduced-motion renders the dashboard, static. */

/* First 10 items of the real nav (src/lib/nav.ts); the rest fade behind dots. */
const NAV = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: Sparkles, label: "Agent" },
  { icon: Music2, label: "Songs" },
  { icon: Users, label: "Clients" },
  { icon: KanbanSquare, label: "Pipeline" },
  { icon: Inbox, label: "Inbox" },
  { icon: CalendarDays, label: "Calendar" },
  { icon: Ticket, label: "Bookings" },
  { icon: Receipt, label: "Payments" },
  { icon: BarChart3, label: "Reports" },
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
  const display = Number.isInteger(value) ? Math.round(v).toLocaleString() : v.toFixed(1);
  return (
    <div className="flex min-w-0 flex-col gap-[0.3em] rounded-[0.7em] border border-graphite/50 bg-coal/70 p-[0.6em]">
      <span className="truncate font-meta text-[0.55em] uppercase tracking-[0.1em] text-steel/70">{label}</span>
      <span className="truncate font-grotesk text-[1.25em] font-semibold leading-none text-bone">
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

/* Mirrors the real dashboard: the 6 KPI tiles, the "Revenue - last 12 months"
 * chart and the Pulse insights column. */
function DashboardScreen({ run }: { run: boolean }) {
  const insights = [
    { t: "3 invoices overdue", b: "Worth $2.1k. Send reminders." },
    { t: "Booth 2 underused", b: "Thursdays run 35% idle." },
    { t: "Lauren is due a follow-up", b: "Last session 12 days ago." },
  ];
  return (
    <div className="flex h-full flex-col gap-[0.7em]">
      <div className="grid grid-cols-6 gap-[0.55em]">
        <Kpi label="Revenue MTD" value={28.4} prefix="$" suffix="k" run={run} />
        <Kpi label="Sessions MTD" value={42} run={run} />
        <Kpi label="Pipeline value" value={39.1} prefix="$" suffix="k" run={run} />
        <Kpi label="Outstanding" value={8.6} prefix="$" suffix="k" run={run} />
        <Kpi label="New leads 7d" value={9} run={run} />
        <Kpi label="Avg session" value={412} prefix="$" run={run} />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-[0.7em]">
        <div className="flex flex-col gap-[0.5em] rounded-[0.7em] border border-graphite/50 bg-coal/70 p-[0.8em]">
          <div className="flex items-center justify-between">
            <span className="truncate font-meta text-[0.6em] uppercase tracking-[0.1em] text-steel/70">Revenue - last 12 months</span>
            <span className="flex shrink-0 items-center gap-[0.3em] text-[0.66em] font-medium text-gold"><TrendingUp className="size-[1em]" />+18%</span>
          </div>
          <div className="min-h-0 flex-1"><Sparkline run={run} /></div>
        </div>
        <div className="flex flex-col gap-[0.45em] overflow-hidden rounded-[0.7em] border border-graphite/50 bg-coal/70 p-[0.7em]">
          <div className="flex items-center justify-between">
            <span className="font-meta text-[0.6em] uppercase tracking-[0.1em] text-steel/70">Pulse insights</span>
            <Sparkles className="size-[0.8em] text-gold" />
          </div>
          {insights.map((it) => (
            <div key={it.t} className="rounded-[0.5em] border border-graphite/40 bg-obsidian/70 p-[0.5em]">
              <p className="truncate text-[0.66em] font-medium text-bone">{it.t}</p>
              <p className="truncate text-[0.58em] text-steel/70">{it.b}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* The real pipeline kanban: Inquiry, Qualified, Proposal, Booked (labels.ts). */
function PipelineScreen() {
  const cols = [
    { h: "Inquiry", tint: "#7b7a7c", cards: [["Nova EP tracking", "$2.4k"], ["Podcast edit", "$600"], ["Demo day block", "$900"]] },
    { h: "Qualified", tint: "#5db4ff", cards: [["Mix bundle x3", "$1.8k"], ["Voiceover block", "$750"]] },
    { h: "Proposal", tint: "#5db4ff", cards: [["Album mix - Dana", "$5.2k"], ["Sync brief", "$1.1k"]] },
    { h: "Booked", tint: "#fdb913", cards: [["Vocals - Lauren", "$540"], ["Mastering x2", "$680"], ["Full day lockout", "$1.5k"]] },
  ];
  return (
    <div className="grid h-full grid-cols-4 gap-[0.6em]">
      {cols.map((c) => (
        <div key={c.h} className="flex min-w-0 flex-col gap-[0.45em] rounded-[0.7em] border border-graphite/50 bg-coal/50 p-[0.6em]">
          <div className="flex items-center justify-between">
            <span className="truncate font-meta text-[0.58em] uppercase tracking-[0.1em] text-steel/70">{c.h}</span>
            <span className="font-meta text-[0.58em] text-steel/60">{c.cards.length}</span>
          </div>
          {c.cards.map(([name, amt], i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 * i, duration: 0.3 }}
              className="flex flex-col gap-[0.3em] rounded-[0.5em] border border-graphite/40 bg-obsidian/80 p-[0.5em]"
            >
              <span className="truncate text-[0.62em] text-mist/85">{name}</span>
              <div className="flex items-center justify-between">
                <span className="font-grotesk text-[0.6em] font-medium text-steel/80">{amt}</span>
                <span className="size-[0.55em] rounded-full" style={{ background: c.tint, opacity: 0.85 }} />
              </div>
            </motion.div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* The real calendar: week grid of room bookings (Studio A, Booth 2...). */
function CalendarScreen() {
  const days = ["M", "T", "W", "T", "F", "S"];
  const blocks = [
    { c: 0, r: 1, h: 2, g: true, l: "Studio A" },
    { c: 1, r: 0, h: 1, l: "Booth 2" },
    { c: 2, r: 2, h: 2, g: true, l: "Studio A" },
    { c: 3, r: 1, h: 1, l: "Booth 1" },
    { c: 4, r: 0, h: 2, l: "Studio B" },
    { c: 5, r: 2, h: 1, g: true, l: "Booth 2" },
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
            className="overflow-hidden rounded-[0.4em] border"
            style={{
              gridColumn: `${b.c + 1} / span 1`,
              gridRow: `${b.r + 1} / span ${b.h}`,
              background: b.g ? "rgba(253,185,19,0.14)" : "rgba(36,36,42,0.8)",
              borderColor: b.g ? "rgba(253,185,19,0.5)" : "rgba(60,58,62,0.6)",
            }}
          >
            <span
              className="block truncate p-[0.4em] font-meta text-[0.5em] uppercase tracking-[0.06em]"
              style={{ color: b.g ? "#fdb913" : "#8a8a8a" }}
            >
              {b.l}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* The real inbox: AI agent drafts awaiting approval, per client. */
function InboxScreen() {
  const rows = [
    { n: "Lauren Page", m: "Draft reply ready: Friday vocal slot", g: true },
    { n: "Marcus Lee", m: "Deposit reminder approved and sent" },
    { n: "Dana Cole", m: "Mix v3 notes received" },
    { n: "Aurora Sky", m: "Re-engagement draft awaiting review", g: true },
    { n: "Theo Banks", m: "Master delivery confirmed" },
  ];
  return (
    <div className="flex h-full flex-col gap-[0.45em]">
      <span className="font-meta text-[0.6em] uppercase tracking-[0.1em] text-steel/70">Drafts awaiting your approval</span>
      {rows.map((r, i) => (
        <motion.div
          key={r.n}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="flex items-center gap-[0.6em] rounded-[0.6em] border border-graphite/40 bg-coal/60 p-[0.55em]"
        >
          <span className="grid size-[1.7em] shrink-0 place-items-center rounded-full bg-graphite/70 font-grotesk text-[0.7em] text-bone">
            {r.n.charAt(0)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-[0.1em]">
            <span className="truncate text-[0.72em] text-mist/85">{r.n}</span>
            <span className="truncate text-[0.6em] text-steel/60">{r.m}</span>
          </div>
          {r.g && <span className="size-[0.55em] shrink-0 rounded-full bg-gold" />}
        </motion.div>
      ))}
    </div>
  );
}

/* The real payments page: the MoneySummary strip + invoice list with the real
 * status chips (Sent / Viewed / Paid from labels.ts INVOICE_STATUS). */
function PaymentsScreen({ run }: { run: boolean }) {
  const invoices = [
    { id: "INV-1041", c: "Lauren Page", a: "$540", s: "Paid" },
    { id: "INV-1042", c: "Marcus Lee", a: "$380", s: "Viewed" },
    { id: "INV-1043", c: "Dana Cole", a: "$620", s: "Sent" },
    { id: "INV-1044", c: "Aurora Sky", a: "$1,200", s: "Paid" },
  ];
  const chip: Record<string, { fg: string; bg: string; bd: string }> = {
    Paid: { fg: "#3ddc91", bg: "rgba(61,220,145,0.1)", bd: "rgba(61,220,145,0.4)" },
    Sent: { fg: "#5db4ff", bg: "rgba(93,180,255,0.1)", bd: "rgba(93,180,255,0.4)" },
    Viewed: { fg: "#5db4ff", bg: "rgba(93,180,255,0.1)", bd: "rgba(93,180,255,0.4)" },
  };
  return (
    <div className="flex h-full flex-col gap-[0.7em]">
      <div className="grid grid-cols-4 gap-[0.55em]">
        <Kpi label="Outstanding" value={8.6} prefix="$" suffix="k" run={run} />
        <Kpi label="Overdue" value={2.1} prefix="$" suffix="k" run={run} />
        <Kpi label="Collected MTD" value={12.4} prefix="$" suffix="k" run={run} />
        <Kpi label="Draft value" value={3.2} prefix="$" suffix="k" run={run} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[0.4em] rounded-[0.7em] border border-graphite/50 bg-coal/50 p-[0.6em]">
        {invoices.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 * i, duration: 0.3 }}
            className="flex items-center gap-[0.6em] rounded-[0.5em] border border-graphite/40 bg-obsidian/70 px-[0.6em] py-[0.45em]"
          >
            <span className="shrink-0 font-meta text-[0.6em] text-steel/70">{r.id}</span>
            <span className="min-w-0 flex-1 truncate text-[0.68em] text-mist/85">{r.c}</span>
            <span className="shrink-0 font-grotesk text-[0.68em] font-medium text-bone">{r.a}</span>
            <span
              className="shrink-0 rounded-full border px-[0.55em] py-[0.15em] font-meta text-[0.52em] uppercase tracking-[0.08em]"
              style={{ color: chip[r.s].fg, background: chip[r.s].bg, borderColor: chip[r.s].bd }}
            >
              {r.s}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* Loop order follows the sidebar top-to-bottom; nav = the NAV row the cursor
 * rides to before the screen lands. */
const SCREENS: { Screen: React.ComponentType<{ run: boolean }>; nav: number }[] = [
  { Screen: DashboardScreen, nav: 0 },
  { Screen: PipelineScreen, nav: 4 },
  { Screen: InboxScreen, nav: 5 },
  { Screen: CalendarScreen, nav: 6 },
  { Screen: PaymentsScreen, nav: 8 },
];

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

  const { Screen: Active, nav: navIdx } = SCREENS[i];
  // Cursor rides to the active nav row (rows are 1.9em tall on a 2.2em pitch,
  // starting below the logo block).
  const cursorTop = `${4.65 + navIdx * 2.2}em`;

  return (
    <div className="absolute inset-0 flex select-none bg-obsidian font-grotesk text-[1.7cqw] leading-tight text-bone">
      {/* Sidebar - the real Pulse nav */}
      <aside className="flex w-[22%] flex-col gap-[0.3em] border-r border-graphite/50 bg-obsidian/90 p-[0.8em]">
        <div className="mb-[0.5em] flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/pulse-logo-main.png" alt="" aria-hidden draggable={false} className="h-[1.15em] w-auto select-none" />
        </div>
        {NAV.map((item, idx) => {
          const active = idx === navIdx;
          return (
            <div
              key={item.label}
              className="flex h-[1.9em] items-center gap-[0.5em] rounded-[0.55em] border px-[0.6em] transition-colors duration-300"
              style={{
                background: active ? "rgba(253,185,19,0.12)" : "transparent",
                borderColor: active ? "rgba(253,185,19,0.5)" : "transparent",
              }}
            >
              <item.icon className="size-[0.95em] shrink-0" style={{ color: active ? "#fdb913" : "#8a8a8a" }} />
              <span className="truncate font-meta text-[0.6em] uppercase tracking-[0.06em]" style={{ color: active ? "#f6f6f5" : "#a2a2a2" }}>
                {item.label}
              </span>
            </div>
          );
        })}
        {/* The nav continues (Releases, Licensing, Studio...) - fade hint */}
        <span className="px-[0.6em] pt-[0.1em] font-grotesk text-[0.7em] leading-none text-steel/40">···</span>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-[2.6em] shrink-0 items-center gap-[0.6em] border-b border-graphite/50 bg-obsidian/80 px-[0.9em]">
          <div className="flex flex-col">
            <span className="font-meta text-[0.55em] uppercase tracking-[0.12em] text-steel/70">Lumen Recording Co.</span>
            <span className="font-grotesk text-[0.8em] font-semibold text-bone">{NAV[navIdx].label}</span>
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
              <Active run={!reduce} />
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
