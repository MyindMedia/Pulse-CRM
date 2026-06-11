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

      // The monitor's transform-origin is its BASE (bottom center), and the
      // desk render is sized + welded to that base in the markup, so every
      // rotateY/scale below swivels the monitor in place on the desk - it
      // never lifts off the surface.
      const mm = gsap.matchMedia();
      mm.add(
        { desktop: "(min-width: 768px)", mobile: "(max-width: 767px)" },
        (ctx) => {
          const desktop = Boolean((ctx.conditions as { desktop?: boolean }).desktop);
          // Pose the monitor settles into after the entrance. On desktop the
          // scroll scrub then swings it; on mobile (no pin, no scrub) it lands
          // directly in its resting three-quarter pose.
          const settle = desktop
            ? { rotateY: 52, scale: 0.66 }
            : { rotateY: 16, scale: 0.84 };

          // Entrance: headline lines clip + rise, the desk fades up, then the
          // monitor swivels up into its settle pose standing on the desk, then
          // the supporting copy/CTAs fade up. Delayed so it begins as the
          // SiteReveal columns wipe away.
          const tl = gsap.timeline({ defaults: { ease: "power3.out" }, delay: 1.35 });
          tl.fromTo(
            "[data-hero-line]",
            { yPercent: 115, clipPath: "inset(0 0 100% 0)" },
            { yPercent: 0, clipPath: "inset(0 0 -10% 0)", duration: 0.9, stagger: 0.12 },
          )
            // The studio desk is visible from the start - it is the surface
            // the monitor stands on, not a late-arriving backdrop. This is the
            // ONLY tween that touches the ledge: a second (scrub) tween on the
            // same property re-renders the hidden from-state when scrubbing
            // backwards past it, blinking the desk out.
            .fromTo(
              "[data-hero-ledge]",
              { autoAlpha: 0 },
              { autoAlpha: 1, duration: 1.0 },
              "-=0.5",
            )
            .fromTo(
              "[data-hero-monitor]",
              { scale: 0.55, opacity: 0, rotateY: 84 },
              { ...settle, opacity: 1, duration: 1.1, ease: "power2.out" },
              "-=0.7",
            )
            .fromTo(
              "[data-hero-fade]",
              { y: 24, opacity: 0 },
              { y: 0, opacity: 1, duration: 0.7, stagger: 0.1 },
              "-=0.6",
            );

          if (!desktop) return;

          // Scroll scrub + pin handoff (desktop only - mobile reads the resting
          // pose with normal scrolling). The section pins for ~2 viewports:
          //   Phase 1 (t 0-1): the monitor swings around its base toward the
          //     viewer - past front - while the ghost logo parallaxes.
          //   Phase 2 (t 1-2): headline + copy exit upward, the stage glides up
          //     (desk + monitor together, still attached), the swing settles
          //     back to a held three-quarter pose and the desk brightens fully.
          // Lenis runs native scroll (no body transform), so pinType stays
          // "fixed" and pinning works with the existing ScrollTrigger sync.
          // Bottom of the stage (the stand base / desk contact line) relative
          // to the pinned section's top - used to size the stage lift so the
          // base is on screen during the swing even on short/shallow windows,
          // where a fixed 8vh rise leaves it below the fold ("floating").
          const stageBottom = () => {
            const stage = root.current?.querySelector<HTMLElement>("[data-hero-stage]");
            if (!stage || !root.current) return window.innerHeight;
            return (
              stage.getBoundingClientRect().bottom - root.current.getBoundingClientRect().top
            );
          };

          const scrub = gsap.timeline({
            scrollTrigger: {
              trigger: root.current,
              start: "top top",
              end: "+=200%",
              scrub: 0.6,
              pin: true,
              pinSpacing: true,
              anticipatePin: 1,
              invalidateOnRefresh: true,
            },
          });
          scrub
            // Phase 1 - the monitor swings around in place on the desk: base
            // anchored, it rotates past front-facing (slight overshoot) while
            // growing toward the viewer. Explicit fromTo (no immediateRender):
            // the from values must equal the entrance SETTLE pose, or scrolling
            // back to the top restores the monitor to its pre-entrance state.
            .fromTo(
              "[data-hero-monitor]",
              { rotateY: settle.rotateY, scale: settle.scale },
              { rotateY: 6, scale: 0.8, ease: "none", duration: 1, immediateRender: false },
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
              {
                y: () =>
                  -Math.max(window.innerHeight * 0.08, stageBottom() - window.innerHeight * 0.94),
                ease: "none",
                duration: 1,
                immediateRender: false,
              },
              0,
            )
            // Phase 2 - headline + copy exit upward while the monitor holds.
            .to(
              "[data-hero-exit]",
              { yPercent: -160, autoAlpha: 0, ease: "none", duration: 0.7, stagger: 0.05 },
              1.05,
            )
            // The whole stage (desk + monitor + crosshairs) glides up together
            // to take the vacated center - the base never leaves the desk.
            .to(
              "[data-hero-stage]",
              {
                y: () =>
                  -Math.max(window.innerHeight * 0.3, stageBottom() - window.innerHeight * 0.62),
                ease: "none",
                duration: 0.8,
              },
              1.05,
            )
            // The background mains follow at half rate: nearer desk slides
            // past them (depth parallax) but their tops stay in frame
            // flanking the landed scene instead of being swallowed by the
            // risen desk.
            .to(
              "[data-hero-bgspeaker]",
              {
                y: () =>
                  -Math.max(window.innerHeight * 0.3, stageBottom() - window.innerHeight * 0.62) *
                  0.5,
                ease: "none",
                duration: 0.8,
              },
              1.05,
            )
            // The swing settles back from the overshoot into a held
            // three-quarter pose - the resting view stays 3D, never flat.
            .to(
              "[data-hero-monitor]",
              { rotateY: 14, ease: "none", duration: 0.8 },
              1.05,
            );
        },
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
      {/* Large studio mains flanking the scene: partially visible at either
          edge, standing ~5ft behind the desk in low light. They live on the
          section (not the stage), so when the stage glides up on scroll the
          desk moves while they hold still - background parallax that sells
          the depth. Tagged data-hero-ledge to share the scene's entrance
          fade. Desktop only: on small screens they would crowd the frame. */}
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          data-hero-ledge
          data-hero-bgspeaker
          aria-hidden
          className="pointer-events-none absolute bottom-[38%] z-0 hidden select-none opacity-85 motion-safe:opacity-0 lg:block"
          style={{ [side]: "-3.5%" } as React.CSSProperties}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/speaker-main.png"
            alt=""
            draggable={false}
            className="h-[min(64vh,580px)] w-auto"
            style={{
              filter: "brightness(0.5) saturate(0.85) blur(1.6px)",
              transform: side === "right" ? "scaleX(-1)" : undefined,
            }}
          />
        </div>
      ))}
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
                  className="mx-auto block w-[clamp(12rem,38vw,34rem)] select-none"
                />
              </span>
            </span>
          </span>
        </h1>

        {/* Stage: a distant, sideways monitor that swings forward and centers
            to a head-on view as you scroll. The rendered monitor frame (PNG)
            and the live screen are one transformed unit, so they share the
            exact same perspective. */}
        <div className="relative z-0 -mt-[clamp(2.5rem,8vw,6rem)] w-full">
          <div data-hero-stage className="relative flex w-full justify-center">
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
            {/* Sizing context shared by the desk and the monitor: the desk is
                sized as a multiple of the monitor's width and its tabletop
                line is translated onto the monitor's base, so the two stay
                welded at every viewport and every scroll position. Perspective
                lives here so the monitor (direct child) renders in 3D. */}
            {/* Width also capped by viewport height: on wide-but-shallow
                windows an 880px monitor is taller than the viewport and its
                base (and the desk under it) falls below the fold. */}
            <div className="relative w-[min(90vw,880px,115vh)] [perspective:1150px]">
            {/* The studio's own desk console (true-alpha render): the surface
                the monitor stands on, visible from the entrance. 230% of the
                monitor's width so the console clearly outsizes the monitor and
                its flanking speakers stay in frame; translateY pulls the top
                of the central gear bridge (~43.5% down the render) up to the
                monitor's base, so the monitor stands on the console's upper
                tier at top-center, above the gear and desk layer.
                A warm key spotlight and floor pool live inside the wrapper so
                the dim studio look travels with the desk. */}
            <div
              data-hero-ledge
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-full z-0 w-[230%] max-w-none select-none opacity-85 motion-safe:opacity-0"
              style={{ transform: "translate(-50%, -43.5%)" }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10"
                style={{
                  background:
                    "radial-gradient(48% 60% at 50% 36%, rgba(255,238,200,0.13), transparent 72%), radial-gradient(22% 14% at 50% 43%, rgba(255,238,200,0.12), transparent 70%), radial-gradient(75% 30% at 50% 92%, rgba(255,238,200,0.05), transparent 75%)",
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero-scene.webp"
                alt=""
                draggable={false}
                className="block w-full"
                style={{
                  maskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 14%, #000 96%, transparent 100%), linear-gradient(to right, transparent 0%, #000 6%, #000 94%, transparent 100%)",
                  maskComposite: "intersect",
                  WebkitMaskImage:
                    "linear-gradient(to bottom, transparent 0%, #000 14%, #000 96%, transparent 100%), linear-gradient(to right, transparent 0%, #000 6%, #000 94%, transparent 100%)",
                  WebkitMaskComposite: "source-in",
                }}
              />
            </div>
            {/* Contact shadow welding the stand base to the desk surface. It
                lives outside the rotating monitor (a ground shadow stays on
                the desk plane) but inside the sizing wrapper, so it tracks the
                base across viewports and scroll. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 z-[1] -translate-x-1/2"
              style={{
                bottom: "-3%",
                width: "58%",
                height: "7%",
                background: "radial-gradient(50% 50% at 50% 50%, rgba(0,0,0,0.65), transparent 70%)",
              }}
            />
            {/* 3D monitor. transform-origin is the BASE of the stand (bottom
                center): every rotate/scale swivels it in place on the desk. */}
          <div
            data-hero-monitor
            className="relative z-10 w-full will-change-transform [transform-style:preserve-3d] [transform-origin:50%_100%] motion-safe:opacity-0"
            style={{ transform: "rotateY(14deg) scale(0.8)" }}
          >
            {/* 3D body: a back face + left side wall extruded behind the flat
                render, so the sideways pose reads as a solid monitor with
                depth instead of a paper cutout. Both rotate with the display
                (same preserve-3d parent). The body spans the panel region of
                the PNG (the stand starts at ~70% height). */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 bottom-[22%] rounded-md bg-[#0b0b0c]"
              style={{ transform: "translateZ(-26px)" }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-[22%] left-0 top-0 w-[26px] rounded-sm"
              style={{
                transform: "rotateY(90deg)",
                transformOrigin: "left center",
                background: "linear-gradient(to right, #2e2e31, #101012)",
              }}
            />
            {/* Rendered monitor (Gemini render, transparent PNG). The painted
                stand is clipped off (it is a flat front view that breaks the
                3D illusion when the monitor rotates) and replaced by the CSS
                3D stand below, which rotates with the panel. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/monitor-stand.png"
              alt=""
              aria-hidden
              draggable={false}
              className="block w-full select-none drop-shadow-[0_50px_120px_rgba(0,0,0,0.7)]"
              style={{ clipPath: "inset(0 0 21.6% 0)" }}
            />
            {/* CSS 3D stand. Geometry measured from the render: column 5% wide
                at center from y 78% down; base plate 44.8% wide at the floor.
                Column: front face on the image plane, back face and side wall
                extruded 26px like the panel body. */}
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-[1.6%] left-[47.4%] right-[47.4%] top-[77.5%] [transform-style:preserve-3d]"
            >
              <div
                className="absolute inset-0"
                style={{ transform: "translateZ(-26px)", background: "#0a0a0b" }}
              />
              <div
                className="absolute bottom-0 left-0 top-0 w-[26px]"
                style={{
                  transform: "rotateY(90deg)",
                  transformOrigin: "left center",
                  background: "linear-gradient(to right, #232326, #0e0e10)",
                }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(to right, #2c2c30 0%, #1b1b1e 45%, #0f0f11 100%)",
                }}
              />
            </div>
            {/* Base plate lying on the desk: rear top face, front top face,
                then the plate's front edge pushed to the front of its depth. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-[27.6%] right-[27.6%]"
              style={{
                bottom: "1.6%",
                height: "30px",
                transform: "rotateX(90deg)",
                transformOrigin: "50% 100%",
                background: "#0b0b0c",
                borderRadius: "10px 10px 0 0",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute left-[27.6%] right-[27.6%]"
              style={{
                bottom: "1.6%",
                height: "34px",
                transform: "rotateX(-90deg)",
                transformOrigin: "50% 100%",
                background: "linear-gradient(to bottom, #26262a, #131316)",
                borderRadius: "0 0 10px 10px",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-[27.6%] right-[27.6%]"
              style={{
                height: "1.6%",
                transform: "translateZ(34px)",
                background: "linear-gradient(to bottom, #2a2a2e, #0d0d0f)",
                borderRadius: "2px 2px 5px 5px",
              }}
            />
            {/* Live screen, mapped onto the panel (near-borderless; chin bar
                and stand below). */}
            <div
              className="absolute overflow-hidden bg-obsidian"
              style={{ top: "1.2%", left: "1.0%", right: "1.1%", bottom: "26.5%", containerType: "inline-size" }}
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
          </div>
        </div>

        <p
          data-hero-fade
          data-hero-exit
          className="font-grotesk mx-auto mt-10 max-w-[540px] text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist/85 [text-shadow:0_1px_4px_rgba(0,0,0,0.85),0_2px_18px_rgba(0,0,0,0.7)] motion-safe:opacity-0"
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
