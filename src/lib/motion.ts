import type { Transition, Variants } from "motion/react";

/* ── Spring presets - the "Skiper feel": springs, never linear ── */
export const springSmooth: Transition = { type: "spring", stiffness: 400, damping: 35 };
export const springBouncy: Transition = { type: "spring", stiffness: 500, damping: 26, mass: 0.8 };
export const springGentle: Transition = { type: "spring", stiffness: 240, damping: 30 };
export const springSnappy: Transition = { type: "spring", stiffness: 700, damping: 40 };

/* ── Reusable variants ── */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: springGentle },
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: { opacity: 1, scale: 1, transition: springSmooth },
  exit: { opacity: 0, scale: 0.96, transition: { duration: 0.14 } },
};

export const staggerChildren = (stagger = 0.05): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: 0.04 } },
});

/* Direction-aware slide (skiper96 content swap) */
export const directionalSlide: Variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 32 : -32, opacity: 0 }),
  center: { x: 0, opacity: 1, transition: springSmooth },
  exit: (dir: number) => ({ x: dir > 0 ? -32 : 32, opacity: 0, transition: { duration: 0.14 } }),
};

/* Modal / drawer surface */
export const modalSurface: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: springSmooth },
  exit: { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.16 } },
};

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};
