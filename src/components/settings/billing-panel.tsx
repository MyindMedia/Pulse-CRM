"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Check, CreditCard, Gauge, Info } from "lucide-react";
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

/** Billing surface - current plan, tier comparison, usage. Presentational only. */
export function BillingPanel({ org }: { org: Org }) {
  const updateOrg = useMutation(api.orgs.update);
  const members = useQuery(api.members.list) as { _id: string }[] | undefined;
  const rooms = useQuery(api.rooms.list) as { _id: string }[] | undefined;
  const [switching, setSwitching] = React.useState<OrgPlan | null>(null);

  const currentTier =
    PLAN_TIERS.find((t) => t.value === org.plan) ?? PLAN_TIERS[0];

  async function switchPlan(plan: OrgPlan) {
    if (plan === org.plan) return;
    setSwitching(plan);
    try {
      await updateOrg({ plan });
      const label = PLAN_TIERS.find((t) => t.value === plan)?.label;
      toast.success(`Switched to the ${label} plan.`);
    } catch {
      toast.error("Could not switch the plan. Try again.");
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
          const isCurrent = tier.value === org.plan;
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
                  onClick={() => switchPlan(tier.value)}
                >
                  {isCurrent
                    ? "Current plan"
                    : switching === tier.value
                      ? "Switching…"
                      : `Switch to ${tier.label}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

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
              Billing is a configuration surface in demo mode. Switching a plan
              updates the workspace record only - no payment method is charged
              and no Stripe account is connected.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
