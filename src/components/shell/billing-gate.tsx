"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CreditCard, Hourglass, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { money } from "@/lib/format";

/* The studio-side billing enforcement:
   - a slim countdown banner while a trial is running / ending soon
   - a full-screen lock when the trial lapsed and a card is required
   Agency operators acting-as a studio are never gated (myBilling returns
   locked:false for them) so they can always step in and fix billing. */

function useAddCard() {
  const start = useAction(api.agencyBilling.startMyPaymentSetup);
  const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(async () => {
    setBusy(true);
    try {
      const r = await start({});
      if (r.simulated) {
        toast.success("Payment method recorded.");
      } else if (r.url) {
        window.location.href = r.url;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
    } finally {
      setBusy(false);
    }
  }, [start]);
  return { run, busy };
}

/** Slim banner: shows during a running trial (nudges harder in the last 3 days). */
export function BillingBanner() {
  const billing = useQuery(api.agencyBilling.myBilling);
  const { run, busy } = useAddCard();

  if (!billing || billing.locked) return null; // lock handled by the overlay
  if (billing.reason !== "trialing" && billing.reason !== "trial_ending" && billing.reason !== "past_due") {
    return null;
  }

  const days = billing.trialDaysLeft;
  const ending = billing.reason === "trial_ending";

  return (
    <div className={
      "flex flex-wrap items-center gap-3 border-b px-4 py-2 lg:px-6 " +
      (ending ? "border-gold-dim/40 bg-gold/[0.08]" : "border-graphite/50 bg-coal/40")
    }>
      <Hourglass className={"size-4 shrink-0 " + (ending ? "text-gold" : "text-steel")} />
      <p className="min-w-0 text-xs text-bone">
        {days === 0
          ? "Your free trial ends today."
          : `${days} day${days === 1 ? "" : "s"} left in your free trial.`}
        {billing.plan && billing.effectivePriceCents > 0 && (
          <span className="text-steel">
            {" "}Then {money(billing.effectivePriceCents)}/{billing.plan.billingInterval}.
          </span>
        )}
      </p>
      {!billing.paymentMethodOnFile && (
        <Button size="sm" variant={ending ? "primary" : "secondary"} className="ml-auto" disabled={busy} onClick={() => void run()}>
          <CreditCard className="size-3.5" /> Add payment method
        </Button>
      )}
    </div>
  );
}

/** Full-screen lock when the trial lapsed and a card is required. */
export function BillingLock() {
  const billing = useQuery(api.agencyBilling.myBilling);
  const { run, busy } = useAddCard();

  if (!billing || !billing.locked) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/95 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-graphite/60 bg-obsidian p-8 text-center shadow-2xl">
        <div className="mb-6 flex justify-center">
          <PulseLogo size="md" asLink={false} />
        </div>
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-critical/30 bg-critical/10 text-critical">
          <Lock className="size-5" />
        </span>
        <h2 className="font-grotesk text-xl font-semibold text-bone">Your free trial has ended</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-steel">
          Add a payment method to keep using {billing.name}.
          {billing.plan && billing.effectivePriceCents > 0 && (
            <> Your plan is {billing.plan.name} at {money(billing.effectivePriceCents)}/{billing.plan.billingInterval}.</>
          )}
        </p>
        <Button className="mt-6 w-full" disabled={busy} onClick={() => void run()}>
          <CreditCard className="size-4" /> {busy ? "Opening…" : "Add payment method"}
        </Button>
        <p className="mt-3 text-xs text-steel/70">
          Questions? Reach out to your agency and they can extend your trial or comp your account.
        </p>
      </div>
    </div>
  );
}
