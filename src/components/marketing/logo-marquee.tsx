"use client";

import * as React from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* Client-studio strip - slanted parallelogram cards, one per studio. Each
 * studio gets a distinct TYPOGRAPHIC wordmark (monochrome, inherits the card
 * text color) instead of a generic icon. The track is scroll-scrubbed and
 * centered on Slang City Studios: on mount we measure the Slang City card and
 * offset the track so it sits at viewport center mid-scroll, drifting left or
 * right with scroll direction.
 *
 * On mobile there is no room for that drift, so the strip becomes a plain
 * swipeable overflow-x scroller: the scrub is skipped below md and the
 * duplicate marquee copy is hidden so the reader swipes one honest set. */

const WORDMARKS: { key: string; center?: boolean; mark: React.ReactNode }[] = [
  {
    key: "Goldroom Audio",
    mark: (
      <span className="flex items-baseline gap-2">
        <span className="font-grotesk text-lg font-bold tracking-[0.18em]">GOLDROOM</span>
        <span className="chrome-meta text-[0.625rem] opacity-70">AUDIO</span>
      </span>
    ),
  },
  {
    key: "Container Studios",
    mark: (
      <span className="flex items-center gap-2.5">
        <span className="border border-current px-2 py-0.5 font-grotesk text-base font-semibold uppercase tracking-[0.08em]">
          Container
        </span>
        <span className="chrome-meta text-[0.625rem] opacity-70">STUDIOS</span>
      </span>
    ),
  },
  {
    key: "Gerimano Studios",
    mark: (
      <span className="flex items-baseline gap-2">
        <span className="font-serif text-xl italic tracking-tight">Gerimano</span>
        <span className="chrome-meta text-[0.625rem] opacity-70">STUDIOS</span>
      </span>
    ),
  },
  {
    key: "Slang City Studios",
    center: true,
    mark: (
      <span className="flex items-baseline gap-2">
        <span className="chrome-display text-xl tracking-[0.02em]">Slang City</span>
        <span className="chrome-meta text-[0.625rem] opacity-70">STUDIOS</span>
      </span>
    ),
  },
  {
    key: "Good Music",
    mark: <span className="font-grotesk text-xl font-extrabold lowercase tracking-[-0.03em]">good music.</span>,
  },
  {
    key: "Lumen Recording Co.",
    mark: (
      <span className="flex items-baseline gap-2">
        <span className="font-meta text-lg font-semibold uppercase tracking-[0.3em]">Lumen</span>
        <span className="chrome-meta text-[0.625rem] opacity-70">REC. CO</span>
      </span>
    ),
  },
  {
    key: "Velvet Room Audio",
    mark: (
      <span className="flex items-baseline gap-2">
        <span className="font-serif text-xl tracking-wide">
          Velvet <span className="italic">Room</span>
        </span>
        <span className="chrome-meta text-[0.625rem] opacity-70">AUDIO</span>
      </span>
    ),
  },
  {
    key: "Static & Sons",
    mark: (
      <span className="font-grotesk text-lg font-bold uppercase tracking-[0.12em]">
        Static <span className="font-serif lowercase italic">&amp;</span> Sons
      </span>
    ),
  },
];

export function LogoMarquee() {
  const root = React.useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      const mm = gsap.matchMedia();
      // Desktop only. Below md the strip is a native horizontal scroller and a
      // transform on the track would fight the user's swipe.
      mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
        const track = root.current?.querySelector<HTMLElement>("[data-studio-track]");
        const anchor = root.current?.querySelector<HTMLElement>("[data-studio-anchor]");
        if (!track || !anchor) return;
        // Offset so the Slang City card sits at viewport center when the strip
        // is mid-viewport; the scrub drifts around that point with scroll.
        const a = anchor.getBoundingClientRect();
        const t = track.getBoundingClientRect();
        const delta = window.innerWidth / 2 - (a.left - t.left + a.width / 2);
        const drift = window.innerWidth * 0.09;
        gsap.fromTo(
          track,
          { x: delta + drift },
          {
            x: delta - drift,
            ease: "none",
            scrollTrigger: {
              trigger: root.current,
              start: "top bottom",
              end: "bottom top",
              scrub: 0.6,
            },
          },
        );
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative overflow-hidden px-0 py-24">
      <div className="mx-auto max-w-6xl px-4 lg:px-8">
        <p className="chrome-meta text-steel">Client studios</p>
        <p className="font-grotesk mt-3 max-w-prose text-[17px] font-medium tracking-[-0.01em] text-mist">
          Studios that trust Myind Sound.
        </p>
      </div>

      <div className="no-scrollbar mt-10 overflow-x-auto overscroll-x-contain md:overflow-hidden md:[mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]">
        <div data-studio-track className="flex w-max gap-6 px-4 will-change-transform md:px-3">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              className={`shrink-0 items-center gap-6 ${copy === 1 ? "hidden md:flex" : "flex"}`}
              aria-hidden={copy === 1}
            >
              {WORDMARKS.map(({ key, center, mark }) => (
                <div
                  key={key}
                  data-studio-anchor={center && copy === 0 ? "" : undefined}
                  className="-skew-x-12 rounded-chrome border border-graphite/50 bg-coal px-10 py-6 transition-colors duration-200 hover:border-gold-dim/60"
                >
                  <span className="block skew-x-12 whitespace-nowrap text-bone/80">
                    <span className="sr-only">{key}</span>
                    <span aria-hidden>{mark}</span>
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
