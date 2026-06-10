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
      // resting tilt, then the supporting copy/CTAs fade up. Delayed so it
      // begins as the SiteReveal columns wipe away.
      const tl = gsap.timeline({ defaults: { ease: "power3.out" }, delay: 1.35 });
      tl.fromTo(
        "[data-hero-line]",
        { yPercent: 115, clipPath: "inset(0 0 100% 0)" },
        { yPercent: 0, clipPath: "inset(0 0 -10% 0)", duration: 0.9, stagger: 0.12 },
      )
        .fromTo(
          "[data-hero-scene]",
          { y: 70, scale: 0.55, opacity: 0, rotateX: 12 },
          { y: 0, scale: 0.62, opacity: 1, rotateX: 6, duration: 1.1, ease: "power2.out" },
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
      // Camera push-in: the scene scales about the SCREEN's center (the
      // transform origin), so zooming reads as dollying into the monitor.
      // Final zoom makes the screen fill ~94% of the viewport width, capped
      // so it never overflows the viewport height.
      const zoom = () =>
        Math.min(0.94 / 0.302, (0.96 * window.innerHeight) / (0.292 * 0.558 * window.innerWidth));

      scrub
        // Phase 1 - perspective starts flattening and the camera moves in
        // while the headline parallax-drifts. Explicit fromTo (settle-pose
        // start values, no immediateRender) so scrolling back to the top
        // restores the rest pose, not the pre-entrance state.
        .fromTo(
          "[data-hero-scene]",
          { scale: 0.62, rotateX: 6, y: 0 },
          { scale: 1.25, rotateX: 2, y: 0, ease: "none", duration: 1, immediateRender: false },
          0,
        )
        .fromTo(
          "[data-hero-ghost]",
          { yPercent: 0 },
          { yPercent: 26, ease: "none", duration: 1, immediateRender: false },
          0,
        )
        .fromTo(
          "[data-hero-stage]",
          { y: 0 },
          { y: () => -window.innerHeight * 0.12, ease: "none", duration: 1, immediateRender: false },
          0,
        )
        // Phase 2 - headline + copy exit upward while the camera completes
        // the push: perspective fully flat, the live screen fills the frame.
        .to(
          "[data-hero-exit]",
          { yPercent: -160, autoAlpha: 0, ease: "none", duration: 0.6, stagger: 0.05 },
          1.0,
        )
        .to("[data-hero-scene]", { scale: zoom, rotateX: 0, ease: "none", duration: 0.95 }, 1.05)
        .to("[data-hero-stage]", { y: () => -window.innerHeight * 0.34, ease: "none", duration: 0.95 }, 1.05);
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
          The recording studio OS · v1.0
        </p>

        {/* Headline: "Run your studio with" over the giant Pulse brand lockup
            that the monitor rises up to overlap. */}
        <h1 data-hero-exit className="chrome-display mt-6 flex flex-col items-center leading-[0.82]">
          <span className="block overflow-hidden">
            <span
              data-hero-line
              className="chrome-fill block text-[clamp(1.6rem,4.6vw,3.9rem)] tracking-[0.01em] motion-safe:[clip-path:inset(0_0_100%_0)]"
            >
              Run your studio with
            </span>
          </span>
          {/* data-hero-ghost sits on the un-clipped outer span: the parallax
              drift must not move the logo inside the overflow-hidden entrance
              wrapper or its bottom gets cut off. */}
          <span data-hero-ghost className="mt-[0.35em] block">
            <span className="block overflow-hidden">
              <span data-hero-line className="block whitespace-nowrap motion-safe:[clip-path:inset(0_0_100%_0)]">
                <span className="sr-only">Pulse</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/pulse-logo-main.png"
                  alt=""
                  aria-hidden
                  draggable={false}
                  className="mx-auto block w-[clamp(15rem,52vw,46rem)] select-none"
                />
              </span>
            </span>
          </span>
        </h1>

        {/* Stage: ONE perspective-correct rendered scene - the monitor dead
            center on a full-width walnut console with two rows of gear (three
            units each side). The live sim is mapped onto the screen rectangle,
            so scene + UI share the same camera. On scroll the camera pushes
            in: the scene tilts flat and scales about the screen center until
            the live app UI fills the frame. */}
        <div className="relative z-0 -mt-[clamp(1.5rem,5vw,3.5rem)] w-full">
          <div data-hero-stage className="relative flex w-full justify-center [perspective:1200px]">
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
            <div
              data-hero-scene
              className="relative w-screen max-w-none will-change-transform motion-safe:opacity-0"
              style={{ transformOrigin: "50% 40.3%", transform: "scale(0.62) rotateX(6deg)" }}
            >
              {/* The rendered scene (dark studio backdrop baked to match the
                  page #161616, so it blends without keying). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-scene.png"
                alt=""
                aria-hidden
                draggable={false}
                className="block w-full select-none"
                style={{
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 16%, #000 96%, transparent 100%), linear-gradient(to right, transparent 0%, #000 6%, #000 94%, transparent 100%)",
                  maskComposite: "intersect",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 16%, #000 96%, transparent 100%), linear-gradient(to right, transparent 0%, #000 6%, #000 94%, transparent 100%)",
                  WebkitMaskComposite: "source-in",
                }}
              />
              {/* Live app UI mapped onto the monitor's screen rectangle. */}
              <div
                className="absolute overflow-hidden bg-obsidian"
                style={{
                  left: "34.9%",
                  top: "25.7%",
                  width: "30.2%",
                  height: "29.2%",
                  containerType: "inline-size",
                }}
              >
                <DashboardSim />
                {/* Screen glare + gold edge bloom. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(115deg, rgba(255,255,255,0.07) 0%, transparent 30%), radial-gradient(120% 60% at 50% -10%, rgba(253,185,19,0.07), transparent 60%)",
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <p
          data-hero-fade
          data-hero-exit
          className="font-grotesk mx-auto mt-10 max-w-[540px] text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist/85 motion-safe:opacity-0"
        >
          Bookings, deposits, rooms, staff and gear, all in sync and automated,
          so the recording studio runs without the busywork.
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
