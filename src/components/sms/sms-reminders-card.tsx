"use client";

import * as React from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";

/** Studio toggle for automated session SMS reminders (24h + 2h before). */
export function SmsRemindersCard() {
  const status = useQuery(api.sms.remindersStatus, {});
  const setEnabled = useMutation(api.sms.setRemindersEnabled);

  async function toggle(next: boolean) {
    try {
      await setEnabled({ enabled: next });
      toast.success(next ? "Session text reminders on." : "Session text reminders off.");
    } catch {
      toast.error("Could not update that setting.");
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-gold/12 text-gold">
              <MessageSquare className="size-4" />
            </span>
            <div>
              <p className="font-grotesk text-sm font-semibold text-bone">Session reminders</p>
              <p className="text-xs text-steel">
                Automatically text clients and the assigned engineer 24 hours and 2 hours before each session.
              </p>
            </div>
          </div>
          <Switch
            checked={status?.enabled ?? true}
            disabled={status === undefined}
            onCheckedChange={toggle}
            aria-label="Toggle session text reminders"
          />
        </div>

        {status && !status.providerConfigured && (
          <div className="flex items-center gap-2 rounded-md border border-graphite/50 bg-coal/40 px-3 py-2">
            <Badge tone="caution">Not connected</Badge>
            <p className="text-[0.6875rem] text-steel/70">
              SMS isn&apos;t connected yet, so reminders are simulated (logged, not sent). They&apos;ll start
              delivering once texting is set up for your studio.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
