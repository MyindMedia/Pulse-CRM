"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { PLAN_LIMITS, PUBLIC_TIERS, type TierKey } from "@convex/lib/plans";

const CONTACT_EMAIL = "hello@pulsestudio.app";

/** Short, hand-written inclusions per public tier (limits come from PLAN_LIMITS). */
const TIER_BULLETS: Record<Exclude<TierKey, "agency">, string[]> = {
  studio: [
    "1 studio workspace",
    "5 magic-link client grants / mo",
    "100 AI credits · 5 GB storage",
    "Booking, sessions, invoicing",
  ],
  pro: [
    "Studio-level white-label",
    "25 magic-link grants / mo",
    "500 AI credits · 50 GB storage",
    "Repeat-client tools + AI agents",
  ],
  growth: [
    "Up to 3 sub-accounts",
    "Custom domain + white-label",
    "2,000 AI credits · 250 GB storage",
    "100 magic-link grants / mo",
  ],
  enterprise: [
    "Studio networks + schools",
    "Unlimited AI credits · 2 TB storage",
    "Agency-level white-label + domain",
    "Dedicated onboarding & support",
  ],
};

function priceLabel(tier: TierKey): string {
  const limits = PLAN_LIMITS[tier];
  if (limits.custom || limits.priceCents === 0) return "Custom";
  return `$${Math.round(limits.priceCents / 100)} / mo`;
}

type SelfServeTier = "studio" | "pro" | "growth";

export default function OnboardPage() {
  const beginCheckout = useAction(api.billing.beginCheckout);
  const [tier, setTier] = React.useState<TierKey>("pro");
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
        <h1 className="font-display text-3xl font-semibold text-bone">Pick your plan</h1>
        <p className="text-sm text-ash">14-day free trial. Cancel any time.</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                  : "border-hairline bg-coal/40 hover:border-hairline-2"
              }`}
            >
              <p className="font-display text-lg font-semibold text-bone">{limits.label}</p>
              <p className="mt-1 font-mono text-sm text-gold">{priceLabel(key)}</p>
              <p className="mt-2 text-xs text-ash">{limits.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-ash-dim">
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
            className="w-full rounded border border-hairline-2 bg-ink-2 px-3 py-2 text-sm text-bone"
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
