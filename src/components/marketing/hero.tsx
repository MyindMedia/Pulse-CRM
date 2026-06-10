"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DashboardSim } from "./dashboard-sim";
import { CursorZone } from "./cursor-chip";

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

  // Live locale clock for the mono readout: "<CITY> · HH:MM <TZ>". Initialized
  // in an effect (server renders a placeholder) so there is no hydration
  // mismatch; refreshed every 30s.
  const [clock, setClock] = React.useState<string | null>(null);
  React.useEffect(() => {
    const update = () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const city = (tz.split("/").pop() ?? tz).replace(/_/g, " ").toUpperCase();
        const parts = new Intl.DateTimeFormat(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
          timeZoneName: "short",
        }).formatToParts(new Date());
        const part = (type: Intl.DateTimeFormatPartTypes) =>
          parts.find((p) => p.type === type)?.value ?? "";
        setClock(`${city} · ${part("hour")}:${part("minute")} ${part("timeZoneName")}`);
      } catch {
        setClock(null);
      }
    };
    update();
    const id = window.setInterval(update, 30_000);
    return () => window.clearInterval(id);
  }, []);

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
          { y: 60, scale: 0.5, opacity: 0, rotateY: 85, rotateZ: -8 },
          { y: -16, scale: 0.58, opacity: 1, rotateY: 50, rotateZ: -4, duration: 1.1, ease: "power2.out" },
          "-=0.4",
        )
        .fromTo(
          "[data-hero-fade]",
          { y: 24, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.7, stagger: 0.1 },
          "-=0.6",
        );

      // Scroll scrub + pin handoff. The section pins for ~2 viewports of scroll:
      //   Phase 1 (t 0-1): monitor rotates toward flat + grows while the giant
      //     "Studio." word sinks slower than scroll (parallax) - the original scrub.
      //   Phase 2 (t 1-2): with the monitor held flat + centered, the headline and
      //     supporting copy exit upward and the dark desk ledge rises in beneath
      //     the monitor so it visually lands on a surface; then the pin releases.
      // Lenis runs native scroll (no body transform), so pinType stays "fixed"
      // and pinning works with the existing ScrollTrigger sync.
      const scrub = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "+=200%",
          scrub: 0.6,
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
        },
      });
      scrub
        // Phase 1 - sideways monitor swings to front-facing and grows; the
        // stage already starts rising so the monitor stays fully in frame.
        .to(
          "[data-hero-monitor]",
          { rotateY: 0, rotateZ: 0, scale: 0.84, y: 0, ease: "none", duration: 1 },
          0,
        )
        .to("[data-hero-ghost]", { yPercent: 26, ease: "none", duration: 1 }, 0)
        .to("[data-hero-stage]", { y: () => -window.innerHeight * 0.08, ease: "none", duration: 1 }, 0)
        // Phase 2 - headline + copy exit upward while the monitor holds.
        .to(
          "[data-hero-exit]",
          { yPercent: -160, autoAlpha: 0, ease: "none", duration: 0.7, stagger: 0.05 },
          1.05,
        )
        // The whole stage (monitor + ledge + crosshairs) glides up to take the
        // vacated center, like the reference's landing move.
        .to(
          "[data-hero-stage]",
          { y: () => -window.innerHeight * 0.23, ease: "none", duration: 0.8 },
          1.05,
        )
        // Desk ledge rises/fades in under the monitor.
        .fromTo(
          "[data-hero-ledge]",
          { autoAlpha: 0, yPercent: 45 },
          { autoAlpha: 1, yPercent: 0, ease: "none", duration: 0.6 },
          1.2,
        );
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
        <p data-hero-fade data-hero-exit className="chrome-meta text-steel motion-safe:opacity-0">
          The studio operating system · v1.0
        </p>

        {/* Headline: solid "Run your" over a giant "Studio." that the monitor
            rises up to overlap. */}
        <h1 data-hero-exit className="chrome-display mt-6 flex flex-col items-center leading-[0.82]">
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

        {/* Stage: a distant, steeply-tilted monitor that zooms forward, centers
            and flattens to a head-on view as you scroll. The rendered monitor
            frame (PNG) and the live screen are one transformed unit, so they
            share the exact same perspective. Wrapped in a CursorZone so a mono
            "Play showreel" chip trails fine pointers across the stage. */}
        <CursorZone label="Play showreel" className="relative z-0 -mt-[clamp(2.5rem,8vw,6rem)] w-full">
          <div data-hero-stage className="relative flex w-full justify-center [perspective:1150px]">
            {/* Crosshair registration marks at the stage corners. */}
            {(["left-0 top-0", "right-0 top-0", "bottom-0 left-0", "bottom-0 right-0"] as const).map(
              (pos) => (
                <span
                  key={pos}
                  aria-hidden
                  className={`chrome-meta pointer-events-none absolute ${pos} z-20 select-none leading-none text-steel/50`}
                >
                  +
                </span>
              ),
            )}
            {/* Desk ledge: a dark strip the monitor lands on at the end of the
                pin. Plain div (gradient + top hairline) so a rendered PNG can
                swap in later. Hidden until the scrub's final phase. */}
            <div
              data-hero-ledge
              aria-hidden
              className="pointer-events-none absolute inset-x-0 -bottom-10 z-0 h-[clamp(3.5rem,9vh,6rem)] rounded-chrome border-t border-bone/10 opacity-0"
              style={{ background: "linear-gradient(to bottom, #0a0a0a, #161616)" }}
            />
            {/* 3D monitor */}
          <div
            data-hero-monitor
            className="relative z-10 w-[min(90vw,880px)] origin-center will-change-transform [transform-style:preserve-3d] motion-safe:opacity-0"
            style={{ transform: "rotateY(10deg) scale(0.92)" }}
          >
            {/* Rendered monitor incl. stand (Gemini render, transparent PNG). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/monitor-stand.png"
              alt=""
              aria-hidden
              draggable={false}
              className="block w-full select-none drop-shadow-[0_50px_120px_rgba(0,0,0,0.7)]"
            />
            {/* Live screen, mapped onto the panel (near-borderless; stand below). */}
            <div
              className="absolute overflow-hidden bg-obsidian"
              style={{ top: "1.2%", left: "1.0%", right: "1.1%", bottom: "30.7%", containerType: "inline-size" }}
            >
              <DashboardSim />
              {/* Screen glare + gold edge bloom. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "linear-gradient(115deg, rgba(255,255,255,0.08) 0%, transparent 30%), radial-gradient(120% 60% at 50% -10%, rgba(253,185,19,0.08), transparent 60%)",
                }}
              />
            </div>
          </div>
          </div>
        </CursorZone>

        <p
          data-hero-fade
          data-hero-exit
          className="font-grotesk mx-auto mt-10 max-w-[540px] text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist/85 motion-safe:opacity-0"
        >
          Bookings, rooms, staff, inventory and payments, all in sync and
          automated, so the studio runs without the busywork.
        </p>

        <div
          data-hero-fade
          data-hero-exit
          className="mt-9 flex flex-wrap items-center justify-center gap-3 motion-safe:opacity-0"
        >
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
        {/* Live locale clock - effect-initialized, nbsp placeholder pre-hydration. */}
        <span suppressHydrationWarning>{clock ?? "\u00A0"}</span>
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
