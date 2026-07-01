"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Bot } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import type { Org } from "@/components/settings/types";

/** Studio toggle for the AI SMS receptionist (Tier 4). Opt-in, default off:
 *  when on, inbound booking texts get an instant auto-reply with the booking
 *  link so a studio never misses an inquiry. */
export function AiReceptionistPanel({ org }: { org: Org }) {
  const setEnabled = useMutation(api.orgs.setAiReceptionist);
  const [busy, setBusy] = React.useState(false);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setEnabled({ enabled: next });
      toast.success(next ? "AI receptionist is on." : "AI receptionist is off.");
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
              <Bot className="size-4" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-grotesk text-sm font-semibold text-bone">AI receptionist</p>
                <Badge tone="gold">Tier 4</Badge>
              </div>
              <p className="text-xs text-steel">
                Auto-reply to inbound booking texts with your booking link, 24/7, so you never miss an
                inquiry. It only shares info and your link, never confirms or holds a specific booking,
                respects opt-outs, logs every reply, and emails your team so a human can jump in.
              </p>
            </div>
          </div>
          <Switch
            checked={org.aiReceptionistEnabled}
            disabled={busy}
            onCheckedChange={toggle}
            aria-label="Toggle the AI SMS receptionist"
          />
        </div>

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
