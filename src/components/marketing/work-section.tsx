"use client";

import * as React from "react";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DashboardSim } from "./dashboard-sim";
import { MobileSim } from "./mobile-sim";
import { Reveal } from "./reveal";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/* "In the studio" - device-mockup section. A laptop runs the live desktop Pulse
 * UI (DashboardSim) and a phone runs the live mobile UI (MobileSim), each framed
 * in a chrome bezel with a gold hover frame. Real UI on every screen.
 * Dylanbrouwer behaviors: the two device columns scrub at different rates so
 * they slide past each other (desktop only, motion-safe), a cursor-follow
 * "Show work" chip trails over each device, and mono label chips tag each card. */

/* Small mono chip row, dylanbrouwer style: filled chip with gold dot + ghost tags.
 * Rendered below each device mockup (not on the screen), above the figcaption. */
function LabelChips({ name, tags, className = "" }: { name: string; tags: string[]; className?: string }) {
  return (
    <div className={`chrome-meta flex items-center gap-1.5 text-[0.625rem] ${className}`}>
      <span className="flex items-center gap-1.5 rounded-chrome bg-obsidian px-2 py-1 text-bone">
        <span className="size-1.5 rounded-full bg-gold" />
        {name}
      </span>
      {tags.map((tag) => (
        <span key={tag} className="rounded-chrome border border-graphite/50 px-2 py-1 text-steel/70">
          {tag}
        </span>
      ))}
    </div>
  );
}

