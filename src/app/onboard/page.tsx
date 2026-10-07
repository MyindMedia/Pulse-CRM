"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import { PLAN_LIMITS, PUBLIC_TIERS, priceLabelFor, type TierKey } from "@convex/lib/plans";
import { ALLOWANCES, UNLIMITED, type BillingInterval } from "@convex/lib/pricing";

/** Short inclusions per tier. Numbers come from the pricing config, so a
 *  repricing or an allowance change never leaves this list stale. */
function tierBullets(tier: TierKey): string[] {
  const a = ALLOWANCES[tier];
  const rooms = a.rooms >= UNLIMITED ? "Unlimited rooms" : `${a.rooms} rooms`;
  const studios = a.studios >= UNLIMITED ? "Unlimited studios" : null;
  const lead =
    tier === "core"
      ? ["Booking page, deposits, card on file", "No-show rules and automatic bills", "Google Calendar both ways, your own Gmail"]
      : tier === "growth"
        ? ["Everything in Core, plus:", "Staff schedule, time clock, payroll", "The assistant, gear list and cable map"]
        : ["Everything in Growth, plus:", "Split sheets, releases, licensing", "Your brand on the whole app"];
  return [...lead, [rooms, studios, `${a.storageGb.toLocaleString("en-US")} GB`].filter(Boolean).join(" \u00b7 ")];
}

function OnboardInner() {
  const beginCheckout = useAction(api.billing.beginCheckout);
  const params = useSearchParams();
  const requested = params.get("tier");
  const initialTier: TierKey =
    requested && PUBLIC_TIERS.includes(requested as TierKey) ? (requested as TierKey) : "growth";
  const [tier, setTier] = React.useState<TierKey>(initialTier);
  const [interval, setBillingInterval] = React.useState<BillingInterval>(
    params.get("interval") === "year" ? "year" : "month",
  );
  const [agencyName, setAgencyName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function start() {
    setErr("");
    setLoading(true);
    try {
      const { checkoutUrl } = await beginCheckout({
        tier,
        interval,
        agencyName: agencyName || undefined,
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
        <p className="text-sm text-steel">Month to month. Cancel any time. A year costs ten months.</p>
        <div className="inline-flex rounded-full border border-graphite/60 p-1" role="group" aria-label="Billing period">
          {(["month", "year"] as const).map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={interval === i}
              onClick={() => setBillingInterval(i)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ${
                interval === i ? "bg-gold text-gold-ink" : "text-steel hover:text-bone"
              }`}
            >
              {i === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <p className="mt-1 font-meta text-sm text-gold">
                {priceLabelFor(key, interval)} / {interval === "year" ? "yr" : "mo"}
              </p>
              <p className="mt-2 text-xs text-steel">{limits.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-steel/70">
                {tierBullets(key).map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {(
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
        <button
          onClick={start}
          disabled={loading || !agencyName}
          className="rounded-md bg-gold px-6 py-3 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright disabled:opacity-50"
        >
          {loading ? "Starting checkout…" : "Continue to Stripe →"}
        </button>
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
