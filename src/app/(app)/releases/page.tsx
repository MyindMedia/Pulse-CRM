"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Activity, CalendarClock, CheckCircle2, ClipboardList, Rocket } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";
import { SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { shortDate } from "@/lib/format";
import { BuildCampaignDialog } from "@/components/releases/build-campaign-dialog";
import { CampaignCard } from "@/components/releases/campaign-card";
import { CampaignSheet } from "@/components/releases/campaign-sheet";
import type { Campaign } from "@/components/releases/types";

/** Sort: live work first (planning, active by soonest release), released last. */
function orderCampaigns(list: Campaign[]): Campaign[] {
  const rank: Record<Campaign["status"], number> = { active: 0, planning: 1, released: 2 };
  return [...list].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return a.releaseDate - b.releaseDate;
  });
}

export default function ReleasesPage() {
  const campaigns = useQuery(api.releases.list) as Campaign[] | undefined;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const ordered = useMemo(
    () => (campaigns ? orderCampaigns(campaigns) : undefined),
    [campaigns],
  );

  // Stable "now" snapshot at mount keeps the render pure.
  const [nowMs] = useState(() => Date.now());
  const stats = useMemo(() => {
    if (!campaigns) return null;
    const active = campaigns.filter((c) => c.status === "active").length;
    const planning = campaigns.filter((c) => c.status === "planning").length;
    const released = campaigns.filter((c) => c.status === "released").length;
    const upcoming = campaigns
      .filter((c) => c.status !== "released" && c.releaseDate >= nowMs)
      .sort((a, b) => a.releaseDate - b.releaseDate)[0];
    return { active, planning, released, nextRelease: upcoming?.releaseDate ?? null };
  }, [campaigns, nowMs]);

  // Keep the open sheet bound to fresh query data after every mutation.
  const selected = useMemo(
    () => campaigns?.find((c) => c._id === selectedId) ?? null,
    [campaigns, selectedId],
  );

  function openCampaign(campaign: Campaign) {
    setSelectedId(campaign._id);
    setSheetOpen(true);
  }

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Marketing"
        title="Releases"
        description="Every rollout in flight - from teaser drop to release-day promo. Build a campaign and Pulse schedules the twelve steps."
        actions={<BuildCampaignDialog />}
      />

      {/* KPI row */}
      {!stats ? (
        <SkeletonCards cards={4} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Active campaigns"
            value={String(stats.active)}
            icon={Activity}
            accent
          />
          <StatTile label="In planning" value={String(stats.planning)} icon={ClipboardList} />
          <StatTile label="Released" value={String(stats.released)} icon={CheckCircle2} />
          <StatTile
            label="Next release"
            value={stats.nextRelease ? shortDate(stats.nextRelease) : "-"}
            icon={CalendarClock}
            hint={stats.nextRelease ? "soonest scheduled" : "nothing on the books"}
          />
        </div>
      )}

      {/* Campaign grid */}
      <Section title="Campaigns">
        {ordered === undefined ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton h-44 w-full rounded-lg" />
            ))}
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState
            icon={Rocket}
            title="No campaigns yet"
            description="Build a release campaign and Pulse lays out the full twelve-step rollout against your release date."
            action={<BuildCampaignDialog />}
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ordered.map((campaign) => (
              <CampaignCard key={campaign._id} campaign={campaign} onOpen={openCampaign} />
            ))}
          </div>
        )}
      </Section>

      <CampaignSheet campaign={selected} open={sheetOpen} onOpenChange={setSheetOpen} />
    </div>
  );
}
