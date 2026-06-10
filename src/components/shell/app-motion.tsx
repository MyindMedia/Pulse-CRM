"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";

/* Shared in-app motion, so every dashboard surface inherits the marketing
 * site's feel. AppTransition fades + lifts the whole page on each route change;
 * AppReveal rises content in as it scrolls into view. Both no-op under
 * prefers-reduced-motion. */

/** Wrap the (app) main content. Re-animates on every route change. */
export function AppTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  if (reduce) return <>{children}</>;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function useCountUpValue(target: number, run: boolean, ms: number) {
  const [v, setV] = React.useState(run ? 0 : target);
  const fromRef = React.useRef(run ? 0 : target);
  React.useEffect(() => {
    if (!run) {
      fromRef.current = target;
      setV(target);
      return;
    }
    const from = fromRef.current;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = from + (target - from) * eased;
      fromRef.current = next;
      setV(next);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run, ms]);
  return v;
}

/** Animated number - eases 0 -> value on mount, previous -> value on refresh.
 *  Matches the marketing DashboardSim count-up feel. Static under reduced motion. */
export function CountUp({
  to,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 900,
}: {
  to: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const v = useCountUpValue(to, !reduce, duration);
  return <>{format(v)}</>;
}

/** Rise + fade content into view on scroll. Drop-in around any block. */
export function AppReveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as];
  if (reduce) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay }}
    >
      {children}
    </MotionTag>
  );
}
