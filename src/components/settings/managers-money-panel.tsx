"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import { useCapabilities } from "@/lib/use-capabilities";
import type { Org } from "@/components/settings/types";

/** The owner's switch for whether managers see money.
 *
 *  Off, managers still run bookings, the schedule and the team, and see no
 *  invoices, payments, rates, deposits, payroll, expenses or reports. The server
 *  withholds the capabilities (convex/lib/access.ts), so the web app, the phone
 *  and the phone's offline copy change together. Only an owner sees the switch;
 *  the mutation refuses anyone else regardless. */
export function ManagersMoneyPanel({ org }: { org: Org }) {
  const { role, loaded } = useCapabilities();
  const setManagersSeeMoney = useMutation(api.orgs.setManagersSeeMoney);
  const [busy, setBusy] = React.useState(false);

  if (!loaded || role !== "owner") return null;

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setManagersSeeMoney({ enabled: next });
      toast.success(next ? "Managers can see money." : "Money is hidden from managers.");
    } catch {
      toast.error("Could not update that setting.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
              <Wallet className="size-4" />
            </span>
            <div>
              <p className="font-grotesk text-sm font-semibold text-bone">Managers can see money</p>
              <p className="text-xs text-steel">
                Off, managers still run bookings, the schedule and the team, but see no invoices,
                payments, rates, deposits, payroll, expenses or reports, here or on their phones.
                Engineers and the rest of the floor never see money. Owners always do.
              </p>
            </div>
          </div>
          <Switch
            checked={org.managersSeeMoney}
            disabled={busy}
            onCheckedChange={toggle}
            aria-label="Let managers see money"
          />
        </div>
      </CardContent>
    </Card>
  );
}
