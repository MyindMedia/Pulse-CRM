"use client";

import * as React from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

/* Site-load reveal - the reference's column wipe. A full-screen overlay of
 * vertical gradient panels with two mono labels; the labels blink in, then
 * the columns wipe upward with a stagger and the overlay unmounts. Reduced
 * motion (or JS off via the unmount) skips straight to the page. */
const LABELS = ["Built for studios", "Run on Pulse"];

export function SiteReveal() {
  const root = React.useRef<HTMLDivElement>(null);
  const [done, setDone] = React.useState(false);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setDone(true);
        return;
      }
      const tl = gsap.timeline({ onComplete: () => setDone(true) });
      tl.fromTo(
        "[data-reveal-label]",
        { opacity: 0 },
        { opacity: 1, duration: 0.45, stagger: 0.18, ease: "power2.out" },
        0.1,
      )
        .to("[data-reveal-label]", { opacity: 0, duration: 0.3, ease: "power2.in" }, 1.05)
        .to(
          "[data-reveal-col]",
          { yPercent: -100, duration: 0.75, ease: "power3.inOut", stagger: 0.06 },
          1.2,
        );
    },
    { scope: root },
  );

  if (done) return null;

  return (
    <div ref={root} aria-hidden className="fixed inset-0 z-[120] overflow-hidden">
      {/* Column panels - slightly offset gradients with hairline separators. */}
      <div className="absolute inset-0 flex">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            data-reveal-col
            className="h-full flex-1 border-r border-white/[0.04] will-change-transform last:border-r-0"
            style={{
              background: `linear-gradient(to bottom, #161616 0%, ${i % 2 ? "#2a2a2e" : "#232326"} 100%)`,
            }}
          />
        ))}
      </div>
      {/* Mono labels, reference-style: small, tracked, mid-screen. */}
      <div className="absolute inset-0 flex items-center justify-around">
        {LABELS.map((label) => (
          <span key={label} data-reveal-label className="chrome-meta text-steel opacity-0">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
