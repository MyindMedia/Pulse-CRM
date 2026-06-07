"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Scroll-reveal wrapper. Fades + lifts its children into view the first time
 *  they enter the viewport. Dependency-free (IntersectionObserver), and fully
 *  disabled under prefers-reduced-motion so the content is just there. */
export function Reveal({
  children,
  className,
  delay = 0,
  immediate = false,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /** Reveal on mount instead of on scroll. Use for above-the-fold content so
   *  it animates in on load and is never gated behind a scroll trigger. */
  immediate?: boolean;
  as?: "div" | "li" | "section";
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Immediate (above-the-fold) or no observer support: reveal on the next
    // frame so the content animates in and is never stuck hidden. Deferred so
    // it is not a synchronous setState inside the effect body.
    if (immediate || typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.1 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [immediate]);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        "transition-all duration-700 ease-out will-change-transform",
        "motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
