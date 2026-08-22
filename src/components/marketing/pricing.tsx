import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { SubscribeButton } from "./subscribe-button";
import { GhostWord } from "./ghost-word";
import { marketingTiers } from "./pricing-tiers";

/* The tiles are derived from PLAN_LIMITS in convex/lib/plans.ts - see
   pricing-tiers.ts for why nothing here is typed by hand any more. */

export function Pricing() {
  const tiers = marketingTiers();
  const offerOpen = tiers.some((t) => t.introBadge);
  return (
    <section id="pricing" className="relative overflow-hidden bg-bone px-4 py-28 text-obsidian lg:px-8">
      <GhostWord word="PRICING" className="text-obsidian/[0.05]" />
      <div className="relative z-10 mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="chrome-meta text-slate">Studio management software pricing</p>
          <h2 className="chrome-display chrome-fill-dark mt-4 text-4xl leading-[1.05] sm:text-5xl">
            Plans that <span className="not-italic text-gold-deep">grow</span> with the studio
          </h2>
          <p className="font-grotesk mt-5 text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-slate">
            Every plan includes hosted booking pages, deposits to your own Stripe and
            free updates. No transaction fees on your client payments.
          </p>
        </Reveal>

        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-3">
          {tiers.map((t, i) => (
            <Reveal key={t.name} delay={i * 90} className="h-full">
              <div
                className={cn(
                  "flex h-full flex-col rounded-chrome p-7 transition-all hover:-translate-y-1",
                  t.featured
                    ? "border-2 border-gold-deep bg-paper shadow-gold-soft"
                    : "border border-graphite/20 bg-paper hover:border-obsidian",
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-grotesk text-xl font-semibold tracking-[-0.01em] text-obsidian">{t.name}</h3>
                  {t.featured && (
                    <span className="chrome-meta rounded-chrome bg-gold px-2.5 py-1 text-gold-ink">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="font-grotesk mt-2 text-sm text-slate">{t.tagline}</p>

                {t.introBadge && (
                  <p className="chrome-meta mt-5 text-gold-deep">{t.introBadge}</p>
                )}

                <div className={cn("flex items-baseline gap-1", t.introBadge ? "mt-2" : "mt-6")}>
                  <span className="chrome-display chrome-fill-dark text-5xl leading-[1.1]">{t.price}</span>
                  <span className="font-meta text-xs text-slate">{t.cadence}</span>
                </div>

                {t.stepUp && (
                  <p className="font-grotesk mt-1.5 text-xs text-slate">{t.stepUp}</p>
                )}

                <ul className="mt-6 space-y-3">
                  {t.features.map((f) => {
                    const soon = f.includes("(coming soon)");
                    return (
                      <li
                        key={f}
                        className={cn(
                          "font-grotesk flex items-start gap-2.5 text-sm",
                          soon ? "text-slate/70" : "text-graphite",
                        )}
                      >
                        {soon ? (
                          <Clock className="mt-0.5 size-4 shrink-0 text-slate" />
                        ) : (
                          <Check className="mt-0.5 size-4 shrink-0 text-gold-deep" />
                        )}
                        <span>{f}</span>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-8 pt-2">
                  <SubscribeButton tier={t.tier} label={t.cta} featured={t.featured} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <p className="font-grotesk mt-8 text-center text-xs text-slate">
          {offerOpen
            ? "Launch pricing is monthly and applies to the first three months; the regular rate follows automatically. Yearly billing saves 15% instead. Cancel anytime."
            : "Yearly billing saves 15%. Cancel anytime."}{" "}
          Questions? Reach the team from inside your account.
        </p>
      </div>
    </section>
  );
}
