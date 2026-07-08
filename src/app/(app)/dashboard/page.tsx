"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { PulseAiPanel } from "@/components/ai/pulse-ai-panel";
import { OpsAutopilotPanel } from "@/components/ai/ops-autopilot-panel";
import { OnboardingNudge } from "@/components/onboarding/onboarding-nudge";
import { GetPaidBanner } from "@/components/payments/get-paid-banner";
import { TodayBoard } from "@/components/today/today-board";
import { RecoveredByPulse } from "@/components/dashboard/recovered-by-pulse";
import { KpiStats } from "@/components/dashboard/kpi-stats";
import { RevenueChartCard } from "@/components/dashboard/revenue-chart-card";
import { UpcomingSessionsCard } from "@/components/dashboard/upcoming-sessions-card";
import { ActivityCard } from "@/components/dashboard/activity-card";
import { ArrowRight, Database, Sparkles } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HBars, CategoryDonut } from "@/components/charts";
import { compactNumber, shortDate, longDate } from "@/lib/format";

export default function DashboardPage() {
  const data = useQuery(api.dashboard.overview);
  const insights = useQuery(api.insights.open, { limit: 4 });
  const seed = useMutation(api.seed.run);
  const [seeding, setSeeding] = useState(false);
  const [lastRefreshed] = useState(() => Date.now());

  const empty = data && data.kpis.rosterSize === 0;

  return (
    <div className="space-y-7">
      <OnboardingNudge />
      <GetPaidBanner />
      <PageHeader
        overline="Studio"
        title="Dashboard"
        description={`What's happening right now and everything moving through the studio - ${longDate(lastRefreshed)}.`}
      />

      {/* The live day view (formerly the Today page) - one pane, no tab hop. */}
      <TodayBoard />

      {empty && (
        <Card className="border-gold-dim/50 bg-gold/[0.04]">
          <CardContent className="flex flex-wrap items-center gap-4 pt-5">
            <span className="grid size-11 place-items-center rounded-lg bg-gold/15 text-gold">
              <Database className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-grotesk font-semibold text-bone">Load the demo studio</p>
              <p className="text-sm text-steel">
                Populate Pulse with Lumen Recording Co. - a full studio of artists, songs,
                sessions, invoices and deals so every screen is explorable.
              </p>
            </div>
            <Button
              onClick={async () => {
                setSeeding(true);
                try {
                  await seed({});
                } finally {
                  setSeeding(false);
                }
              }}
              disabled={seeding}
            >
              {seeding ? "Loading…" : "Load demo data"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPI row - delta stat cards. */}
      <KpiStats />

      {/* Money line + AI nudges. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <RevenueChartCard className="lg:col-span-3" />
        <Card className="gap-0 lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between border-b border-hairline-2/50 pb-4">
            <div className="space-y-1">
              <CardTitle>Pulse insights</CardTitle>
              <CardDescription>Nudges from your data.</CardDescription>
            </div>
            <Sparkles className="size-4 shrink-0 text-gold" />
          </CardHeader>
          <CardContent className="p-0">
            {insights === undefined ? (
              <div className="space-y-2 p-4">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : insights.length === 0 ? (
              <p className="py-10 text-center text-sm text-steel/70">No open nudges.</p>
            ) : (
              <ul className="divide-y divide-hairline-2/40">
                {insights.map((it) => (
                  <li key={it._id} className="px-4 py-3">
                    <p className="text-sm font-medium text-bone">{it.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-steel">{it.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Distribution trio + the renewal-proof ROI number. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
            <CardDescription>Open opportunities.</CardDescription>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[160px] w-full" />
            ) : data.charts.pipelineByStage.length === 0 ? (
              <p className="py-10 text-center text-sm text-steel/70">No open opportunities.</p>
            ) : (
              <HBars data={data.charts.pipelineByStage} labelKey="stage" valueKey="count" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bookings by service</CardTitle>
            <CardDescription>Where session time goes.</CardDescription>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[200px] w-full" />
            ) : data.charts.bookingsByService.length === 0 ? (
              <p className="py-10 text-center text-sm text-steel/70">No sessions yet.</p>
            ) : (
              <CategoryDonut data={data.charts.bookingsByService} labelKey="service" valueKey="count" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Catalog by stage</CardTitle>
            <CardDescription>Songs in production.</CardDescription>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[160px] w-full" />
            ) : data.charts.songsByStage.length === 0 ? (
              <p className="py-10 text-center text-sm text-steel/70">No songs yet.</p>
            ) : (
              <HBars data={data.charts.songsByStage} labelKey="stage" valueKey="count" />
            )}
          </CardContent>
        </Card>
        {data && data.canSeeFinancials ? <RecoveredByPulse /> : <div className="hidden lg:block" />}
      </div>

      {/* Work on the books + the event stream. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <UpcomingSessionsCard />
        <ActivityCard />
      </div>

      {/* The AI layer. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Ops Autopilot">
          <OpsAutopilotPanel />
        </Section>
        <Section title="Pulse AI">
          <PulseAiPanel />
        </Section>
      </div>

      {data && (
        <p className="flex items-center gap-1.5 text-xs text-steel/70">
          {compactNumber(data.kpis.activeSongs)} songs in production ·{" "}
          {compactNumber(data.kpis.rosterSize)} clients
          <Link href="/songs" className="inline-flex items-center gap-0.5 text-gold hover:underline">
            View catalog <ArrowRight className="size-3" />
          </Link>
          <span className="text-steel/70">- last refreshed {shortDate(lastRefreshed)}</span>
        </p>
      )}
    </div>
  );
}
