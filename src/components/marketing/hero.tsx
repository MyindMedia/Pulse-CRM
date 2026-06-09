import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HlsVideo } from "./hls-video";
import { Reveal } from "./reveal";

/* Chrome-redesign hero: monolithic display type with a metallic fade fill over a
   desaturated studio montage, obsidian void background, a single gold accent and
   a mono metadata readout. Studio montage prompt: docs/seedance-bg-loop-prompt.md */
const STUDIO_MONTAGE_SRC = "/studio-montage.mp4";

const CAPABILITIES = [
  "Bookings", "Deposits", "Rooms", "Staff", "Scheduling",
  "Sessions", "Inventory", "Invoices", "Payments", "Automations",
];

/** Soft gold ellipse glow, center-top - the lone chromatic punctuation. */
function CenterGlow() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[-8%] -z-0 h-[55%] w-[120%] -translate-x-1/2 opacity-60"
      viewBox="0 0 1200 400"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <filter id="hero-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="25" />
        </filter>
      </defs>
      <ellipse cx="600" cy="150" rx="440" ry="120" fill="#fdb913" opacity="0.14" filter="url(#hero-glow)" />
      <ellipse cx="600" cy="150" rx="240" ry="70" fill="#ffd24a" opacity="0.12" filter="url(#hero-glow)" />
    </svg>
  );
}

export function Hero() {
  return (
    <section className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-obsidian px-4 pb-24 pt-28 lg:px-8">
      {/* Full-bleed studio montage, desaturated to read as chrome/fog. */}
      {STUDIO_MONTAGE_SRC && (
        <HlsVideo
          src={STUDIO_MONTAGE_SRC}
          className="absolute inset-0 -z-20 h-full w-full object-cover opacity-50 [filter:grayscale(1)_contrast(1.05)]"
        />
      )}

      {/* Readability scrim: chrome-to-void fade, darker at edges + bottom. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 95% at 50% 30%, rgba(22,22,22,0.35) 0%, rgba(22,22,22,0.82) 100%), linear-gradient(to bottom, rgba(22,22,22,0.92) 0%, rgba(22,22,22,0.6) 40%, rgba(22,22,22,0.85) 72%, #161616 100%)",
        }}
      />

      {/* Three thin vertical structure lines (desktop). */}
      <div aria-hidden className="grid-lines pointer-events-none absolute inset-0 -z-0 hidden lg:block" />

      <CenterGlow />

      {/* Content */}
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center text-center">
        <Reveal immediate>
          <p className="chrome-meta text-steel">The studio operating system · v1.0</p>
        </Reveal>

        <Reveal immediate delay={140}>
          <h1 className="chrome-display chrome-fill mt-6 text-[clamp(3.25rem,12vw,11rem)]">
            Run your whole
            <br />
            studio<span className="not-italic text-gold">.</span>
          </h1>
        </Reveal>

        <Reveal immediate delay={240}>
          <p className="font-grotesk mx-auto mt-7 max-w-[540px] text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist/85">
            Bookings, rooms, staff, inventory and payments, all in sync and
            automated, so the studio runs without the busywork.
          </p>
        </Reveal>

        <Reveal immediate delay={320}>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
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
        </Reveal>
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
