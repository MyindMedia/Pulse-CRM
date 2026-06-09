"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Clapperboard,
  Rocket,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { meta, SESSION_STATUS, SYNC_STAGE, CAMPAIGN_STATUS, ACCENT_TONE, titleCase } from "@/lib/labels";
import { longDate, shortDate, timeOfDay, duration, relativeTime, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/* ════════════════ Sessions ════════════════ */

type SessionRow = {
  _id: string;
  title: string;
  startTime: number;
  endTime: number;
  status: string;
  serviceType?: string;
  notes?: string;
};

export function SessionsTab({ sessions }: { sessions: SessionRow[] }) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No sessions linked"
        description="Sessions booked against this song will show up here with their status and times."
      />
    );
  }
  return (
    <Card>
      <CardContent className="divide-y divide-hairline p-0">
        {sessions.map((s) => {
          const st = meta(SESSION_STATUS, s.status);
          const start = new Date(s.startTime);
          return (
            <div key={s._id} className="flex items-center gap-3 p-4">
              <div className="grid size-12 shrink-0 place-items-center rounded-md border border-graphite/50 bg-obsidian text-center">
                <span className="font-grotesk text-sm font-bold leading-none text-bone">
                  {start.getDate()}
                </span>
                <span className="font-meta text-[0.5625rem] uppercase text-steel/70">
                  {start.toLocaleDateString("en-US", { month: "short" })}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-bone">{s.title}</p>
                <p className="truncate font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                  {timeOfDay(s.startTime)} · {duration(s.startTime, s.endTime)}
                  {s.serviceType ? ` · ${titleCase(s.serviceType)}` : ""}
                </p>
              </div>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/* ════════════════ Sync & Release ════════════════ */

type SyncRow = {
  _id: string;
  supervisorName: string;
  outlet: string;
  stage: string;
  feeCents?: number;
  updatedAt: number;
};

export function SyncReleaseTab({
  songId,
  syncs,
}: {
  songId: Id<"songs">;
  syncs: SyncRow[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SyncOpportunitiesCard syncs={syncs} />
      <ReleaseCampaignCard songId={songId} />
    </div>
  );
}

function SyncOpportunitiesCard({ syncs }: { syncs: SyncRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clapperboard className="size-4 text-steel/70" />
          Sync opportunities
        </CardTitle>
      </CardHeader>
      <CardContent>
        {syncs.length === 0 ? (
          <p className="py-6 text-center text-sm text-steel/70">
            No sync pitches on this track yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {syncs
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((s) => {
                const stage = meta(SYNC_STAGE, s.stage);
                return (
                  <li
                    key={s._id}
                    className="flex items-center gap-3 rounded-md border border-graphite/50 bg-coal-2 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-bone">
                        {s.supervisorName}
                      </p>
                      <p className="truncate font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                        {s.outlet} · {relativeTime(s.updatedAt)}
                      </p>
                    </div>
                    {s.feeCents != null && (
                      <span className="font-meta text-xs text-gold">
                        {money(s.feeCents, { compact: true })}
                      </span>
                    )}
                    <Badge tone={stage.tone}>{stage.label}</Badge>
                  </li>
                );
              })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ReleaseCampaignCard({ songId }: { songId: Id<"songs"> }) {
  const campaign = useQuery(api.releases.forSong, { songId });
  const createCampaign = useMutation(api.releases.create);
  const toggleTask = useMutation(api.releases.toggleTask);
  const setStatus = useMutation(api.releases.setStatus);

  const [dateValue, setDateValue] = useState("");
  const [building, setBuilding] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);

  async function build() {
    if (!dateValue) {
      toast.error("Pick a release date first.");
      return;
    }
    const ts = new Date(`${dateValue}T12:00:00`).getTime();
    if (!Number.isFinite(ts)) {
      toast.error("That release date is not valid.");
      return;
    }
    setBuilding(true);
    try {
      await createCampaign({ songId, releaseDate: ts });
      toast.success("Release campaign built.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build the campaign.");
    } finally {
      setBuilding(false);
    }
  }

  async function flip(index: number) {
    if (!campaign) return;
    try {
      await toggleTask({ id: campaign._id, index });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the task.");
    }
  }

  async function changeStatus(status: "planning" | "active" | "released") {
    if (!campaign) return;
    setStatusUpdating(true);
    try {
      await setStatus({ id: campaign._id, status });
      toast.success(`Campaign moved to ${status}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the campaign.");
    } finally {
      setStatusUpdating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-4 text-steel/70" />
          Release campaign
        </CardTitle>
        {campaign && (
          <Badge tone={meta(CAMPAIGN_STATUS, campaign.status).tone}>
            {meta(CAMPAIGN_STATUS, campaign.status).label}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {campaign === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : campaign === null ? (
          <div className="space-y-3">
            <p className="text-sm text-steel">
              Build a rollout plan - a pre-built 12-step checklist anchored to the release date.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <span className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                  Release date
                </span>
                <Input
                  type="date"
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  className="w-44"
                />
              </div>
              <Button onClick={build} disabled={building}>
                <Rocket className="size-4" />
                {building ? "Building…" : "Build release campaign"}
              </Button>
            </div>
          </div>
        ) : (
          <CampaignChecklist
            campaign={campaign}
            onToggle={flip}
            onStatus={changeStatus}
            statusUpdating={statusUpdating}
          />
        )}
      </CardContent>
    </Card>
  );
}

type CampaignTask = { label: string; offsetDays: number; done: boolean; owner?: string };
type Campaign = {
  _id: Id<"releaseCampaigns">;
  releaseDate: number;
  status: string;
  tasks: CampaignTask[];
};

function CampaignChecklist({
  campaign,
  onToggle,
  onStatus,
  statusUpdating,
}: {
  campaign: Campaign;
  onToggle: (index: number) => void;
  onStatus: (status: "planning" | "active" | "released") => void;
  statusUpdating: boolean;
}) {
  const done = campaign.tasks.filter((t) => t.done).length;
  const total = campaign.tasks.length;
  const pct = total > 0 ? done / total : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-meta text-[0.6875rem] uppercase tracking-wide text-steel/70">
          Releases {longDate(campaign.releaseDate)}
        </span>
        <span className="font-meta text-xs text-bone">
          {done}/{total}
        </span>
      </div>
      <Progress value={done} max={Math.max(total, 1)} tone={pct === 1 ? "positive" : "gold"} />

      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {campaign.tasks.map((t, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onToggle(i)}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-coal-2"
            >
              {t.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-positive" />
              ) : (
                <Circle className="size-4 shrink-0 text-steel/70" />
              )}
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  t.done ? "text-steel/70 line-through" : "text-bone",
                )}
              >
                {t.label}
              </span>
              <span className="shrink-0 font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                {t.offsetDays === 0
                  ? "Release day"
                  : t.offsetDays > 0
                    ? `+${t.offsetDays}d`
                    : `${t.offsetDays}d`}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-2 border-t border-graphite/50 pt-3">
        {campaign.status === "planning" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStatus("active")}
            disabled={statusUpdating}
          >
            Activate campaign
          </Button>
        )}
        {campaign.status !== "released" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onStatus("released")}
            disabled={statusUpdating}
          >
            <Rocket className="size-3.5" />
            Mark released
          </Button>
        )}
      </div>
    </div>
  );
}

/* ════════════════ Activity ════════════════ */

export function ActivityTab({ songId }: { songId: Id<"songs"> }) {
  const events = useQuery(api.activity.forEntity, {
    entityType: "song",
    entityId: songId,
  });

  if (events === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title="No activity yet"
        description="Stage changes, deliverables, splits and campaign events stream in here."
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-3">
        <ol className="relative space-y-1 before:absolute before:bottom-2 before:left-[0.6875rem] before:top-2 before:w-px before:bg-hairline">
          {events.map((e) => {
            const tone = ACCENT_TONE[e.accent ?? "info"] ?? "info";
            const dotColor =
              tone === "gold"
                ? "var(--color-gold)"
                : tone === "positive"
                  ? "var(--color-positive)"
                  : tone === "critical"
                    ? "var(--color-critical)"
                    : "var(--color-info)";
            return (
              <li key={e._id} className="relative flex items-start gap-3 py-2 pl-1">
                <span
                  className="z-10 mt-1 grid size-3.5 shrink-0 place-items-center rounded-full ring-4 ring-coal"
                  style={{ background: dotColor }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-bone">{e.summary}</p>
                  <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                    {titleCase(e.kind)} · {relativeTime(e._creationTime)} ·{" "}
                    {shortDate(e._creationTime)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
