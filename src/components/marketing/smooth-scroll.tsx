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

    // Every load starts at the absolute top: the hero's scroll choreography
    // must always begin from its first frame, never a restored mid-pin
    // position. A single scrollTo loses the race against the browser's
    // ASYNC scroll restoration (and Safari's bfcache restore), so re-assert
    // the top across the first frames and on pageshow.
    window.history.scrollRestoration = "manual";
    const toTop = () => window.scrollTo(0, 0);
    toTop();
    const raf1 = requestAnimationFrame(toTop);
    const t1 = window.setTimeout(toTop, 60);
    const t2 = window.setTimeout(toTop, 200);
    window.addEventListener("pageshow", toTop);
    const cleanupTop = () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("pageshow", toTop);
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return cleanupTop;

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

    // Keep Lenis' scroll limit in sync with the real page height: pin spacers
    // (hero) and late-loading images change the document height after init,
    // and a stale limit makes the bottom of the page unreachable by wheel.
    const onRefresh = () => lenis.resize();
    ScrollTrigger.addEventListener("refresh", onRefresh);
    const lateRefresh = window.setTimeout(() => ScrollTrigger.refresh(), 600);
    window.addEventListener("load", onRefresh);

    // Lenis keeps its own scroll position - pin it to the top too.
    lenis.scrollTo(0, { immediate: true });

    return () => {
      cleanupTop();
      window.clearTimeout(lateRefresh);
      window.removeEventListener("load", onRefresh);
      ScrollTrigger.removeEventListener("refresh", onRefresh);
      gsap.ticker.remove(onTick);
      lenis.destroy();
    };
  }, []);

  return null;
}