export function WorkSection() {
  const root = React.useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      // Two-column stagger parallax (desktop only): as the section scrolls
      // through the viewport, the laptop column drifts up while the phone
      // column drifts down, so the cards slide past each other.
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", () => {
        const scrub = gsap.timeline({
          scrollTrigger: {
            trigger: root.current,
            start: "top bottom",
            end: "bottom top",
            scrub: 0.6,
          },
        });
        scrub
          .fromTo("[data-work-col-a]", { yPercent: 8 }, { yPercent: -8, ease: "none" }, 0)
          .fromTo("[data-work-col-b]", { yPercent: -8 }, { yPercent: 8, ease: "none" }, 0);
      });
    },
    { scope: root },
  );

  return (
    <section
      ref={root}
      id="in-the-studio"
      className="relative overflow-hidden bg-obsidian px-4 py-32 lg:px-8 lg:py-40"
    >
      {/* Soft top hairline + faint gold floor glow. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-graphite/40" />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-10%] left-1/2 h-[40%] w-[70%] -translate-x-1/2 rounded-full opacity-50 blur-[140px]"
        style={{ background: "radial-gradient(closest-side, rgba(253,185,19,0.12), transparent)" }}
      />

      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <p className="chrome-meta text-steel">In the studio</p>
          <h2 className="chrome-display chrome-fill mt-5 max-w-2xl text-[clamp(2.25rem,5.5vw,4.25rem)] leading-[1.04]">
            Built for the room
            <br />
            you work in<span className="text-gold">.</span>
          </h2>
          <p className="font-grotesk mt-6 max-w-xl text-[17px] leading-relaxed tracking-[-0.01em] text-mist/80">
            From the front desk to the live room, Pulse runs on every screen -
            so the session keeps moving whether you are at the console or on the way in.
          </p>
        </Reveal>

        <div className="mt-20 grid items-end gap-10 lg:mt-24 lg:grid-cols-[1.7fr_1fr]">
          {/* Laptop column - drifts up on scroll */}
          <div data-work-col-a className="will-change-transform">
            <Reveal>
                <figure className="group">
                  {/* Perspective stage: the laptop rests at a slight 3D tilt and
                      straightens + lifts on hover (motion-safe only). */}
                  <div className="[perspective:1000px]">
                    <div className="relative will-change-transform transition-transform duration-500 ease-out [transform-style:preserve-3d] [transform:rotateY(-7deg)_rotateX(3deg)] motion-safe:group-hover:[transform:rotateY(0deg)_rotateX(0deg)_translateY(-0.25rem)_scale(1.03)] motion-reduce:transition-none">
                      {/* Extruded right side wall (the tilted-away side), hero.tsx
                          "3D body" pattern: reads as solid depth, not a paper cutout. */}
                      <div
                        aria-hidden
                        className="pointer-events-none absolute right-0 top-1 bottom-3 w-[26px] rounded-sm"
                        style={{
                          transform: "rotateY(-90deg)",
                          transformOrigin: "right center",
                          background: "linear-gradient(to left, #2e2e31, #101012)",
                        }}
                      />
                      <div className="relative overflow-hidden rounded-chrome rounded-b-none border border-graphite/70 bg-coal ring-1 ring-white/5 transition-shadow duration-300 group-hover:ring-2 group-hover:ring-gold/60 group-hover:shadow-elev-3">
                        {/* Gold LIVE tag, top-left - echoes the reference's NEW tag. */}
                        <span className="chrome-meta absolute left-3 top-3 z-10 rounded-chrome bg-gold px-2 py-1 text-[0.625rem] text-gold-ink">
                          LIVE
                        </span>
                        <div className="relative aspect-[16/10] w-full overflow-hidden bg-obsidian" style={{ containerType: "inline-size" }}>
                          <DashboardSim start={2} />
                          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(115deg, rgba(255,255,255,0.06) 0%, transparent 30%)" }} />
                        </div>
                      </div>
                      {/* Laptop base */}
                      <div className="mx-auto h-3 w-[103%] -translate-x-[1.5%] rounded-b-[1.2rem] border border-t-0 border-graphite/70 bg-coal-2" />
                    </div>
                  </div>
                  <LabelChips name="DASHBOARD" tags={["DESKTOP"]} className="mt-4 justify-start" />
                  <figcaption className="chrome-meta mt-3 text-steel/80">Front desk · bookings, rooms, deposits</figcaption>
                </figure>
            </Reveal>
          </div>

          {/* Phone column - drifts down on scroll, sliding past the laptop */}
          <div data-work-col-b className="will-change-transform">
            <Reveal delay={120}>
                <figure className="group mx-auto w-[min(72vw,260px)]">
                  {/* Perspective stage: the phone rests at a slight 3D tilt and
                      straightens + lifts on hover (motion-safe only). */}
                  <div className="[perspective:1000px]">
                    <div className="relative will-change-transform transition-transform duration-500 ease-out [transform-style:preserve-3d] [transform:rotateY(9deg)_rotateX(2deg)] motion-safe:group-hover:[transform:rotateY(0deg)_rotateX(0deg)_translateY(-0.25rem)_scale(1.03)] motion-reduce:transition-none">
                      {/* Extruded left side wall (the tilted-away side), hero.tsx
                          "3D body" pattern: reads as solid depth, not a paper cutout. */}
                      <div
                        aria-hidden
                        className="pointer-events-none absolute left-0 top-6 bottom-6 w-[26px] rounded-sm"
                        style={{
                          transform: "rotateY(90deg)",
                          transformOrigin: "left center",
                          background: "linear-gradient(to right, #2e2e31, #101012)",
                        }}
                      />
                      <div className="relative overflow-hidden rounded-[2.2rem] border border-graphite/70 bg-coal p-[0.5rem] ring-1 ring-white/5 transition-shadow duration-300 group-hover:ring-2 group-hover:ring-gold/60 group-hover:shadow-elev-3">
                        {/* Notch */}
                        <div className="absolute left-1/2 top-[0.5rem] z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-coal" />
                        <div className="relative aspect-[9/19] w-full overflow-hidden rounded-[1.7rem] bg-obsidian" style={{ containerType: "inline-size" }}>
                          <MobileSim />
                          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(160deg, rgba(255,255,255,0.06) 0%, transparent 26%)" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                  <LabelChips name="MOBILE" tags={["iOS"]} className="mt-4 justify-center" />
                  <figcaption className="chrome-meta mt-3 text-center text-steel/80">On the move · the booking just landed</figcaption>
                </figure>
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}
