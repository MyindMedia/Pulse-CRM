"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { toast } from "sonner";
import { differenceInCalendarDays } from "date-fns";
import { ArrowRight, CalendarClock, CheckCircle2, Rocket } from "lucide-react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/feedback";
import { meta, CAMPAIGN_STATUS } from "@/lib/labels";
import { longDate, percent } from "@/lib/format";
import { RolloutTimeline } from "./rollout-timeline";
import type { Campaign } from "./types";

const NEXT_STATUS: Record<Campaign["status"], Campaign["status"] | null> = {
  planning: "active",
  active: "released",
  released: null,
};

const ADVANCE_LABEL: Record<Campaign["status"], string> = {
  planning: "Activate campaign",
  active: "Mark released",
  released: "Released",
};

/** Detail drawer - rollout timeline plus the status advance control. */
export function CampaignSheet({
  campaign,
  open,
  onOpenChange,
}: {
  campaign: Campaign | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toggleTask = useMutation(api.releases.toggleTask);
  const setStatus = useMutation(api.releases.setStatus);
  const [advancing, setAdvancing] = useState(false);
  // Stable "now" snapshot at mount keeps the render pure.
  const [nowMs] = useState(() => Date.now());

  if (!campaign) return null;

  const status = meta(CAMPAIGN_STATUS, campaign.status);
  const next = NEXT_STATUS[campaign.status];
  const days = differenceInCalendarDays(campaign.releaseDate, nowMs);

  async function handleToggle(index: number) {
    if (!campaign) return;
    try {
      await toggleTask({ id: campaign._id, index });
    } catch {
      toast.error("Could not update that task.");
    }
  }

  async function handleAdvance() {
    if (!campaign || !next) return;
    setAdvancing(true);
    try {
      await setStatus({ id: campaign._id, status: next });
      toast.success(
        next === "released"
          ? "Campaign released - song moved to released stage."
          : "Campaign is now active.",
      );
    } catch {
      toast.error("Could not change the campaign status.");
    } finally {
      setAdvancing(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width="md">
        <SheetHeader>
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0">
              <p className="overline">{campaign.artistName}</p>
              <SheetTitle className="mt-0.5 truncate">{campaign.songTitle}</SheetTitle>
            </div>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <SheetDescription className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5" />
            {longDate(campaign.releaseDate)}
            <span className="text-steel/70">
              ·{" "}
              {days > 0
                ? `in ${days} days`
                : days === 0
                  ? "releases today"
                  : `${Math.abs(days)} days ago`}
            </span>
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-6">
          <div className="space-y-2 rounded-lg border border-graphite/50 bg-coal-2 p-4">
            <div className="flex items-center justify-between">
              <p className="overline">Rollout progress</p>
              <span className="font-meta text-xs text-steel/70">
                {campaign.doneCount}/{campaign.taskCount} · {percent(campaign.progress)}
              </span>
            </div>
            <Progress
              value={campaign.progress}
              tone={
                campaign.status === "released"
                  ? "positive"
                  : campaign.progress >= 0.66
                    ? "positive"
                    : campaign.progress >= 0.34
                      ? "gold"
                      : "caution"
              }
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Rocket className="size-3.5 text-gold" />
              <p className="overline">12-step rollout</p>
            </div>
            <RolloutTimeline tasks={campaign.tasks} onToggle={handleToggle} />
          </div>
        </SheetBody>

        <SheetFooter>
          {next ? (
            <Button onClick={handleAdvance} disabled={advancing} className="w-full">
              {advancing ? (
                <>
                  <Spinner className="text-gold-ink" /> Updating…
                </>
              ) : (
                <>
                  {ADVANCE_LABEL[campaign.status]}
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          ) : (
            <div className="flex w-full items-center justify-center gap-2 rounded-md border border-positive/30 bg-positive/10 py-2.5 text-sm font-medium text-positive">
              <CheckCircle2 className="size-4" />
              Campaign released
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
