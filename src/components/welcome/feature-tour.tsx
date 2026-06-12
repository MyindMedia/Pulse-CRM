"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  CalendarRange,
  CreditCard,
  Disc3,
  Package,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { cn } from "@/lib/utils";

/* ============================================================
   Feature tour - a minimalist motion-graphics walkthrough of the
   core modules, shown once after the terms during onboarding.
   Each scene is a small animated composition (pure motion/react,
   no video): a few seconds, a title, two sentences. Auto-advances;
   dots + Next/Skip give manual control.
   ============================================================ */

const SCENE_MS = 5200;

type Scene = {
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  copy: string;
  art: React.ComponentType;
};

/* ── Scene artwork: lightweight looping compositions ─────────── */

const loop = { repeat: Infinity, repeatType: "loop" as const, ease: "easeInOut" as const };

function BookingArt() {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {Array.from({ length: 28 }).map((_, i) => {
        const isBooked = [9, 12, 17, 23].includes(i);
        const isNew = i === 17;
        return (
          <motion.div
            key={i}
            className={cn(
              "size-7 rounded-[5px] border sm:size-8",
              isBooked ? "border-gold/60 bg-gold/15" : "border-graphite/50 bg-coal-2",
            )}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.018, duration: 0.3 }}
          >
            {isNew && (
              <motion.div
                className="size-full rounded-[5px] bg-gold/50"
                animate={{ opacity: [0.2, 0.9, 0.2] }}
                transition={{ ...loop, duration: 2.2 }}
              />
            )}
          </motion.div>
        );
      })}
      <motion.div
        className="col-span-7 mt-2 flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.4 }}
      >
        <motion.span
          className="size-1.5 rounded-full bg-gold"
          animate={{ scale: [1, 1.5, 1] }}
          transition={{ ...loop, duration: 1.6 }}
        />
        <span className="font-meta text-[0.625rem] uppercase tracking-wide text-gold-bright">
          New booking · deposit paid
        </span>
      </motion.div>
    </div>
  );
}

function StudioArt() {
  return (
    <div className="flex w-full max-w-[280px] flex-col gap-2">
      {["Studio A", "Mix Suite", "Live Room"].map((room, i) => (
        <motion.div
          key={room}
          className="flex items-center justify-between rounded-md border border-graphite/50 bg-coal-2 px-3.5 py-2.5"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 + i * 0.15, duration: 0.4 }}
        >
          <span className="flex items-center gap-2.5">
            <motion.span
              className={cn("size-2 rounded-full", i === 1 ? "bg-gold" : "bg-positive")}
              animate={i === 1 ? { opacity: [1, 0.35, 1] } : undefined}
              transition={{ ...loop, duration: 1.8 }}
            />
            <span className="text-sm font-medium text-bone">{room}</span>
          </span>
          <span className="font-meta text-[0.625rem] text-steel/70">
            {i === 1 ? "IN SESSION" : "AVAILABLE"}
          </span>
        </motion.div>
      ))}
    </div>
  );
}

function StaffArt() {
  const tints = ["#fdb913", "#c084fc", "#5db4ff", "#3ddc91"];
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex -space-x-2.5">
        {tints.map((t, i) => (
          <motion.span
            key={t}
            className="grid size-11 place-items-center rounded-full border-2 border-ink font-grotesk text-xs font-bold"
            style={{ backgroundColor: `${t}26`, color: t, boxShadow: `inset 0 0 0 1px ${t}55` }}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.13, duration: 0.4 }}
          >
            {["JB", "SC", "RD", "TP"][i]}
          </motion.span>
        ))}
      </div>
      <div className="flex w-full max-w-[280px] flex-col gap-1.5">
        {[0, 1].map((row) => (
          <motion.div
            key={row}
            className="flex h-7 items-center overflow-hidden rounded-md border border-graphite/50 bg-coal-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 + row * 0.15 }}
          >
            <motion.div
              className="h-full rounded-md bg-gold/20"
              initial={{ width: 0 }}
              animate={{ width: row === 0 ? "62%" : "38%" }}
              transition={{ delay: 0.75 + row * 0.15, duration: 0.7, ease: "easeOut" }}
              style={{ marginLeft: row === 0 ? "8%" : "42%" }}
            />
          </motion.div>
        ))}
        <p className="mt-1 text-center font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
          Shifts auto-follow the session calendar
        </p>
      </div>
    </div>
  );
}

