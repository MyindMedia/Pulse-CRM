"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

export default function OnboardDonePage() {
  const plan = useQuery(api.billing.myPlan, {});

  React.useEffect(() => {
    if (plan && (plan.status === "active" || plan.status === "trial")) {
      window.location.replace("/agency");
    }
  }, [plan]);

  return (
    <main className="mx-auto max-w-md space-y-4 p-12 text-center">
      <h1 className="font-display text-2xl font-semibold text-bone">Finishing setup…</h1>
      <p className="text-sm text-ash">
        We&apos;re confirming your subscription with Stripe. This usually takes a few seconds.
      </p>
      {plan ? (
        <p className="font-mono text-xs text-ash-dim">Plan: {plan.plan} · {plan.status}</p>
      ) : (
        <p className="font-mono text-xs text-ash-dim">Waiting for webhook…</p>
      )}
    </main>
  );
}
