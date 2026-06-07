import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HeroVideo } from "./hero-video";
import { LiquidCard } from "./liquid-card";
import { Reveal } from "./reveal";

/** Large, soft gold ellipse glow for the center-top of the hero. 25px Gaussian
 *  blur, brand gold instead of the brief's cyan. */
function CenterGlow() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[-6%] -z-0 h-[55%] w-[120%] -translate-x-1/2 opacity-70"
      viewBox="0 0 1200 400"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <filter id="hero-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="25" />
        </filter>
      </defs>
      <ellipse cx="600" cy="150" rx="440" ry="120" fill="#fdb913" opacity="0.16" filter="url(#hero-glow)" />
      <ellipse cx="600" cy="150" rx="240" ry="70" fill="#ffd24a" opacity="0.14" filter="url(#hero-glow)" />
    </svg>
  );
}

export function Hero() {
  return (
    <section className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 pb-24 pt-28 lg:px-8">
      {/* Background video */}
      <HeroVideo className="absolute inset-0 -z-20 h-full w-full object-cover opacity-60" />

      {/* Readability overlays: left wash + bottom-up fade */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(to right, #08080a 0%, rgba(8,8,10,0.4) 38%, transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(to top, #08080a 4%, rgba(8,8,10,0.2) 40%, transparent 75%)",
        }}
      />

      {/* Center-top gold glow */}
      <CenterGlow />

      {/* Vertical structure lines (desktop only) */}
      <div aria-hidden className="grid-lines absolute inset-0 -z-0 hidden lg:block" />

      {/* Content */}
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
        <Reveal immediate>
          <LiquidCard />
        </Reveal>

        <Reveal immediate delay={80} className="-mt-2">
          <p className="font-jakarta text-[11px] font-bold uppercase tracking-[0.22em] text-gold">
            The studio operating system
          </p>
        </Reveal>

        <Reveal immediate delay={160}>
          <h1 className="mt-5 font-display text-[40px] font-extrabold uppercase leading-[0.98] tracking-tight text-bone sm:text-6xl lg:text-7xl">
            Run your whole studio<span className="text-gold">.</span>
          </h1>
        </Reveal>

        <Reveal immediate delay={240}>
          <p className="mx-auto mt-6 max-w-[512px] text-sm leading-relaxed text-bone/70">
            The song-centric CRM for recording studios, producers and labels.
            Sessions, splits, revisions, releases: one unbroken chain from inquiry
            to royalty.
          </p>
        </Reveal>

        <Reveal immediate delay={320}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="sheen group inline-flex items-center gap-2 rounded-full bg-gold px-7 py-3 text-sm font-bold uppercase tracking-wide text-gold-ink shadow-gold-soft transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-bright hover:shadow-gold-strong focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
            >
              Get started
              <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="#features"
              className="text-sm font-medium text-bone/80 underline-offset-4 transition-colors hover:text-gold hover:underline"
            >
              See how it works
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
