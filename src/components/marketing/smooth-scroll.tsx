"use client";

import * as React from "react";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/* Lenis smooth/inertia scroll for the marketing site, synced to GSAP's
 * ScrollTrigger so scrubbed effects (heading reveals, parallax, the hero
 * monitor) stay glued to scroll progress rather than time. See
 * docs/redesign-motion-spec.md.
 *
 * Mounts once on the landing and returns null - Lenis hijacks the document
 * scroll, so it needs no provider/context wrapper. Fully disabled under
 * prefers-reduced-motion: we never construct Lenis, leaving native scroll. */
export function SmoothScroll() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    gsap.registerPlugin(ScrollTrigger);

    const lenis = new Lenis({
      // Gentle inertia, close to the reference's eased feel.
      lerp: 0.1,
      wheelMultiplier: 1,
      smoothWheel: true,
    });

    // Keep ScrollTrigger in lockstep with Lenis' virtual scroll.
    lenis.on("scroll", ScrollTrigger.update);

    // Drive Lenis from GSAP's ticker (one rAF for everything). Lenis wants ms.
    const onTick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(onTick);
      lenis.destroy();
    };
  }, []);

  return null;
}
