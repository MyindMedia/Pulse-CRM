"use client";

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { Sunrise } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/toggle";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useCapabilities } from "@/lib/use-capabilities";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? "AM" : "PM"}`;

/** What the switch shows. The summary is only sent while the assistant is on
 *  (agentPolicies.enabled), so with the assistant off it reads off and locked,
 *  never "on", whatever digestEnabled holds. */
export function digestSwitchState(policy: { enabled: boolean; digestEnabled: boolean }) {
  const paused = !policy.enabled;
  return { checked: paused ? false : policy.digestEnabled, locked: paused, paused };
}

/** The daily summary's on/off switch and send hour. The summary is on every
 *  plan, so this lives in Settings rather than on the Growth-only Agent page;
 *  updatePolicy accepts a digest-only change under the dailySummary
 *  entitlement. The hour is the studio's own (its time zone in Workspace). */
export function DailySummaryPanel({ timezone }: { timezone: string | null }) {
  const { can, loaded } = useCapabilities();
  const policy = useQuery(api.agent.getPolicy, {});
  const update = useMutation(api.agent.updatePolicy);
  const [busy, setBusy] = React.useState(false);

  if (!loaded || !can("ops.autonomy.manage") || !policy) return null;
  const sw = digestSwitchState(policy);

  async function save(patch: { digestEnabled?: boolean; digestHourLocal?: number }) {
    setBusy(true);
    try {
      await update(patch);
      toast.success("Daily summary updated.");
    } catch {
      toast.error("Could not update the daily summary.");
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
              <Sunrise className="size-4" />
            </span>
            <div>
              <p className="font-grotesk text-sm font-semibold text-bone">Daily summary</p>
              <p className="text-xs text-steel">
                An email each morning with where the studio stands, sent at the hour you pick
                {timezone ? ` (${timezone} time)` : " (UTC until you set the studio time zone above)"}.
              </p>
            </div>
          </div>
          <Switch
            checked={sw.checked}
            disabled={busy || sw.locked}
            onCheckedChange={(v) => save({ digestEnabled: v })}
            aria-label="Send the daily summary"
          />
        </div>
        {sw.paused && (
          <p className="pl-12 text-xs text-caution">
            The daily summary is paused because the assistant is turned off.
          </p>
        )}
        <div className="flex items-center gap-2 pl-12">
          <span className="text-xs text-steel">Send at</span>
          <Select
            value={String(policy.digestHourLocal)}
            disabled={busy || !sw.checked}
            onValueChange={(v) => save({ digestHourLocal: Number(v) })}
          >
            <SelectTrigger className="w-32" aria-label="Hour to send the daily summary"><SelectValue /></SelectTrigger>
            <SelectContent>
              {HOURS.map((h) => <SelectItem key={h} value={String(h)}>{hourLabel(h)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
