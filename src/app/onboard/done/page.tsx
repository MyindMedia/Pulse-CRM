"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { CheckCircle2 } from "lucide-react";
import { PulseLogo } from "@/components/brand/pulse-logo";

export default function OnboardDonePage() {
  const plan = useQuery(api.billing.myPlan, {});
  const active = plan?.status === "active" || plan?.status === "trial";

  React.useEffect(() => {
    if (active) {
      const t = setTimeout(() => window.location.replace("/agency"), 1200);
      return () => clearTimeout(t);
    }
  }, [active]);

  return (
    <div className="relative grid min-h-dvh place-items-center bg-ink p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 30%, rgba(253,185,19,0.1), transparent 70%)",
        }}
      />
      <div className="relative flex w-full max-w-md flex-col items-center gap-6 text-center">
        <PulseLogo size="lg" asLink={false} />

        {active ? (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 className="size-10 text-positive" />
            <h1 className="font-display text-2xl font-bold text-bone">You&apos;re all set</h1>
            <p className="text-sm text-ash">
              Subscription confirmed. Taking you to your studio…
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <span className="logo-breathe text-3xl text-gold">●</span>
            <h1 className="font-display text-2xl font-bold text-bone">Finishing setup</h1>
            <p className="text-sm text-ash">
              Confirming your subscription with Stripe. This usually takes a few seconds.
            </p>
          </div>
        )}

        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-ash-dim">
          {plan ? `${plan.plan} · ${plan.status}` : "Waiting for Stripe…"}
        </p>
      </div>
    </div>
  );
}
