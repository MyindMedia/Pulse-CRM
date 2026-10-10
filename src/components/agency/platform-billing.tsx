"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { AlertTriangle, CreditCard, ExternalLink } from "lucide-react";
import { Section } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* The agency owner's own Pulse subscription (Core / Growth / Max): plan,
   status and the way into Stripe's billing portal (card, invoices, plan
   change, cancel). The banner shows on every agency page while a payment
   needs attention. Only the owner sees either: billing.myPlan reads by owner. */

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trial: "Free trial",
  past_due: "Payment failed",
  paused: "Paused",
};

function useOpenPortal() {
  const open = useAction(api.billing.openCustomerPortal);
  const [busy, setBusy] = React.useState(false);
  const go = React.useCallback(async () => {
    setBusy(true);
    try {
      const { portalUrl } = await open({});
      window.location.assign(portalUrl);
    } catch {
      toast.error("Could not open the billing portal. Try again in a moment.");
      setBusy(false);
    }
  }, [open]);
  return { go, busy };
}

export function PlatformBillingBanner() {
  const plan = useQuery(api.billing.myPlan);
  const { go, busy } = useOpenPortal();
  if (!plan?.hasBillingAccount) return null;

  if (plan.paymentActionUrl && plan.status !== "paused") {
    return (
      <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-caution/40 bg-caution/10 px-4 py-3 text-sm text-bone">
        <AlertTriangle className="size-4 shrink-0 text-caution" aria-hidden />
        <span className="flex-1">Your bank needs you to confirm the latest Pulse payment.</span>
        <a href={plan.paymentActionUrl} className="font-semibold text-gold underline-offset-4 hover:underline">
          Confirm payment
        </a>
      </div>
    );
  }
  if (plan.status === "past_due" || plan.status === "paused") {
    const paused = plan.status === "paused";
    return (
      <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-critical/40 bg-critical/10 px-4 py-3 text-sm text-bone">
        <AlertTriangle className="size-4 shrink-0 text-critical" aria-hidden />
        <span className="flex-1">
          {paused
            ? "Your Pulse plan has ended, so your studios are paused. Your data is safe. Subscribe again to turn them back on."
            : "Your last Pulse payment failed. Stripe will try again; update your card so your studios stay on."}
        </span>
        {paused ? (
          <Link href="/pricing" className="font-semibold text-gold underline-offset-4 hover:underline">See plans</Link>
        ) : (
          <button type="button" onClick={() => void go()} disabled={busy} className="font-semibold text-gold underline-offset-4 hover:underline disabled:opacity-60">
            {busy ? "Opening…" : "Update card"}
          </button>
        )}
      </div>
    );
  }
  return null;
}

export function PlatformBillingCard() {
  const plan = useQuery(api.billing.myPlan);
  const { go, busy } = useOpenPortal();
  if (!plan?.hasBillingAccount) return null;
  const tone = plan.status === "past_due" || plan.status === "paused" ? "critical" : "gold";
  return (
    <div id="billing" className="scroll-mt-24">
      <Section title="Your Pulse plan">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 pt-5">
            <span className="grid size-10 place-items-center rounded-lg bg-gold/10 text-gold">
              <CreditCard className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-grotesk text-base font-semibold capitalize text-bone">{plan.plan}</p>
              <Badge tone={tone}>{STATUS_LABEL[plan.status] ?? plan.status}</Badge>
            </div>
            <Button onClick={() => void go()} disabled={busy}>
              <ExternalLink className="size-4" aria-hidden />
              {busy ? "Opening…" : "Manage billing"}
            </Button>
          </CardContent>
          <p className="px-6 pb-5 text-xs text-steel">
            Update your card, see invoices, change plan or cancel. Upgrades apply right away and are prorated; downgrades take effect at the end of the billing period.
          </p>
        </Card>
      </Section>
    </div>
  );
}
