import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HlsVideo } from "./hls-video";
import { Reveal } from "./reveal";

/* Full-bleed studio montage that backs the HERO section only. Scrolling past the
   hero reveals the global gold loop (SiteBackdrop) behind the rest of the site.
   Empty string => the gold loop shows through the hero too.
   Prompt: docs/seedance-bg-loop-prompt.md (hero studio montage). */
const STUDIO_MONTAGE_SRC = "/studio-montage.mp4";

const CAPABILITIES = [
  "Bookings",
  "Deposits",
  "Rooms",
  "Staff",
  "Scheduling",
  "Sessions",
  "Inventory",
  "Invoices",
  "Payments",
  "Automations",
];

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
      {/* Hero background: full-bleed studio montage (covers the global gold loop
          within the hero only). Falls back to the gold loop when no src. */}
      {STUDIO_MONTAGE_SRC && (
        <HlsVideo
          src={STUDIO_MONTAGE_SRC}
          className="absolute inset-0 -z-20 h-full w-full object-cover"
        />
      )}

      {/* Readability scrim over the footage: darkened edges + a darker top and
          bottom so the nav, headline and marquee stay legible, fading to ink at
          the very bottom to meet the gold-loop sections below. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 95% at 50% 32%, rgba(8,8,10,0.45) 0%, rgba(8,8,10,0.78) 100%), linear-gradient(to bottom, rgba(8,8,10,0.9) 0%, rgba(8,8,10,0.66) 38%, rgba(8,8,10,0.8) 68%, #08080a 100%)",
        }}
      />

      {/* Center-top gold glow */}
      <CenterGlow />

      {/* Content */}
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
        <Reveal immediate>
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
            The operating system for recording studios. Bookings, rooms, staff,
            inventory and payments, all in sync and automated, so the studio runs
            without the busywork.
          </p>
        </Reveal>

        <Reveal immediate delay={320}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="#pricing"
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

      {/* Capability ticker - a slow marquee of what Pulse runs, edge-faded. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_14%,#000_86%,transparent)]">
        <div className="animate-marquee flex w-max">
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
              {CAPABILITIES.map((c) => (
                <li
                  key={c}
                  className="flex items-center gap-7 px-7 font-mono text-[0.6875rem] uppercase tracking-[0.22em] text-ash-dim"
                >
                  <span className="size-1 rounded-full bg-gold-dim" />
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
