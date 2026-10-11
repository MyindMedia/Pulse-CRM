"use client";

import * as React from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, CreditCard, Gauge, Info, LayoutList } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import { PLAN_TIERS, type Org, type OrgPlan } from "@/components/settings/types";

/** A single usage row with a progress bar. */
function UsageRow({
  label,
  used,
  cap,
}: {
  label: string;
  used: number;
  cap: number;
}) {
  const ratio = cap > 0 ? Math.min(used / cap, 1) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-steel">{label}</span>
        <span className="font-meta text-steel/70">
          {used} / {cap}
        </span>
      </div>
      <Progress
        value={ratio}
        tone={ratio >= 0.85 ? "caution" : "gold"}
      />
    </div>
  );
}

/** Whether the sidebar shows features from higher plans (grayed out, with the
 *  tier that unlocks them) or hides them. */
function LockedFeaturesToggle({ org }: { org: Org }) {
  const setHide = useMutation(api.orgs.setHideLockedFeatures);
  const [busy, setBusy] = React.useState(false);

  async function toggle(show: boolean) {
    setBusy(true);
    try {
      await setHide({ hide: !show });
      toast.success(show ? "Higher-plan features show in the sidebar." : "Higher-plan features are hidden.");
    } catch {
      toast.error("Could not update that setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
            <LayoutList className="size-4" />
          </span>
          <div>
            <p className="font-grotesk text-sm font-semibold text-bone">Show features from higher plans</p>
            <p className="text-xs text-steel">
              They sit grayed out in the sidebar with the plan that unlocks them (G for Growth,
              M for Max). Turn this off to hide them.
            </p>
          </div>
        </div>
        <Switch
          checked={!org.hideLockedFeatures}
          disabled={busy}
          onCheckedChange={toggle}
          aria-label="Show features from higher plans in the sidebar"
        />
      </CardContent>
    </Card>
  );
}

/** Billing surface - current plan, tier comparison, usage. */
export function BillingPanel({ org }: { org: Org }) {
  const changePlan = useAction(api.agencyBilling.changeMyPlan);
  const members = useQuery(api.members.list) as { _id: string }[] | undefined;
  const rooms = useQuery(api.rooms.list) as { _id: string }[] | undefined;
  const [switching, setSwitching] = React.useState<OrgPlan | null>(null);

  const currentTier =
    PLAN_TIERS.find((t) => t.value === org.tier) ?? PLAN_TIERS[0];

  /* A plan change is a purchase and goes through Stripe, never a write to the
     workspace record. A studio on a subscription changes it in the Stripe
     portal (prorated, no second subscription); one without opens Checkout.
     The tier moves when Stripe confirms the new price. */
  async function choosePlan(plan: OrgPlan) {
    if (plan === org.tier) return;
    setSwitching(plan);
    try {
      const r = await changePlan({ tier: plan });
      window.location.assign(r.url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start checkout. Try again.");
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Current plan */}
      <Card className="border-gold-dim/50 bg-gold/[0.04]">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-md bg-gold/15 text-gold">
              <CreditCard className="size-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-grotesk text-base font-semibold text-bone">
                  {currentTier.label} plan
                </p>
                <Badge tone="gold">Current</Badge>
              </div>
              <p className="text-xs text-steel">{currentTier.blurb}</p>
            </div>
          </div>
          <p className="font-grotesk text-xl font-bold text-bone">
            {currentTier.price}
          </p>
        </CardContent>
      </Card>

      {/* Plan tiers */}
      <div className="grid gap-3 lg:grid-cols-3">
        {PLAN_TIERS.map((tier) => {
          const isCurrent = tier.value === org.tier;
          return (
            <Card
              key={tier.value}
              className={cn(
                "flex flex-col",
                isCurrent && "border-gold-dim/50",
              )}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{tier.label}</CardTitle>
                  {isCurrent && <Badge tone="gold">Current</Badge>}
                </div>
                <p className="font-grotesk text-lg font-bold text-bone">
                  {tier.price}
                </p>
                <CardDescription>{tier.blurb}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <ul className="flex-1 space-y-2">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-xs text-steel"
                    >
                      <Check className="mt-0.5 size-3.5 shrink-0 text-positive" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  variant={isCurrent ? "secondary" : "outline"}
                  className="w-full"
                  disabled={isCurrent || switching !== null}
                  onClick={() => void choosePlan(tier.value)}
                >
                  {isCurrent
                    ? "Current plan"
                    : switching === tier.value
                      ? "Opening Stripe…"
                      : `Choose ${tier.label}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <LockedFeaturesToggle org={org} />

      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="size-4 text-gold" />
            Usage this period
          </CardTitle>
          <CardDescription>
            A static snapshot of workspace consumption against indicative caps.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageRow
            label="Team members"
            used={members?.length ?? 0}
            cap={25}
          />
          <UsageRow
            label="Rooms & gear"
            used={rooms?.length ?? 0}
            cap={40}
          />
          <UsageRow label="Storage used" used={12} cap={50} />
          <div className="flex items-start gap-2 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-info" />
            <p className="text-[0.6875rem] text-steel/70">
              Choosing a plan opens Stripe. Upgrades are prorated and unlock
              as soon as Stripe confirms; downgrades start at the next renewal.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
