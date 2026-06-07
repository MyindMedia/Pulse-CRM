import Link from "next/link";
import { ArrowRight, CircleDollarSign, CalendarCheck, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Reveal } from "./reveal";

/** A purely decorative, CSS-built glass dashboard panel for the hero. No raster
 *  dependency, so it stays crisp at any size; a real screenshot can swap in
 *  later without touching layout. */
function HeroPreview() {
  return (
    <div className="relative mx-auto mt-14 w-full max-w-4xl">
      <div className="glass-strong overflow-hidden rounded-2xl border border-hairline-2 shadow-elev-4">
        {/* faux window bar */}
        <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
          <span className="size-2.5 rounded-full bg-coal-3" />
          <span className="size-2.5 rounded-full bg-coal-3" />
          <span className="size-2.5 rounded-full bg-coal-3" />
          <span className="ml-3 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ash-dim">
            pulse / dashboard
          </span>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-3">
          {[
            { icon: CircleDollarSign, label: "Collected this month", value: "$48,210", accent: true },
            { icon: CalendarCheck, label: "Sessions booked", value: "127" },
            { icon: Music2, label: "Records in flight", value: "34" },
          ].map((s) => (
            <div key={s.label} className="material-thin rounded-xl border border-hairline p-4">
              <s.icon className={s.accent ? "size-4 text-gold" : "size-4 text-ash-dim"} />
              <p className="mt-3 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-ash-dim">
                {s.label}
              </p>
              <p className="mt-1 font-display text-2xl font-bold text-bone">{s.value}</p>
            </div>
          ))}
        </div>

        {/* faux revenue bars */}
        <div className="px-5 pb-6">
          <div className="material-thin rounded-xl border border-hairline p-5">
            <p className="overline mb-4">Revenue, last 8 weeks</p>
            <div className="flex h-28 items-end gap-2 sm:gap-3">
              {[38, 52, 44, 67, 59, 78, 71, 92].map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-t-md"
                  style={{
                    height: `${h}%`,
                    background:
                      i === 7
                        ? "linear-gradient(to top, var(--color-gold-deep), var(--color-gold))"
                        : "var(--color-coal-3)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* soft gold glow under the panel */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-10 -bottom-10 -z-10 h-40 blur-3xl"
        style={{
          background:
            "radial-gradient(50% 80% at 50% 50%, rgba(253,185,19,0.12), transparent 70%)",
        }}
      />
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pb-20 pt-32 lg:px-8 lg:pt-40">
      <div className="app-bloom" aria-hidden />

      <div className="relative mx-auto max-w-5xl text-center">
        <Reveal immediate>
          <span className="inline-flex items-center gap-2 rounded-full border border-hairline-2 bg-coal/60 px-3 py-1 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-ash">
            <span className="size-1.5 rounded-full bg-gold" />
            The studio operating system
          </span>
        </Reveal>

        <Reveal delay={80} immediate>
          <h1 className="mx-auto mt-6 max-w-4xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-bone sm:text-6xl lg:text-7xl">
            The operating system for{" "}
            <span className="text-gold-gradient">music businesses</span>.
          </h1>
        </Reveal>

        <Reveal delay={160} immediate>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-ash">
            Pulse is the song-centric CRM for recording studios, producers and labels.
            Sessions, splits, revisions, releases: one unbroken chain from inquiry to royalty.
          </p>
        </Reveal>

        <Reveal delay={240} immediate>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Start free <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#features">See how it works</Link>
            </Button>
          </div>
          <p className="mt-4 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ash-dim">
            Built for studios, producers and labels
          </p>
        </Reveal>

        <Reveal delay={320} immediate>
          <HeroPreview />
        </Reveal>
      </div>
    </section>
  );
}
