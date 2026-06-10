"use client";

import * as React from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* Client-studio strip - slanted parallelogram cards, one per studio Pulse has
 * worked with. The track is scroll-scrubbed (drifts left as you scroll down,
 * back right as you scroll up) instead of free-running. Every logo mark is an
 * inline SVG drawn in currentColor so it stays monochrome and exactly matches
 * the wordmark color. */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function MarkSlangCity() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path {...STROKE} d="M4 5.5h16v10H10l-4 4v-4H4z" />
      <path {...STROKE} d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" strokeWidth={2.4} />
    </svg>
  );
}

function MarkContainer() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <rect {...STROKE} x="3" y="7" width="18" height="11" rx="1" />
      <path {...STROKE} d="M7 7v11M11.5 7v11M16 7v11" opacity={0.7} />
    </svg>
  );
}

function MarkGerimano() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <circle {...STROKE} cx="12" cy="12" r="8.5" />
      <path {...STROKE} d="M15.5 9.5a4.5 4.5 0 1 0 1 4.5h-4" />
    </svg>
  );
}

function MarkGoodMusic() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path {...STROKE} d="M9 17.5V6l9-1.8V15" />
      <circle {...STROKE} cx="6.8" cy="17.5" r="2.2" />
      <circle {...STROKE} cx="15.8" cy="15" r="2.2" />
    </svg>
  );
}

function MarkGoldroom() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path {...STROKE} d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path {...STROKE} d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 7a8 8 0 0 1 0 10" />
    </svg>
  );
}

function MarkLumen() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <circle {...STROKE} cx="12" cy="12" r="4" />
      <path {...STROKE} d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2 18 18M18 6l-1.8 1.8M7.8 16.2 6 18" />
    </svg>
  );
}

function MarkVelvetRoom() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path {...STROKE} d="M5 20V11a7 7 0 0 1 14 0v9" />
      <path {...STROKE} d="M3.5 20h17M12 20v-5" />
    </svg>
  );
}

function MarkStaticSons() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
      <path {...STROKE} d="M4 10v4M8 7v10M12 4.5v15M16 7v10M20 10v4" />
    </svg>
  );
}

const STUDIOS: { name: string; Mark: () => React.ReactNode }[] = [
  { name: "Slang City Studios", Mark: MarkSlangCity },
  { name: "Container Studios", Mark: MarkContainer },
  { name: "Gerimano Studios", Mark: MarkGerimano },
  { name: "Good Music", Mark: MarkGoodMusic },
  { name: "Goldroom Audio", Mark: MarkGoldroom },
  { name: "Lumen Recording Co.", Mark: MarkLumen },
  { name: "Velvet Room Audio", Mark: MarkVelvetRoom },
  { name: "Static & Sons", Mark: MarkStaticSons },
];

export function LogoMarquee() {
  const root = React.useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      // Scroll-scrubbed drift: left on the way down, back right on the way up.
      gsap.fromTo(
        "[data-studio-track]",
        { xPercent: 2 },
        {
          xPercent: -24,
          ease: "none",
          scrollTrigger: {
            trigger: root.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.6,
          },
        },
      );
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative px-0 py-24">
      <div className="mx-auto max-w-6xl px-4 lg:px-8">
        <p className="chrome-meta text-steel">Clients</p>
        <p className="font-grotesk mt-3 max-w-prose text-[17px] font-medium tracking-[-0.01em] text-mist">
          Studios running on Pulse.
        </p>
      </div>

      <div className="mt-10 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]">
        <div data-studio-track className="flex w-max gap-6 px-3 will-change-transform">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center gap-6" aria-hidden={copy === 1}>
              {STUDIOS.map(({ name, Mark }) => (
                <div
                  key={name}
                  className="-skew-x-12 rounded-chrome border border-graphite/50 bg-coal px-10 py-6 transition-colors duration-200 hover:border-gold-dim/60"
                >
                  <span className="flex skew-x-12 items-center gap-3 whitespace-nowrap font-grotesk text-lg font-semibold text-bone/80">
                    <Mark />
                    {name}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
