"use client";

import * as React from "react";
import { useReducedMotion } from "motion/react";

/* The hero monitor's screen: real captures of the Pulse app (the hardware UI
 * on the demo studio's data) cross-fading Overview, Bookings, Invoices and
 * Calendar. Only the overview is in the server HTML, so the hero entrance -
 * which waits for every [data-hero-stage] img to decode - waits for that one
 * frame; the others mount after the window load event. Reduced motion keeps
 * the overview, still. Captured at 1440x830 (the screen's 1.734:1 aspect) at
 * 2x, then 1600w and 800w WebP with a JPEG fallback in public/hero/. */
const SCREENS = ["overview", "bookings", "invoices", "calendar"] as const;
const SCREEN_MS = 4200;
// The overview holds longer at first: the site reveal and the monitor's
// entrance take ~3.5s after load, and it is the screen the hero is built on.
const FIRST_MS = 7000;

/* The monitor is min(90vw, 880px, 115vh) wide and the screen fills ~98% of
 * it, so desktop asks for ~860px and phones for the viewport. */
export const HERO_SCREEN_SIZES = "(min-width: 960px) 860px, 90vw";
export const heroScreenSrcSet = (name: string) => `/hero/${name}-800.webp 800w, /hero/${name}.webp 1600w`;

export function HeroScreens() {
  const reduce = useReducedMotion();
  const [loaded, setLoaded] = React.useState(false);
  // Counts every swap; the active screen is step % length. Step 0 is the
  // server-rendered overview, which never replays the fade.
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (reduce) return;
    const go = () => setLoaded(true);
    if (document.readyState === "complete") {
      go();
      return;
    }
    window.addEventListener("load", go, { once: true });
    return () => window.removeEventListener("load", go);
  }, [reduce]);

  React.useEffect(() => {
    if (!loaded) return;
    let id: number | undefined;
    const first = window.setTimeout(() => {
      setStep((s) => s + 1);
      id = window.setInterval(() => setStep((s) => s + 1), SCREEN_MS);
    }, FIRST_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [loaded]);

  const active = step % SCREENS.length;
  const prev = (step + SCREENS.length - 1) % SCREENS.length;

  return (
    <div
      role="img"
      aria-label="The Pulse app: studio overview, bookings board, invoices and splits, and the calendar"
      className="absolute inset-0 select-none bg-obsidian"
    >
      {SCREENS.map((name, i) => {
        if (i > 0 && !loaded) return null;
        // The previous screen stays opaque underneath while the active one
        // fades in on top with a CSS keyframe, which cannot strand the screen
        // invisible the way a stalled JS opacity tween can.
        const layer =
          i === active
            ? step > 0
              ? "z-[2] motion-safe:animate-screen-in"
              : "z-[2]"
            : i === prev && step > 0
              ? "z-[1]"
              : "opacity-0";
        return (
          <picture key={name} style={{ display: "contents" }}>
            <source type="image/webp" srcSet={heroScreenSrcSet(name)} sizes={HERO_SCREEN_SIZES} />
            <img
              src={`/hero/${name}.jpg`}
              alt=""
              width={1600}
              height={922}
              decoding="async"
              fetchPriority={i === 0 ? "high" : "low"}
              draggable={false}
              className={`absolute inset-0 h-full w-full object-cover object-top ${layer}`}
            />
          </picture>
        );
      })}
    </div>
  );
}
