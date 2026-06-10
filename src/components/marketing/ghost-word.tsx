"use client";

import * as React from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* Dylanbrouwer-style giant ghost word: a viewport-spanning background word
 * that parallaxes slower than scroll, sitting between the page background and
 * the section content. Purely additive - the parent section must be
 * `relative overflow-hidden`, and the section's content needs `relative z-10`
 * so it stacks above the word.
 *
 * Default tint reads on the DARK page (white at ~6 percent). For light
 * sections (bg-bone) pass a dark tint via className, for example
 * `text-obsidian/[0.05]`. */
export function GhostWord({
  word,
  className,
}: {
  word: string;
  className?: string;
}) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const text = React.useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const el = text.current;
      if (!el) return;

      // Scrub against the hosting section so the word drifts from -12 to 12
      // yPercent across the section's scroll-through - visibly lagging the
      // content (parallax).
      const section = el.closest("section") ?? wrap.current;
      gsap.fromTo(
        el,
        { yPercent: -12 },
        {
          yPercent: 12,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.6,
          },
        },
      );
    },
    { scope: wrap },
  );

  return (
    <div
      ref={wrap}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"
    >
      <span
        ref={text}
        className={cn(
          "chrome-display select-none whitespace-nowrap text-[clamp(5rem,18vw,16rem)] uppercase leading-none will-change-transform",
          "text-white/[0.06]",
          className,
        )}
      >
        {word}
      </span>
    </div>
  );
}
