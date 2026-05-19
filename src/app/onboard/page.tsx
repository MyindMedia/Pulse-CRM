"use client";

import * as React from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";

const TIERS = [
  {
    key: "studio" as const,
    name: "Studio",
    price: "$49 / mo",
    subline: "Solo producer or single-room studio.",
    bullets: ["1 workspace", "All studio features", "5 magic-link grants / mo"],
  },
  {
    key: "pro" as const,
    name: "Pro",
    price: "$97 / mo",
    subline: "Two rooms, two brands, or a partner studio.",
    bullets: ["2 sub-accounts", "Basic agency console", "25 grants / mo", "Per-studio branding"],
  },
  {
    key: "agency" as const,
    name: "Agency",
    price: "$249 / mo",
    subline: "Studio groups + indie labels.",
    bullets: ["Unlimited sub-accounts", "Agency-level white-label", "Custom domain", "Unlimited grants"],
  },
];

export default function OnboardPage() {
  const beginCheckout = useAction(api.billing.beginCheckout);
  const [tier, setTier] = React.useState<"studio" | "pro" | "agency">("pro");
  const [agencyName, setAgencyName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState("");

  async function start() {
    setErr("");
    setLoading(true);
    try {
      const { checkoutUrl } = await beginCheckout({
        tier,
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

      <div className="grid gap-4 sm:grid-cols-3">
        {TIERS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTier(t.key)}
            className={`rounded-lg border p-5 text-left transition-colors ${
              tier === t.key
                ? "border-gold bg-gold/10"
                : "border-hairline bg-coal/40 hover:border-hairline-2"
            }`}
          >
            <p className="font-display text-lg font-semibold text-bone">{t.name}</p>
            <p className="mt-1 font-mono text-sm text-gold">{t.price}</p>
            <p className="mt-2 text-xs text-ash">{t.subline}</p>
            <ul className="mt-3 space-y-1 text-xs text-ash-dim">
              {t.bullets.map((b) => <li key={b}>• {b}</li>)}
            </ul>
          </button>
        ))}
      </div>

      {tier !== "studio" && (
        <label className="mx-auto block max-w-md space-y-1">
          <span className="text-sm text-bone">Your agency name</span>
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
        <button
          onClick={start}
          disabled={loading || (tier !== "studio" && !agencyName)}
          className="rounded-md bg-gold px-6 py-3 text-sm font-semibold text-gold-ink transition-colors hover:bg-gold-bright disabled:opacity-50"
        >
          {loading ? "Starting checkout…" : "Continue to Stripe →"}
        </button>
      </div>
    </main>
  );
}
