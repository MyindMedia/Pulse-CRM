import Link from "next/link";
import { ArrowRight } from "@untitledui/icons";
import { PRICING, TIERS, formatUsd } from "@convex/lib/pricing";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { GhostWord } from "./ghost-word";

/* The homepage pricing band: the three plans at a glance, read from
   convex/lib/pricing.ts, and the way through to /pricing (the full page with
   the annual switch, the comparison table and checkout) or a demo. */

export function Pricing() {
  return (
    <section id="pricing" className="relative overflow-hidden bg-bone px-4 py-24 text-obsidian lg:px-8">
      <GhostWord word="PRICING" className="text-obsidian/[0.05]" />
      <div className="relative z-10 mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="chrome-meta text-slate">Recording studio management software pricing</p>
          <h2 className="chrome-display chrome-fill-dark mt-4 text-4xl leading-[1.05] sm:text-5xl">
            Three plans, <span className="not-italic text-gold-deep">no contract</span>
          </h2>
          <p className="font-grotesk mt-5 text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-slate">
            Month to month, no per-seat fees, and card payments go to your own Stripe with no
            booking commission.
          </p>
        </Reveal>

        <ul className="mt-12 grid gap-5 md:grid-cols-3">
          {TIERS.map((t, i) => {
            const p = PRICING[t];
            return (
              <li key={t} className="h-full">
                <Reveal
                  delay={i * 90}
                  className={cn(
                    "flex h-full flex-col rounded-chrome bg-paper p-6",
                    p.highlight ? "border-2 border-gold-deep shadow-gold-soft" : "border border-graphite/20",
                  )}
                >
                  <h3 className="font-grotesk text-xl font-semibold text-obsidian">{p.name}</h3>
                  <p className="font-grotesk mt-1.5 text-sm text-slate">{p.tagline}</p>
                  <p className="mt-5 flex items-baseline gap-1.5">
                    <span className="chrome-display chrome-fill-dark text-5xl leading-[1.1]">
                      {formatUsd(p.monthlyCents)}
                    </span>
                    <span className="font-meta text-xs text-slate">a month</span>
                  </p>
                  {p.unlimitedStudios && (
                    <p className="font-grotesk mt-2 text-sm font-medium text-gold-deep">
                      Unlimited studios, one flat price
                    </p>
                  )}
                </Reveal>
              </li>
            );
          })}
        </ul>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/pricing"
            className="group inline-flex items-center gap-2 rounded-chrome bg-obsidian px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-bone transition-all hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-obsidian"
          >
            Compare plans
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center rounded-chrome border border-obsidian/40 px-7 py-3 font-grotesk text-sm font-semibold uppercase tracking-[0.04em] text-obsidian transition-colors hover:border-obsidian focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-obsidian"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}
