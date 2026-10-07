"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Check, Infinity as InfinityIcon } from "@untitledui/icons";
import type { BillingInterval } from "@convex/lib/pricing";
import { SubscribeButton } from "@/components/marketing/subscribe-button";
import { cn } from "@/lib/utils";
import { DEMO_HREF, type PlanCard } from "./model";

/* The three price cards and the monthly / annual switch.

   Checkout buttons appear only where checkout will actually work:
   billing.checkoutAvailability says which tier + interval has a Stripe
   price id configured (booleans only, no id leaves the server). Until it
   answers, and wherever a price id is unset, the card falls back to
   "Book a demo", so nobody ever presses a button that errors. */

const INTERVALS: { key: BillingInterval; label: string }[] = [
  { key: "month", label: "Monthly" },
  { key: "year", label: "Annual" },
];

export function PricingPlans({ cards }: { cards: PlanCard[] }) {
  const [interval, setInterval] = React.useState<BillingInterval>("month");
  const availability = useQuery(api.billing.checkoutAvailability, {});
  const monthsFree = cards[0]?.annual.monthsFree ?? 0;

  return (
    <div>
      <div className="flex flex-col items-center gap-3">
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex rounded-chrome border border-hairline-2 bg-coal-2 p-1"
        >
          {INTERVALS.map((i) => {
            const on = interval === i.key;
            return (
              <button
                key={i.key}
                type="button"
                aria-pressed={on}
                onClick={() => setInterval(i.key)}
                className={cn(
                  "min-h-10 rounded-[10px] px-5 font-meta text-xs uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                  on ? "bg-gold text-gold-ink" : "text-mist hover:text-bone",
                )}
              >
                {i.label}
              </button>
            );
          })}
        </div>
        <p className="font-grotesk text-sm text-mist" aria-live="polite">
          {interval === "year"
            ? `Annual billing: ${monthsFree} months free on every plan.`
            : `Month to month. Switch to annual and get ${monthsFree} months free.`}
        </p>
      </div>

      <ul className="mt-10 grid items-stretch gap-5 lg:grid-cols-3">
        {cards.map((c) => {
          const price = interval === "year" ? c.annual.price : c.monthly.price;
          const canCheckout = Boolean(availability?.[c.tier]?.[interval]);
          return (
            <li
              key={c.tier}
              className={cn(
                "flex h-full flex-col rounded-chrome p-6 sm:p-7",
                c.highlight
                  ? "border-2 border-gold bg-coal shadow-gold-soft"
                  : "border border-hairline-2 bg-coal/80",
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-grotesk text-2xl font-semibold tracking-[-0.01em] text-bone">
                  {c.name}
                </h3>
                {c.highlight && (
                  <span className="chrome-meta rounded-chrome bg-gold px-2.5 py-1 text-gold-ink">
                    Most popular
                  </span>
                )}
                {c.unlimitedStudios && (
                  <span className="chrome-meta inline-flex items-center gap-1.5 rounded-chrome border border-gold/60 px-2.5 py-1 text-gold">
                    <InfinityIcon className="size-3.5" aria-hidden />
                    Unlimited studios
                  </span>
                )}
              </div>
              <p className="font-grotesk mt-2 text-sm text-mist">{c.tagline}</p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="chrome-display text-5xl text-bone">{price}</span>
                <span className="font-meta text-xs uppercase tracking-[0.06em] text-mist">
                  {interval === "year" ? "a year" : "a month"}
                </span>
              </p>
              <p className="font-grotesk mt-1.5 min-h-5 text-xs text-mist">
                {interval === "year"
                  ? `You save ${c.annual.saves} against paying monthly.`
                  : c.unlimitedStudios
                    ? "One flat price for every studio you run."
                    : "No contract. Cancel any month."}
              </p>
              {interval === "month" && c.launchOffer && (
                <p className="font-grotesk mt-2 text-xs text-gold">{c.launchOffer}</p>
              )}

              <p className="font-grotesk mt-5 text-sm leading-relaxed text-mist">{c.who}</p>

              {c.includesLabel && (
                <p className="chrome-meta mt-5 text-steel">{c.includesLabel}</p>
              )}
              <ul className={cn("space-y-2.5", c.includesLabel ? "mt-3" : "mt-5")}>
                {c.access.map((line) => (
                  <li key={line} className="font-grotesk flex items-start gap-2.5 text-sm text-bone">
                    <Check className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-col gap-2.5 pt-8">
                {canCheckout ? (
                  <>
                    <SubscribeButton
                      tier={c.tier}
                      interval={interval}
                      label={`Start with ${c.name}`}
                      featured={c.highlight}
                    />
                    <Link
                      href={DEMO_HREF}
                      className="rounded-chrome py-2 text-center font-grotesk text-sm text-mist underline-offset-4 transition-colors hover:text-gold hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                    >
                      Or book a demo first
                    </Link>
                  </>
                ) : (
                  <Link
                    href={DEMO_HREF}
                    className={cn(
                      "w-full rounded-chrome px-5 py-3 text-center font-grotesk text-sm font-semibold uppercase tracking-[0.04em] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
                      c.highlight
                        ? "bg-gold text-gold-ink hover:-translate-y-0.5 hover:bg-gold-bright"
                        : "chrome-ghost chrome-ghost-gold text-gold hover:text-gold-bright",
                    )}
                  >
                    Book a demo
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
