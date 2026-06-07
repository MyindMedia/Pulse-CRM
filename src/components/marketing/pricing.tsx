import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";

/* Placeholder pricing. Edit the amounts and bullets here as the plans firm up;
   every CTA routes to self-serve sign-up. */
const TIERS = [
  {
    name: "Solo",
    price: "$29",
    cadence: "/mo",
    tagline: "For independent producers and engineers.",
    features: [
      "One studio room",
      "Song-centric catalog",
      "Bookings and deposits",
      "Invoices and payments",
      "Core reports",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Studio",
    price: "$79",
    cadence: "/mo",
    tagline: "For multi-room studios with a team.",
    features: [
      "Unlimited rooms",
      "Staff scheduling",
      "Splits and licensing",
      "Inventory and assets",
      "The AI Agent",
    ],
    cta: "Start free",
    featured: true,
  },
  {
    name: "Label",
    price: "$199",
    cadence: "/mo",
    tagline: "For labels and multi-studio operators.",
    features: [
      "Everything in Studio",
      "Multi-studio agency console",
      "Artist roster management",
      "Release campaigns",
      "Priority support",
    ],
    cta: "Talk to us",
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
            Simple plans that grow with you
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
                  "flex h-full flex-col rounded-2xl border p-7 transition-all duration-300 hover:-translate-y-1",
                  t.featured
                    ? "border-gold-dim bg-coal-2/70 shadow-gold-soft hover:shadow-gold-strong"
                    : "border-hairline bg-coal/40 hover:border-hairline-2 hover:shadow-elev-3",
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
                  {t.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-ash">
                      <Check className="mt-0.5 size-4 shrink-0 text-gold" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8 pt-2">
                  <Button
                    asChild
                    className="w-full"
                    variant={t.featured ? "primary" : "outline"}
                  >
                    <Link href="/sign-up">{t.cta}</Link>
                  </Button>
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
