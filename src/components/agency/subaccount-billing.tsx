"use client";

import * as React from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { CreditCard, Gift, Hourglass, Lock, Wand2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BadgeProps } from "@/components/ui/badge";
import { money } from "@/lib/format";

const STATUS_TONE: Record<string, NonNullable<BadgeProps["tone"]>> = {
  trialing: "info",
  active: "positive",
  past_due: "critical",
  comped: "gold",
  canceled: "neutral",
};
const STATUS_LABEL: Record<string, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  comped: "Comped (free)",
  canceled: "Canceled",
};

/** Agency-side billing control for one sub-account: assign a plan, watch the
 *  trial countdown, comp it, extend, override the price, or send the owner an
 *  add-a-card link. */
export function SubaccountBilling({ orgId }: { orgId: string }) {
  const billing = useQuery(api.agencyBilling.subaccountBilling, { orgId });
  const plans = useQuery(api.agencyPlans.list, {});
  const assignPlan = useMutation(api.agencyBilling.assignPlan);
  const comp = useMutation(api.agencyBilling.comp);
  const extendTrial = useMutation(api.agencyBilling.extendTrial);
  const setPriceOverride = useMutation(api.agencyBilling.setPriceOverride);
  const markActive = useMutation(api.agencyBilling.markActiveManually);
  const startPaymentSetup = useAction(api.agencyBilling.startPaymentSetup);

  const [busy, setBusy] = React.useState<string | null>(null);
  const [override, setOverride] = React.useState("");

  React.useEffect(() => {
    if (billing?.priceCentsOverride != null) setOverride((billing.priceCentsOverride / 100).toString());
  }, [billing?.priceCentsOverride]);

  if (billing === undefined || plans === undefined) {
    return <div className="skeleton h-40 rounded-lg" />;
  }

  async function guard(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const activePlans = (plans ?? []).filter((p) => p.active);
  const status = billing.billingStatus;
  const trialLeft = billing.trialDaysLeft;

  return (
    <Card>
      <CardContent className="space-y-5 pt-5">
        {/* Status row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {status ? (
              <Badge tone={STATUS_TONE[status] ?? "neutral"} dot>
                {STATUS_LABEL[status] ?? status}
              </Badge>
            ) : (
              <Badge tone="neutral">No plan</Badge>
            )}
            {billing.plan && (
              <span className="text-sm text-bone">
                {billing.plan.name}
                <span className="text-steel">
                  {" · "}
                  {billing.effectivePriceCents === 0
                    ? "Free"
                    : `${money(billing.effectivePriceCents)}/${billing.plan.billingInterval}`}
                  {billing.priceCentsOverride != null && " (custom)"}
                </span>
              </span>
            )}
          </div>
          {billing.locked && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-critical">
              <Lock className="size-3.5" /> Studio locked - needs a card
            </span>
          )}
        </div>

        {/* Trial countdown */}
        {status === "trialing" && trialLeft != null && (
          <div className="flex items-center gap-2 rounded-md border border-info/30 bg-info/[0.07] px-3 py-2 text-sm text-bone">
            <Hourglass className="size-4 text-info" />
            {trialLeft === 0 ? "Trial ends today" : `${trialLeft} day${trialLeft === 1 ? "" : "s"} left in trial`}
            {!billing.paymentMethodOnFile && billing.plan?.requireCardAfterTrial && (
              <span className="text-steel">· card required to continue</span>
            )}
          </div>
        )}

        {/* Assign / change plan */}
        <Field label="Plan" hint="Assigning a plan starts its trial or promo window.">
          {activePlans.length === 0 ? (
            <p className="text-sm text-steel">
              No plans yet. Create them on the{" "}
              <Link href="/agency/plans" className="text-gold hover:underline">Plans</Link> page.
            </p>
          ) : (
            <Select
              value={billing.plan?._id ?? ""}
              onValueChange={(planId) =>
                void guard("assign", () => assignPlan({ orgId, planId: planId as never }), "Plan assigned.")
              }
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {activePlans.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name} · {p.priceCents === 0 ? "Free" : `${money(p.priceCents)}/${p.billingInterval}`}
                    {p.isPromo ? " · promo" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null}
            onClick={() =>
              void guard(
                "card",
                async () => {
                  const r = await startPaymentSetup({ orgId });
                  if (r.simulated) {
                    toast.success("Card marked on file (no Stripe in this environment).");
                  } else if (r.url) {
                    window.open(r.url, "_blank");
                  }
                },
              )
            }
          >
            <CreditCard className="size-3.5" /> Add payment method
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void guard("extend", () => extendTrial({ orgId, days: 14 }), "Trial extended 14 days.")}
          >
            <Hourglass className="size-3.5" /> Extend trial 14d
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null || status === "comped"}
            onClick={() =>
              void guard("comp", () => comp({ orgId, note: "Comped by agency" }), "Studio comped - free forever.")
            }
          >
            <Gift className="size-3.5" /> Comp (free)
          </Button>
          {!billing.paymentMethodOnFile && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void guard("manual", () => markActive({ orgId, onFile: true }), "Marked active.")}
            >
              <Wand2 className="size-3.5" /> Mark paid manually
            </Button>
          )}
        </div>

        {/* Price override */}
        <Field label="Custom price (this studio only)" hint="Overrides the plan price. Leave blank to use the plan's price.">
          <div className="flex items-center gap-2">
            <div className="relative w-40">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-steel">$</span>
              <Input
                value={override}
                onChange={(e) => setOverride(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="-"
                className="pl-7"
                inputMode="decimal"
              />
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() =>
                void guard(
                  "override",
                  () =>
                    setPriceOverride({
                      orgId,
                      priceCents: override.trim() === "" ? null : Math.round(parseFloat(override) * 100),
                    }),
                  "Price updated.",
                )
              }
            >
              Save
            </Button>
            {billing.priceCentsOverride != null && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  setOverride("");
                  void guard("clear", () => setPriceOverride({ orgId, priceCents: null }), "Custom price cleared.");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </Field>
      </CardContent>
    </Card>
  );
}
