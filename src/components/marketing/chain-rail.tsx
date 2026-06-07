"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** The literal "unbroken chain": a hairline rail with six nodes that fills with
 *  gold left-to-right the first time it scrolls into view. The gold line and the
 *  node fills are staggered so the chain visibly connects, link by link. */
export function ChainRail({ count = 6 }: { count?: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setDrawn(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -20% 0px", threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="relative mx-auto h-2 max-w-5xl">
      {/* base rail */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline" />
      {/* drawing gold rail */}
      <div
        className={cn("chain-line absolute inset-x-0 top-1/2 h-px -translate-y-1/2", drawn && "is-drawn")}
        style={{
          background:
            "linear-gradient(to right, var(--color-gold-deep), var(--color-gold) 50%, var(--color-gold-bright))",
          boxShadow: "0 0 12px rgba(253,185,19,0.5)",
        }}
      />
      {/* nodes */}
      <div className="absolute inset-0 flex items-center justify-between">
        {Array.from({ length: count }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "size-2 rounded-full ring-2 ring-ink transition-colors duration-500",
              drawn ? "bg-gold" : "bg-hairline-2",
            )}
            style={{ transitionDelay: `${(i / count) * 900}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
