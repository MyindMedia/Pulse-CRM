"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { PLAN_LIMITS, PUBLIC_TIERS, type TierKey } from "@convex/lib/plans";

const CONTACT_EMAIL = "hello@pulsestudio.app";

/** Short, hand-written inclusions per public tier (limits come from PLAN_LIMITS). */
const TIER_BULLETS: Record<Exclude<TierKey, "agency">, string[]> = {
  flow: [
    "No monthly fee, ever",
    "2% of what you collect through Pulse",
    "Booking page, deposits, card on file",
    "No-show shield + auto invoicing",
    "1 room \u00b7 2 seats \u00b7 5 GB",
  ],
  studio: [
    "Booking page, deposits, card on file",
    "No-show shield + auto waitlist",
    "Invoices with the 3/7/14 dunning ladder",
    "2 rooms \u00b7 3 seats \u00b7 10 GB",
  ],
  pro: [
    "Everything in Studio, plus:",
    "Staff schedule, time clock, payroll",
    "AI ops agent + SMS receptionist",
    "Reports, pipeline, inventory, packages",
    "6 rooms \u00b7 15 seats \u00b7 100 GB",
  ],
  label: [
    "Everything in Pro, plus:",
    "Full white-label UI: your logo, colors, fonts",
    "Custom domain + branded sign-in and email",
    "Releases, licensing, patch bay, split sheets",
    "Unlimited rooms and seats \u00b7 1 TB",
  ],
  growth: [
    "Legacy plan (superseded by Label)",
    "Up to 3 sub-accounts",
    "Custom domain + white-label",
    "2,000 AI credits \u00b7 250 GB storage",
  ],
  enterprise: [
    "Studio networks + schools",
    "Unlimited AI credits \u00b7 2 TB storage",
    "Full white-label + custom domain",
    "Dedicated onboarding & support",
  ],
};

function priceLabel(tier: TierKey): string {
  const limits = PLAN_LIMITS[tier];
  if (limits.custom || limits.priceCents === 0) return "Custom";
  return `$${Math.round(limits.priceCents / 100)} / mo`;
}

type SelfServeTier = "studio" | "pro" | "growth";

function OnboardInner() {
  const beginCheckout = useAction(api.billing.beginCheckout);
  const params = useSearchParams();
  const requested = params.get("tier");
  const initialTier: TierKey =
    requested && PUBLIC_TIERS.includes(requested as TierKey) ? (requested as TierKey) : "pro";
  const [tier, setTier] = React.useState<TierKey>(initialTier);
  const [agencyName, setAgencyName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  const isEnterprise = tier === "enterprise";

  async function start() {
    if (isEnterprise) return;
    setErr("");
    setLoading(true);
    try {
      const { checkoutUrl } = await beginCheckout({
        tier: tier as SelfServeTier,
        agencyName: tier === "studio" ? undefined : agencyName || undefined,
      });
      if (checkoutUrl) window.location.href = checkoutUrl;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start checkout.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <header className="space-y-2 text-center">
        <h1 className="font-grotesk text-3xl font-semibold text-bone">Pick your plan</h1>
        <p className="text-sm text-steel">Billed monthly. Cancel any time.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* The single biggest documented reason studios do not switch is
            setup pain. Answering it next to the price is the whole point. */}
        <p className="mb-5 rounded-lg border border-gold/25 bg-gold/8 px-4 py-3 text-xs leading-relaxed text-steel">
          <span className="font-semibold text-bone">Free white-glove migration, live in a day.</span>{" "}
          Send your clients, rooms and rates in whatever shape they are in. If you are not
          taking bookings within twenty-four hours, your first month is on us.
        </p>
        {PUBLIC_TIERS.map((key) => {
          const limits = PLAN_LIMITS[key];
          const selected = tier === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTier(key)}
              className={`flex flex-col rounded-lg border p-5 text-left transition-colors ${
                selected
                  ? "border-gold bg-gold/10"
                  : "border-graphite/50 bg-coal/40 hover:border-graphite/60"
              }`}
            >
              <p className="font-grotesk text-lg font-semibold text-bone">{limits.label}</p>
              <p className="mt-1 font-meta text-sm text-gold">{priceLabel(key)}</p>
              <p className="mt-2 text-xs text-steel">{limits.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-steel/70">
                {TIER_BULLETS[key as Exclude<TierKey, "agency">].map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {!isEnterprise && tier !== "studio" && (
        <label className="mx-auto block max-w-md space-y-1">
          <span className="text-sm text-bone">Your studio or group name</span>
          <input
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
            placeholder="Acme Music Group"
            className="w-full rounded border border-graphite/60 bg-obsidian px-3 py-2 text-sm text-bone"
          />
        </label>
      )}

      {err && <p className="text-center text-sm text-critical">{err}</p>}

      <div className="text-center">
        {isEnterprise ? (
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("Pulse Enterprise enquiry")}`}
            className="inline-block rounded-md bg-gold px-6 py-3 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright"
          >
            Contact us →
          </a>
        ) : (
          <button
            onClick={start}
            disabled={loading || (tier !== "studio" && !agencyName)}
            className="rounded-md bg-gold px-6 py-3 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright disabled:opacity-50"
          >
            {loading ? "Starting checkout…" : "Continue to Stripe →"}
          </button>
        )}
      </div>
    </main>
  );
}

export default function OnboardPage() {
  return (
    <React.Suspense fallback={null}>
      <OnboardInner />
    </React.Suspense>
  );
}
