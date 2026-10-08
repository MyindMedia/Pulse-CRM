"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CreditCard, Settings2 } from "lucide-react";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { Button } from "@/components/ui/button";
import { BetaPlanPicker } from "@/components/shell/billing-gate";
import { money } from "@/lib/format";
import { TRIAL_TERMS } from "@convex/lib/pricing";

/* /billing - the studio's own billing page, outside the app shell so a locked
   studio can always reach it. Every billing email links here (beta reminders,
   "trial ends in 3 days", "add a card before your trial ends"), because a
   Stripe Checkout link expires within a day and a reminder must not.

   It shows one action, chosen by state:
   - subscribed in Stripe   -> manage or cancel in the Stripe portal
   - on the beta            -> add a card and pick Core, Growth or Max
   - paid plan, card saved, no subscription -> confirm the plan (charged then)
   - anything owing a card  -> add a card (starts the trial, or the plan)
*/

function longDate(at: number): string {
  return new Date(at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export default function BillingPage() {
  const billing = useQuery(api.agencyBilling.myBilling);
  const addCard = useAction(api.agencyBilling.startMyPaymentSetup);
  const portal = useAction(api.agencyBilling.openMyBillingPortal);
  const [busy, setBusy] = React.useState(false);

  async function go(fn: () => Promise<{ url: string | null; simulated?: boolean }>) {
    setBusy(true);
    try {
      const r = await fn();
      if (r.url) window.location.href = r.url;
      else if (r.simulated) toast.success("Card recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open billing.");
    } finally {
      setBusy(false);
    }
  }

  const beta = Boolean(billing && ((billing.betaCohort && !billing.graduatedAt) || billing.plan?.isBeta));
  const live =
    billing?.subscribed &&
    (billing.billingStatus === "trialing" || billing.billingStatus === "active" || billing.billingStatus === "past_due");

  let body: React.ReactNode;
  if (billing === undefined) {
    body = <p className="text-center text-sm text-steel">Loading your billing…</p>;
  } else if (billing === null) {
    body = <p className="text-center text-sm text-steel">Sign in to your studio to see its billing.</p>;
  } else if (live) {
    body = (
      <>
        <h1 className="text-center font-grotesk text-xl font-semibold text-bone">Your plan</h1>
        <p className="mx-auto mt-2 max-w-sm text-center text-sm text-steel">
          {billing.billingStatus === "trialing" && billing.trialEndsAt
            ? `Your card is first charged on ${longDate(billing.trialEndsAt)}, then the plan renews automatically. ${TRIAL_TERMS.cancel}`
            : billing.billingStatus === "past_due"
              ? "Your last payment did not go through. Update your card to keep going."
              : "You are subscribed. Update your card, see invoices or cancel in the billing portal."}
        </p>
        <Button className="mt-6 w-full" disabled={busy} onClick={() => void go(() => portal({}))}>
          <Settings2 className="size-4" /> {busy ? "Opening…" : "Manage or cancel"}
        </Button>
      </>
    );
  } else if (beta) {
    body = (
      <>
        <h1 className="text-center font-grotesk text-xl font-semibold text-bone">After the beta</h1>
        <p className="mx-auto mb-6 mt-2 max-w-sm text-center text-sm text-steel">
          {TRIAL_TERMS.beta}
          {billing.betaLicenseUntil ? ` Your beta ends on ${longDate(billing.betaLicenseUntil)}.` : ""}
        </p>
        <BetaPlanPicker />
      </>
    );
  } else if (billing.needsPlanConfirmation) {
    const price =
      billing.plan && billing.effectivePriceCents > 0
        ? `${money(billing.effectivePriceCents)}/${billing.plan.billingInterval}`
        : null;
    body = (
      <>
        <h1 className="text-center font-grotesk text-xl font-semibold text-bone">Confirm your plan</h1>
        <p className="mx-auto mt-2 max-w-sm text-center text-sm text-steel">
          {billing.plan ? `You are on ${billing.plan.name}${price ? ` at ${price}` : ""}. ` : ""}
          A card was saved, but billing for the plan was never switched on, so it has not been charged.
          Confirm to start it: your card is charged today, then the plan renews automatically. Cancel any time.
        </p>
        <Button className="mt-6 w-full" disabled={busy} onClick={() => void go(() => addCard({}))}>
          <CreditCard className="size-4" /> {busy ? "Opening…" : "Confirm my plan"}
        </Button>
      </>
    );
  } else {
    const price =
      billing.plan && billing.effectivePriceCents > 0
        ? `${money(billing.effectivePriceCents)}/${billing.plan.billingInterval}`
        : null;
    // A paid plan with no trial is charged when Checkout completes.
    const noTrial = billing.reason === "trial_needs_card" && (billing.plan?.trialDays ?? 0) === 0;
    body = (
      <>
        <h1 className="text-center font-grotesk text-xl font-semibold text-bone">
          {noTrial ? "Start your plan" : billing.reason === "trial_needs_card" ? "Start your free trial" : "Add a card"}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-center text-sm text-steel">
          {noTrial
            ? "Add a card to start your plan. You are charged when you confirm, then it renews automatically. Cancel any time."
            : `${TRIAL_TERMS.cardRequired} ${TRIAL_TERMS.autoRenew} ${TRIAL_TERMS.cancel}`}
          {billing.trialEndsAt && billing.reason !== "trial_needs_card"
            ? ` Your trial ends on ${longDate(billing.trialEndsAt)}.`
            : ""}
          {price && billing.plan ? ` ${billing.plan.name}: ${price}.` : ""}
        </p>
        <Button className="mt-6 w-full" disabled={busy} onClick={() => void go(() => addCard({}))}>
          <CreditCard className="size-4" /> {busy ? "Opening…" : "Add a card"}
        </Button>
      </>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-ink px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-graphite/60 bg-obsidian p-8 shadow-2xl">
        <div className="mb-6 flex justify-center">
          <PulseLogo size="md" asLink={false} />
        </div>
        {body}
        <p className="mt-6 text-center text-xs text-steel/70">
          <Link href="/dashboard" className="hover:text-bone">Back to Pulse</Link>
        </p>
      </div>
    </div>
  );
}
