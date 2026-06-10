import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { SubscribeButton } from "./subscribe-button";
import { GhostWord } from "./ghost-word";

/* Pricing maps the marketing tiles to the billing tiers in convex/lib/plans.ts.
   `tier` is the TierKey used at checkout (/onboard?tier=...). Prices here must
   match PLAN_LIMITS[tier].priceCents. */
const TIERS = [
  {
    name: "Solo",
    tier: "studio",
    price: "$49",
    cadence: "/mo",
    tagline: "For independent producers and engineers.",
    features: [
      "One studio workspace",
      "Client and booking CRM",
      "Bookings and deposits",
      "Invoices and payments",
      "Core reports",
    ],
    cta: "Subscribe",
    featured: false,
  },
  {
    name: "Studio",
    tier: "pro",
    price: "$129",
    cadence: "/mo",
    tagline: "For multi-room studios with a team.",
    features: [
      "Unlimited rooms",
      "Staff scheduling",
      "Inventory and assets",
      "Automations and workflows",
      "The AI Agent (coming soon)",
    ],
    cta: "Subscribe",
    featured: true,
  },
  {
    name: "Label",
    tier: "growth",
    price: "$199",
    cadence: "/mo",
    tagline: "For labels and multi-studio operators.",
    features: [
      "Everything in Studio",
      "Up to 3 studio workspaces",
      "Multi-studio dashboard",
      "Cross-studio reporting",
      "Priority support",
    ],
    cta: "Subscribe",
    featured: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="relative overflow-hidden bg-bone px-4 py-28 text-obsidian lg:px-8">
      <GhostWord word="PRICING" className="text-obsidian/[0.05]" />
      <div className="relative z-10 mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="chrome-meta text-slate">Pricing</p>
          <h2 className="chrome-display chrome-fill-dark mt-4 text-4xl leading-[1.05] sm:text-5xl">
            Plans that <span className="not-italic text-gold-deep">grow</span> with the studio
          </h2>
          <p className="font-grotesk mt-5 text-[17px] font-medium leading-relaxed tracking-[-0.01em] text-slate">
            Every plan includes hosted booking pages, deposits to your own Stripe and
            free updates. No transaction fees on your client payments.
          </p>
        </Reveal>

        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-3">
          {TIERS.map((t, i) => (
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

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="chrome-display chrome-fill-dark text-5xl leading-[1.1]">{t.price}</span>
                  <span className="font-meta text-xs text-slate">{t.cadence}</span>
                </div>

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
                  <SubscribeButton
                    tier={t.tier as "studio" | "pro" | "growth"}
                    label={t.cta}
                    featured={t.featured}
                  />
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <p className="font-grotesk mt-8 text-center text-xs text-slate">
          Prices shown are introductory and may change. Questions? Reach the team from
          inside your account.
        </p>
      </div>
    </section>
  );
}