function InventoryArt() {
  const gear = ["Neve 1073", "U87", "SSL Bus Comp", "Juno-106"];
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="grid grid-cols-2 gap-2">
        {gear.map((g, i) => (
          <motion.div
            key={g}
            className="flex items-center gap-2 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.13, duration: 0.35 }}
          >
            <Package className="size-3.5 text-gold-dim" />
            <span className="text-xs font-medium text-bone">{g}</span>
          </motion.div>
        ))}
      </div>
      <motion.p
        className="font-meta text-[0.6875rem] uppercase tracking-wide text-gold-bright"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        Every item · value · room placement
      </motion.p>
    </div>
  );
}

function PaymentsArt() {
  return (
    <div className="flex w-full max-w-[280px] flex-col gap-2">
      {[
        { label: "Deposit - Studio A", amount: "$135", done: true },
        { label: "Balance - mix session", amount: "$315", done: true },
        { label: "Invoice PLS-1042", amount: "$1,800", done: false },
      ].map((row, i) => (
        <motion.div
          key={row.label}
          className="flex items-center justify-between rounded-md border border-graphite/50 bg-coal-2 px-3.5 py-2.5"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 + i * 0.16, duration: 0.4 }}
        >
          <span className="text-xs font-medium text-bone">{row.label}</span>
          <span className="flex items-center gap-2">
            <span className="font-meta text-xs text-bone">{row.amount}</span>
            {row.done ? (
              <motion.span
                className="rounded-full border border-positive/40 bg-positive/15 px-1.5 py-0.5 font-meta text-[0.5625rem] uppercase text-positive"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.5 + i * 0.16, type: "spring", stiffness: 300, damping: 18 }}
              >
                Paid
              </motion.span>
            ) : (
              <motion.span
                className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-meta text-[0.5625rem] uppercase text-gold-bright"
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ ...loop, duration: 2 }}
              >
                Sent
              </motion.span>
            )}
          </span>
        </motion.div>
      ))}
      <p className="mt-1 text-center font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
        Paid straight to your own Stripe
      </p>
    </div>
  );
}

const SCENES: Scene[] = [
  {
    key: "bookings",
    icon: CalendarRange,
    title: "Bookings run themselves",
    copy: "Clients pick a room and a time on your branded booking page, and a deposit locks it in. Holds, reminders and the calendar stay in sync without you chasing anyone.",
    art: BookingArt,
  },
  {
    key: "studio",
    icon: Disc3,
    title: "Your studio at a glance",
    copy: "Rooms, rates and live status in one place. Each room knows its gear, its photos and its booking rules - and powers your public page automatically.",
    art: StudioArt,
  },
  {
    key: "staff",
    icon: Users,
    title: "Staff and scheduling",
    copy: "Your team, their shifts and who's working right now. Booked sessions schedule the engineer automatically, and everyone sees their own week.",
    art: StaffArt,
  },
  {
    key: "inventory",
    icon: Package,
    title: "Inventory that counts",
    copy: "Every mic, console and synth tracked with photos, value and the room it lives in. Know what you own and what it's worth.",
    art: InventoryArt,
  },
  {
    key: "payments",
    icon: CreditCard,
    title: "Money, handled",
    copy: "Deposits, balances and invoices collected through your own Stripe account - funds go straight to you. Pulse keeps the ledger and the receipts.",
    art: PaymentsArt,
  },
];

export function FeatureTour({ onDone }: { onDone: () => void }) {
  const [idx, setIdx] = React.useState(0);
  const scene = SCENES[idx];
  const last = idx === SCENES.length - 1;

  // Auto-advance with a key-reset timer; pause is unnecessary at this length.
  React.useEffect(() => {
    if (last) return;
    const t = window.setTimeout(() => setIdx((i) => i + 1), SCENE_MS);
    return () => window.clearTimeout(t);
  }, [idx, last]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 py-10">
      <div className="mb-10 flex items-center justify-between">
        <PulseLogo size="sm" asLink={false} />
        <Button variant="ghost" size="sm" onClick={onDone}>
          Skip tour
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={scene.key}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full flex-col items-center text-center"
          >
            {/* Artwork stage */}
            <div className="mb-10 grid min-h-[220px] w-full place-items-center">
              <scene.art />
            </div>

            <span className="mb-3 grid size-10 place-items-center rounded-full border border-gold-dim/50 bg-gold/10 text-gold">
              <scene.icon className="size-4.5" />
            </span>
            <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-bone">
              {scene.title}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-steel">{scene.copy}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Progress dots + controls */}
      <div className="mt-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {SCENES.map((s, i) => (
            <button
              key={s.key}
              aria-label={s.title}
              onClick={() => setIdx(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                i === idx ? "w-6 bg-gold" : "w-1.5 bg-graphite hover:bg-steel/50",
              )}
            />
          ))}
        </div>
        <Button onClick={() => (last ? onDone() : setIdx((i) => i + 1))}>
          {last ? "Set up my studio" : "Next"}
        </Button>
      </div>
    </div>
  );
}
