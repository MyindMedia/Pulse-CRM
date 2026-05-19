"use client";

import { differenceInCalendarDays } from "date-fns";
import { CalendarClock, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { meta, CAMPAIGN_STATUS } from "@/lib/labels";
import { longDate, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Campaign } from "./types";

/** Human countdown to release day, anchored on calendar days. */
function countdown(releaseDate: number): { text: string; tone: "gold" | "ash" | "positive" } {
  const days = differenceInCalendarDays(releaseDate, Date.now());
  if (days === 0) return { text: "Releases today", tone: "gold" };
  if (days < 0) return { text: `Released ${Math.abs(days)}d ago`, tone: "positive" };
  if (days === 1) return { text: "Releases tomorrow", tone: "gold" };
  return { text: `in ${days} days`, tone: "ash" };
}

const PROGRESS_TONE = (progress: number, status: Campaign["status"]) =>
  status === "released" ? "positive" : progress >= 0.66 ? "positive" : progress >= 0.34 ? "gold" : "caution";

/** A single campaign card in the releases grid. Clicking it opens the rollout sheet. */
export function CampaignCard({
  campaign,
  onOpen,
}: {
  campaign: Campaign;
  onOpen: (campaign: Campaign) => void;
}) {
  const status = meta(CAMPAIGN_STATUS, campaign.status);
  const cd = countdown(campaign.releaseDate);

  return (
    <Card
      interactive
      onClick={() => onOpen(campaign)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(campaign);
        }
      }}
      className="flex flex-col gap-4 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="overline">{campaign.artistName}</p>
          <h3 className="mt-0.5 truncate font-display text-base font-semibold tracking-tight text-bone">
            {campaign.songTitle}
          </h3>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 text-ash">
          <CalendarClock className="size-3.5 text-ash-dim" />
          {longDate(campaign.releaseDate)}
        </span>
        <span
          className={cn(
            "font-mono text-xs uppercase tracking-wide",
            cd.tone === "gold" && "text-gold",
            cd.tone === "positive" && "text-positive",
            cd.tone === "ash" && "text-ash-dim",
          )}
        >
          {cd.text}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="inline-flex items-center gap-1.5 text-ash">
            <ListChecks className="size-3.5 text-ash-dim" />
            {campaign.doneCount}/{campaign.taskCount} rollout tasks
          </span>
          <span className="font-mono text-ash-dim">{percent(campaign.progress)}</span>
        </div>
        <Progress
          value={campaign.progress}
          tone={PROGRESS_TONE(campaign.progress, campaign.status)}
        />
      </div>
    </Card>
  );
}
