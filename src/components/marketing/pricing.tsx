import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { SubscribeButton } from "./subscribe-button";

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
    <section id="pricing" className="relative px-4 py-24 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="overline">Pricing</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-bone sm:text-4xl">
            Simple plans that{" "}
            <span className="font-serif text-[1.15em] font-normal italic text-gold">grow</span>{" "}
            with you
          </h2>
          <p className="mt-4 text-ash">
            Every plan includes hosted booking pages, deposits to your own Stripe and
            free updates. No transaction fees on your client payments.
          </p>
        </Reveal>

        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-3">
          {TIERS.map((t, i) => (
            <Reveal key={t.name} delay={i * 90} className="h-full">
              <div
                className={cn(
                  "hover-glow flex h-full flex-col rounded-2xl p-7 hover:-translate-y-1",
                  t.featured
                    ? "liquid-frame bg-coal-2/70 shadow-gold-soft hover:shadow-gold-strong"
                    : "border border-hairline bg-coal/40 hover:border-gold-dim",
                )}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl font-bold text-bone">{t.name}</h3>
                  {t.featured && (
                    <span className="rounded-full bg-gold px-2.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-gold-ink">
                      Most popular
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-ash">{t.tagline}</p>

                <div className="mt-6 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold text-bone">{t.price}</span>
                  <span className="text-sm text-ash-dim">{t.cadence}</span>
                </div>

                <ul className="mt-6 space-y-3">
                  {t.features.map((f) => {
                    const soon = f.includes("(coming soon)");
                    return (
                      <li
                        key={f}
                        className={cn(
                          "flex items-start gap-2.5 text-sm",
                          soon ? "text-ash-dim" : "text-ash",
                        )}
                      >
                        {soon ? (
                          <Clock className="mt-0.5 size-4 shrink-0 text-ash-dim" />
                        ) : (
                          <Check className="mt-0.5 size-4 shrink-0 text-gold" />
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

        <p className="mt-8 text-center text-xs text-ash-dim">
          Prices shown are introductory and may change. Questions? Reach the team from
          inside your account.
        </p>
      </div>
    </section>
  );
}
