/**
 * LogoMarquee - dylanbrouwer-style slanted logo cards, adapted to the dark
 * Pulse chrome aesthetic. Server-component safe: no state, no effects.
 *
 * Mechanics mirror the hero capability ticker: the track is duplicated twice
 * (second copy aria-hidden) inside an `animate-marquee w-max` flex container,
 * wrapped in an overflow-hidden div with a mask-image edge fade. Hovering the
 * track pauses the animation; reduced-motion users get a static strip.
 */

const INTEGRATIONS = [
  "Stripe",
  "Google Calendar",
  "iCal",
  "Outlook",
  "OpenAI",
  "Gemini",
  "Clerk",
  "Convex",
];

export function LogoMarquee() {
  return (
    <section aria-label="Integrations" className="relative px-4 py-24 lg:px-8">
      {/* Heading */}
      <div className="mx-auto max-w-6xl">
        <p className="chrome-meta text-steel">Integrations</p>
        <p className="font-grotesk mt-3 max-w-prose text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-mist">
          Plays well with the tools studios already use.
        </p>
      </div>

      {/* Slanted-card marquee, edge-faded */}
      <div className="mt-12 overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_10%,#000_90%,transparent)]">
        <div className="animate-marquee flex w-max motion-reduce:[animation:none] [&:hover]:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <ul
              key={copy}
              className="flex shrink-0 items-center gap-6 px-3"
              aria-hidden={copy === 1}
            >
              {INTEGRATIONS.map((name) => (
                <li
                  key={name}
                  className="shrink-0 -skew-x-12 rounded-chrome border border-graphite/50 bg-coal px-10 py-6 transition-colors duration-200 hover:border-gold-dim/60"
                >
                  <span className="block skew-x-12 whitespace-nowrap font-grotesk text-lg font-semibold text-bone/80">
                    {name}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
