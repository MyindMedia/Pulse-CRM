"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLAN_LIMITS, priceLabel } from "@convex/lib/plans";
import { errorMessage } from "@/lib/errors";
import type { Org } from "@/components/settings/types";

/** Studio toggle for the AI SMS receptionist (Tier 4). Opt-in, default off:
 *  when on, inbound booking texts get an instant auto-reply with the booking
 *  link so a studio never misses an inquiry. */
export function AiReceptionistPanel({ org }: { org: Org }) {
  const setEnabled = useMutation(api.orgs.setAiReceptionist);
  const [busy, setBusy] = React.useState(false);
  // Growth feature (truth-plan-gates). A studio below Growth sees an upgrade
  // card; one that already had it on keeps the switch so it can turn it off.
  const included = PLAN_LIMITS[org.tier]?.capabilities.includes("aiReceptionist") ?? false;
  const need = "growth" as const;

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setEnabled({ enabled: next });
      toast.success(next ? "AI receptionist is on." : "AI receptionist is off.");
    } catch (err) {
      toast.error(errorMessage(err, "Could not update that setting."));
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
              <Bot className="size-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-grotesk text-sm font-semibold text-bone">AI receptionist</p>
                <Badge tone="gold">{PLAN_LIMITS[need].label}</Badge>
              </div>
              <p className="text-xs text-steel">
                Auto-reply to inbound booking texts with your booking link, 24/7, so you never miss an
                inquiry. It only shares info and your link, never confirms or holds a specific booking,
                respects opt-outs, logs every reply, and emails your team so a human can jump in.
              </p>
            </div>
          </div>
          {included || org.aiReceptionistEnabled ? (
            <Switch
              checked={org.aiReceptionistEnabled}
              disabled={busy}
              onCheckedChange={toggle}
              aria-label="Toggle the AI SMS receptionist"
            />
          ) : null}
        </div>

        {!included && (
          <div className="rounded-md border border-graphite/50 bg-coal/40 px-3 py-2">
            <p className="text-xs text-steel">
              {org.aiReceptionistEnabled
                ? `Your plan does not include the AI receptionist. It keeps answering for now, and Pulse will tell you the date it stops. Once off, it needs ${PLAN_LIMITS[need].label} to turn back on.`
                : `${PLAN_LIMITS[need].label} unlocks the AI receptionist.`}
            </p>
            <Button asChild className="mt-2" size="sm">
              <a href="/settings?tab=billing">
                Upgrade to {PLAN_LIMITS[need].label} · {priceLabel(need)}/mo
              </a>
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2">
          <Badge tone="caution">Sends on your behalf</Badge>
          <p className="text-[0.6875rem] text-steel/70">
            When on, Pulse texts booking inquiries automatically. Keep it off if you prefer to answer
            every message yourself.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
