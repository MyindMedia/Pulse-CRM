"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";

/* Tiny animated previews for the onboarding switches.

   Each one shows the thing actually happening rather than an icon sitting
   still: a phone punching in, a cable landing in a jack, a reminder leaving.
   The point is recognition. An owner who has never opened the patch bay
   should understand it in about a second.

   All of these are decorative and aria-hidden. Every animation is gated on
   `active` and on prefers-reduced-motion, so a screen of switched-off cards
   is a still screen, and nothing loops in the background for someone who
   asked the OS for less movement. */

function useMotionOn(active: boolean) {
  const reduced = useReducedMotion();
  return active && !reduced;
}

const SHELL =
  "relative h-16 w-full overflow-hidden rounded-md border border-graphite/50 bg-coal/50";

/** Phone clock-in: a thumb taps, the button confirms, the timer runs. */
export function ClockInPreview({ active }: { active: boolean }) {
  const on = useMotionOn(active);
  return (
    <div className={SHELL} aria-hidden>
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-center gap-3">
          <motion.div
            className="grid h-11 w-7 place-items-center rounded-[4px] border border-graphite bg-ink"
            animate={on ? { rotate: [0, -4, 0] } : { rotate: 0 }}
            transition={{ duration: 2.4, repeat: on ? Infinity : 0, ease: "easeInOut" }}
          >
            <motion.span
              className="block h-2.5 w-4 rounded-[2px] bg-gold"
              animate={on ? { opacity: [0.35, 1, 1, 0.35] } : { opacity: 0.35 }}
              transition={{ duration: 2.4, repeat: on ? Infinity : 0, times: [0, 0.3, 0.8, 1] }}
            />
          </motion.div>
          <div className="space-y-1">
            <motion.p
              className="font-mono text-[0.7rem] tabular-nums text-bone"
              animate={on ? { opacity: [0.4, 1] } : { opacity: 0.4 }}
              transition={{ duration: 1.2, repeat: on ? Infinity : 0, repeatType: "reverse" }}
            >
              04:12:07
            </motion.p>
            <p className="font-meta text-[0.55rem] uppercase tracking-[0.1em] text-steel/70">
              on the clock
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Patch bay: a cable drops into a jack and the signal lights up. */
export function PatchPreview({ active }: { active: boolean }) {
  const on = useMotionOn(active);
  return (
    <div className={SHELL} aria-hidden>
      <svg viewBox="0 0 200 64" className="absolute inset-0 h-full w-full">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={`t${i}`} cx={26 + i * 30} cy={20} r="4.5"
            className="fill-none stroke-graphite" strokeWidth="1.5" />
        ))}
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <circle key={`b${i}`} cx={26 + i * 30} cy={46} r="4.5"
            className="fill-none stroke-graphite" strokeWidth="1.5" />
        ))}
        {/* The patch itself: drawn on, not faded in, so it reads as plugging. */}
        <motion.path
          d="M56 20 C 76 20, 86 46, 116 46"
          className="fill-none stroke-gold" strokeWidth="2" strokeLinecap="round"
          initial={false}
          animate={on ? { pathLength: [0, 1, 1, 0] } : { pathLength: 1 }}
          transition={{ duration: 3, repeat: on ? Infinity : 0, times: [0, 0.4, 0.8, 1], ease: "easeInOut" }}
        />
        <motion.circle cx="56" cy="20" r="4.5" className="fill-gold"
          animate={on ? { opacity: [0.3, 1, 1, 0.3] } : { opacity: 1 }}
          transition={{ duration: 3, repeat: on ? Infinity : 0, times: [0, 0.4, 0.8, 1] }} />
        <motion.circle cx="116" cy="46" r="4.5" className="fill-gold"
          animate={on ? { opacity: [0, 0, 1, 0] } : { opacity: 1 }}
          transition={{ duration: 3, repeat: on ? Infinity : 0, times: [0, 0.38, 0.45, 1] }} />
      </svg>
    </div>
  );
}

/** Reminders: messages leaving on a schedule. */
export function RemindersPreview({ active }: { active: boolean }) {
  const on = useMotionOn(active);
  const stops = ["48h", "24h", "2h"];
  return (
    <div className={SHELL} aria-hidden>
      <div className="absolute inset-0 flex items-center justify-center gap-2 px-3">
        {stops.map((label, i) => (
          <React.Fragment key={label}>
            {i > 0 && (
              <motion.span
                className="h-px flex-1 origin-left bg-graphite"
                animate={on ? { backgroundColor: ["#2E2E2E", "#FDB913", "#2E2E2E"] } : {}}
                transition={{ duration: 2.6, repeat: on ? Infinity : 0, delay: i * 0.45 }}
              />
            )}
            <motion.span
              className="rounded-full border border-graphite/70 px-2 py-1 font-mono text-[0.6rem] text-steel"
              animate={
                on
                  ? { borderColor: ["#2E2E2E", "#FDB913", "#2E2E2E"], color: ["#8B857A", "#F2EFE9", "#8B857A"] }
                  : {}
              }
              transition={{ duration: 2.6, repeat: on ? Infinity : 0, delay: i * 0.45 }}
            >
              {label}
            </motion.span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/** Receptionist: a text arrives, a reply goes back. */
export function ReceptionistPreview({ active }: { active: boolean }) {
  const on = useMotionOn(active);
  return (
    <div className={SHELL} aria-hidden>
      <div className="absolute inset-0 flex flex-col justify-center gap-1.5 px-4">
        <motion.span
          className="w-fit rounded-lg rounded-bl-sm bg-graphite/60 px-2 py-1 text-[0.6rem] text-steel"
          animate={on ? { opacity: [0, 1, 1, 0], x: [-6, 0, 0, -6] } : { opacity: 1, x: 0 }}
          transition={{ duration: 3.4, repeat: on ? Infinity : 0, times: [0, 0.18, 0.75, 1] }}
        >
          any time Saturday?
        </motion.span>
        <motion.span
          className="ml-auto w-fit rounded-lg rounded-br-sm bg-gold/85 px-2 py-1 text-[0.6rem] font-medium text-gold-ink"
          animate={on ? { opacity: [0, 0, 1, 0], x: [6, 6, 0, 6] } : { opacity: 1, x: 0 }}
          transition={{ duration: 3.4, repeat: on ? Infinity : 0, times: [0, 0.42, 0.55, 1] }}
        >
          2pm is open, here is the link
        </motion.span>
      </div>
    </div>
  );
}
