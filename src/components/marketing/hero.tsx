"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DashboardSim } from "./dashboard-sim";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* Chrome-redesign hero, Dylanbrouwer composition: a solid "RUN YOUR" headline,
 * a giant ghosted "STUDIO" word that parallaxes behind a 3D-tilted monitor
 * holding the product screen. On load the lines clip+rise and the monitor
 * settles into its tilt; on scroll the monitor scrubs flat + scales and the
 * ghost word drifts. All motion is gated behind motion-safe / prefers-reduced-
 * motion so the resting composition is fully visible without JS or animation.
 * Screen is a static dashboard frame for now - swap to the looping Higgsfield
 * dashboard clip (<HlsVideo src="/dashboard-loop.webm" />) when it lands;
 * prompts in docs/dashboard-reveal-video-prompts.md. */
const CAPABILITIES = [
  "Bookings", "Deposits", "Rooms", "Staff", "Scheduling",
  "Sessions", "Inventory", "Invoices", "Payments", "Automations",
];

export function Hero() {
  const root = React.useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Entrance: headline lines clip + rise, then the monitor settles into its
      // resting tilt, then the supporting copy/CTAs fade up.
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.fromTo(
        "[data-hero-line]",
        { yPercent: 115, clipPath: "inset(0 0 100% 0)" },
        { yPercent: 0, clipPath: "inset(0 0 -10% 0)", duration: 0.9, stagger: 0.12 },
      )
        .fromTo(
          "[data-hero-monitor]",
          { y: 60, scale: 0.9, opacity: 0, rotateX: 26 },
          { y: 0, scale: 1, opacity: 1, rotateX: 12, duration: 1, ease: "power2.out" },
          "-=0.4",
        )
        .fromTo(
          "[data-hero-fade]",
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, stagger: 0.1 },
          "-=0.6",
        );

      // Scroll scrub: monitor rotates toward flat + grows and rises; the giant
      // "Studio." word sinks slower than scroll (parallax) so it tucks further
      // behind the monitor. Tied to scroll progress, not time.
      const scrub = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "bottom top",
          scrub: 0.6,
        },
      });
      scrub
        .to("[data-hero-monitor]", { rotateX: 0, scale: 1.06, y: -28, ease: "none" }, 0)
        .to("[data-hero-ghost]", { yPercent: 22, ease: "none" }, 0);
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-obsidian px-4 pb-24 pt-28 lg:px-8"
    >
      {/* Readability scrim: chrome-to-void radial + vertical fade. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 95% at 50% 26%, rgba(22,22,22,0.30) 0%, rgba(22,22,22,0.82) 100%), linear-gradient(to bottom, rgba(22,22,22,0.85) 0%, rgba(22,22,22,0.45) 38%, rgba(22,22,22,0.8) 72%, #161616 100%)",
        }}
      />
      {/* Thin vertical structure lines (desktop). */}
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 -z-0 hidden lg:block" />
      {/* Lone gold glow, center-top. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[2%] -z-0 h-[42%] w-[80%] -translate-x-1/2 rounded-full opacity-70 blur-[120px]"
        style={{ background: "radial-gradient(closest-side, rgba(253,185,19,0.16), transparent)" }}
      />

      {/* Content stage */}
      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center text-center">
        <p data-hero-fade className="chrome-meta text-steel motion-safe:opacity-0">
          The studio operating system · v1.0
        </p>

        {/* Headline: solid "Run your" over a giant "Studio." that the monitor
            rises up to overlap. */}
        <h1 className="chrome-display mt-6 flex flex-col items-center leading-[0.82]">
          <span className="block overflow-hidden">
            <span
              data-hero-line
              className="chrome-fill block text-[clamp(2rem,6vw,5rem)] tracking-[0.01em] motion-safe:[clip-path:inset(0_0_100%_0)]"
            >
              Run your
            </span>
          </span>
          <span className="block overflow-hidden">
            <span data-hero-line className="block motion-safe:[clip-path:inset(0_0_100%_0)]">
              <span
                data-hero-ghost
                className="chrome-fill block whitespace-nowrap text-[clamp(4.25rem,19vw,15.5rem)] leading-[0.8]"
              >
                Studio<span className="text-gold">.</span>
              </span>
            </span>
          </span>
        </h1>

        {/* Stage: the tilted monitor pulled up to overlap the headline's lower
            edge (monitor paints over "Studio." → the word peeks above it). */}
        <div className="relative z-0 -mt-[clamp(1.25rem,5vw,4rem)] flex w-full justify-center [perspective:1400px]">
          {/* 3D monitor */}
          <div
            data-hero-monitor
            className="relative z-10 w-[min(92vw,820px)] origin-top will-change-transform [transform-style:preserve-3d] motion-safe:opacity-0"
            style={{ transform: "rotateX(12deg)" }}
          >
            {/* Bezel */}
            <div className="overflow-hidden rounded-chrome border border-graphite/70 bg-coal shadow-[0_40px_120px_-30px_rgba(0,0,0,0.85)] ring-1 ring-white/5">
              {/* Top chrome bar */}
              <div className="flex items-center gap-1.5 border-b border-graphite/50 bg-obsidian/80 px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-graphite" />
                <span className="size-2.5 rounded-full bg-graphite" />
                <span className="size-2.5 rounded-full bg-graphite" />
                <span className="chrome-meta ml-3 text-steel/60">pulse · dashboard</span>
              </div>
              {/* Screen — live simulated app navigation. */}
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-obsidian">
                <DashboardSim />
                {/* Screen glare + gold edge bloom. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 28%), radial-gradient(120% 60% at 50% -10%, rgba(253,185,19,0.10), transparent 60%)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <p
          data-hero-fade
          className="font-grotesk mx-auto mt-10 max-w-[540px] text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist/85 motion-safe:opacity-0"
        >
          Bookings, rooms, staff, inventory and payments, all in sync and
          automated, so the studio runs without the busywork.
        </p>

        <div data-hero-fade className="mt-9 flex flex-wrap items-center justify-center gap-3 motion-safe:opacity-0">
          <Link
            href="#pricing"
            className="group inline-flex items-center gap-2 rounded-chrome bg-gold px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-gold-ink transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-bright focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
          >
            Get started
            <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="#features"
            className="chrome-ghost chrome-ghost-gold inline-flex items-center gap-2 rounded-chrome px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-mist transition-colors hover:text-gold"
          >
            See how it works
          </Link>
        </div>
      </div>

      {/* Mono metadata readout, lower-left (desktop). */}
      <div className="chrome-meta pointer-events-none absolute bottom-12 left-8 z-10 hidden flex-col gap-1 text-left text-steel/80 lg:flex">
        <span>Pulse by Myind Sound</span>
        <span>Studio OS</span>
        <span>Bookings → Royalties</span>
      </div>

      {/* Capability ticker - mono, edge-faded. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_14%,#000_86%,transparent)] lg:left-auto lg:right-8 lg:w-[40%]">
        <div className="animate-marquee flex w-max">
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
              {CAPABILITIES.map((c) => (
                <li key={c} className="chrome-meta flex items-center gap-6 px-6 text-steel/70">
                  <span className="size-1 rounded-full bg-gold/70" />
                  {c}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
