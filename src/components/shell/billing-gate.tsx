"use client";

import * as React from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CreditCard, Hourglass, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PulseLogo } from "@/components/brand/pulse-logo";
import { money } from "@/lib/format";
import {
  PLAN_LIMITS, SELLABLE_TIERS, ANNUAL_DISCOUNT_PCT,
  annualPriceCents, annualPerMonthCents,
} from "@convex/lib/plans";

/** The tiers a studio can actually buy from this screen. */
type SellableTier = "studio" | "pro" | "label";

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

  /* A beta studio that has run out its free year is a different conversation
     from a studio that owes a card. They were promised a year, the year is
     over, and the honest ask is "pick a plan" - not "add a payment method"
     against an agency plan that costs nothing. */
  if (billing.reason === "beta_expired") {
    return <BetaExpiredLock endedAt={billing.betaLicenseUntil} name={billing.name} />;
  }

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


/* The end of a beta year: choose a plan and carry on.

   Everything the studio built is still there - this is a gate, not a wipe -
   and the copy says so, because the first fear on seeing a lock screen is
   that the work is gone. */
function BetaExpiredLock({
  endedAt,
  name,
}: {
  endedAt: number | null;
  name: string;
}) {
  const subscribe = useAction(api.billing.beginCheckout);
  const [interval, setInterval] = React.useState<"month" | "year">("year");
  const [tier, setTier] = React.useState<SellableTier>("pro");
  const [busy, setBusy] = React.useState(false);

  async function go() {
    setBusy(true);
    try {
      const r = await subscribe({ tier, interval });
      if (r?.checkoutUrl) window.location.href = r.checkoutUrl;
      else toast.error("Stripe did not return a checkout link.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/95 px-4 py-10 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-graphite/60 bg-obsidian p-8 shadow-2xl">
        <div className="mb-6 flex justify-center">
          <PulseLogo size="md" asLink={false} />
        </div>
        <h2 className="text-center font-grotesk text-xl font-semibold text-bone">
          Your beta year has ended
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-center text-sm text-steel">
          {endedAt
            ? `${name} was free through ${new Date(endedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`
            : `${name} was on the free beta.`}{" "}
          Everything is exactly where you left it. Pick a plan and carry straight on.
        </p>

        {/* Yearly first: it is the better deal and the one worth defaulting to. */}
        <div className="mt-6 flex justify-center gap-1 rounded-full border border-graphite/60 p-1">
          {(["year", "month"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setInterval(v)}
              className={
                "rounded-full px-4 py-1.5 font-meta text-[0.65rem] uppercase tracking-[0.06em] transition-colors " +
                (interval === v ? "bg-gold text-gold-ink" : "text-steel hover:text-bone")
              }
            >
              {v === "year" ? `Yearly · save ${ANNUAL_DISCOUNT_PCT}%` : "Monthly"}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-2">
          {SELLABLE_TIERS.map((t) => {
            const chosen = t === tier;
            const perMonth =
              interval === "year" ? annualPerMonthCents(t) : PLAN_LIMITS[t].priceCents;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t as SellableTier)}
                className={
                  "flex w-full items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors " +
                  (chosen
                    ? "border-gold bg-gold/[0.08]"
                    : "border-graphite/50 bg-coal-2 hover:border-graphite")
                }
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-bone">
                    {PLAN_LIMITS[t].label}
                  </span>
                  <span className="mt-0.5 block text-xs text-steel">{PLAN_LIMITS[t].pitch}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-sm tabular-nums text-bone">
                    {money(perMonth)}
                    <span className="text-steel">/mo</span>
                  </span>
                  {interval === "year" && (
                    <span className="mt-0.5 block text-[0.65rem] text-gold">
                      {money(annualPriceCents(t))} billed yearly
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <Button className="mt-6 w-full" disabled={busy} onClick={() => void go()}>
          <CreditCard className="size-4" />
          {busy ? "Opening…" : `Continue on ${PLAN_LIMITS[tier].label}`}
        </Button>
        <p className="mt-3 text-center text-xs text-steel/70">
          Your studio, bookings and clients are untouched. Questions? Reply to any Pulse email
          and a human will answer.
        </p>
      </div>
    </div>
  );
}
