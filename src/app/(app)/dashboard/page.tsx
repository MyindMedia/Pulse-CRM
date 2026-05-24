"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { PulseAiPanel } from "@/components/ai/pulse-ai-panel";
import { OpsAutopilotPanel } from "@/components/ai/ops-autopilot-panel";
import { OnboardingNudge } from "@/components/onboarding/onboarding-nudge";
import {
  DollarSign,
  CalendarCheck,
  KanbanSquare,
  AlertCircle,
  UserPlus,
  Gauge,
  Database,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { TrendArea, HBars, CategoryDonut } from "@/components/charts";
import { money, compactNumber, relativeTime, shortDate, timeOfDay } from "@/lib/format";
import { meta, SESSION_STATUS, ACCENT_TONE, titleCase } from "@/lib/labels";

export default function DashboardPage() {
  const data = useQuery(api.dashboard.overview);
  const upcoming = useQuery(api.sessions.upcoming, { limit: 6 });
  const activity = useQuery(api.activity.recent, { limit: 12 });
  const insights = useQuery(api.insights.open, { limit: 4 });
  const seed = useMutation(api.seed.run);
  const [seeding, setSeeding] = useState(false);
  const [lastRefreshed] = useState(() => Date.now());

  const empty = data && data.kpis.rosterSize === 0;

  return (
    <div className="space-y-7">
      <OnboardingNudge />
      <PageHeader
        overline="Studio"
        title="Dashboard"
        description="Everything moving through the studio today - bookings, cash, catalog and the deals in flight."
      />

      {empty && (
        <Card className="border-gold-dim/50 bg-gold/[0.04]">
          <CardContent className="flex flex-wrap items-center gap-4 pt-5">
            <span className="grid size-11 place-items-center rounded-lg bg-gold/15 text-gold">
              <Database className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display font-semibold text-bone">Load the demo studio</p>
              <p className="text-sm text-ash">
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

      {/* KPI grid */}
      {!data ? (
        <SkeletonCards cards={6} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Revenue · MTD"
            value={money(data.kpis.revenueThisMonth, { compact: true })}
            icon={DollarSign}
            delta={data.kpis.revenueDelta}
            hint="vs last month"
            accent
          />
          <StatTile
            label="Sessions · MTD"
            value={String(data.kpis.sessionsThisMonth)}
            icon={CalendarCheck}
          />
          <StatTile
            label="Pipeline value"
            value={money(data.kpis.pipelineValue, { compact: true })}
            icon={KanbanSquare}
          />
          <StatTile
            label="Outstanding"
            value={money(data.kpis.outstandingCents, { compact: true })}
            icon={AlertCircle}
            hint={data.kpis.overdueCount ? `${data.kpis.overdueCount} overdue` : "all current"}
          />
          <StatTile
            label="New leads · 7d"
            value={String(data.kpis.newLeadsThisWeek)}
            icon={UserPlus}
          />
          <StatTile
            label="Avg session"
            value={money(data.kpis.avgSessionValue, { compact: true })}
            icon={Gauge}
          />
        </div>
      )}

      {/* Revenue + insights */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Revenue - last 12 months</CardTitle>
            <Badge tone="gold">Collected</Badge>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <TrendArea data={data.charts.revenueTrend} xKey="month" yKey="revenue" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Pulse insights</CardTitle>
            <Sparkles className="size-4 text-gold" />
          </CardHeader>
          <CardContent className="space-y-2.5">
            {insights === undefined ? (
              <Skeleton className="h-40 w-full" />
            ) : insights.length === 0 ? (
              <p className="py-8 text-center text-sm text-ash-dim">No open nudges.</p>
            ) : (
              insights.map((it) => (
                <div key={it._id} className="rounded-md border border-hairline bg-coal-2 p-3">
                  <p className="text-sm font-medium text-bone">{it.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ash">{it.body}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Chart trio */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[160px] w-full" />
            ) : data.charts.pipelineByStage.length === 0 ? (
              <p className="py-10 text-center text-sm text-ash-dim">No open opportunities.</p>
            ) : (
              <HBars data={data.charts.pipelineByStage} labelKey="stage" valueKey="count" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Bookings by service</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[200px] w-full" />
            ) : data.charts.bookingsByService.length === 0 ? (
              <p className="py-10 text-center text-sm text-ash-dim">No sessions yet.</p>
            ) : (
              <CategoryDonut data={data.charts.bookingsByService} labelKey="service" valueKey="count" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Catalog by stage</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-[160px] w-full" />
            ) : data.charts.songsByStage.length === 0 ? (
              <p className="py-10 text-center text-sm text-ash-dim">No songs yet.</p>
            ) : (
              <HBars data={data.charts.songsByStage} labelKey="stage" valueKey="count" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming + activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Upcoming sessions"
          trailing={
            <Link href="/calendar" className="text-xs font-medium text-gold hover:underline">
              Open calendar
            </Link>
          }
        >
          <Card>
            <CardContent className="divide-y divide-hairline p-0">
              {upcoming === undefined ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : upcoming.length === 0 ? (
                <EmptyState
                  icon={CalendarCheck}
                  title="Nothing on the books"
                  description="Confirmed sessions will show up here."
                  className="border-0 bg-transparent"
                />
              ) : (
                upcoming.map((s) => {
                  const st = meta(SESSION_STATUS, s.status);
                  return (
                    <Link
                      key={s._id}
                      href="/calendar"
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-coal-2"
                    >
                      <div className="grid size-11 shrink-0 place-items-center rounded-md border border-hairline bg-ink-2 text-center">
                        <span className="font-display text-sm font-bold leading-none text-bone">
                          {new Date(s.startTime).getDate()}
                        </span>
                        <span className="font-mono text-[0.5625rem] uppercase text-ash-dim">
                          {new Date(s.startTime).toLocaleDateString("en-US", { month: "short" })}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-bone">{s.title}</p>
                        <p className="truncate text-xs text-ash-dim">
                          {s.artistName} · {timeOfDay(s.startTime)}
                          {s.roomName ? ` · ${s.roomName}` : ""}
                        </p>
                      </div>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        </Section>

        <Section title="Ops Autopilot">
          <OpsAutopilotPanel />
        </Section>

        <Section title="Pulse AI">
          <PulseAiPanel />
        </Section>

        <Section title="Activity">
          <Card>
            <CardContent className="p-0">
              {activity === undefined ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : activity.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  title="No activity yet"
                  description="Studio events will stream in here."
                  className="border-0 bg-transparent"
                />
              ) : (
                <ul className="max-h-[22rem] overflow-y-auto p-2">
                  {activity.map((a) => (
                    <li key={a._id} className="flex items-start gap-3 rounded-md px-2 py-2">
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full"
                        style={{
                          background: `var(--color-${
                            ACCENT_TONE[a.accent ?? "info"] === "gold"
                              ? "gold"
                              : ACCENT_TONE[a.accent ?? "info"] === "positive"
                                ? "positive"
                                : ACCENT_TONE[a.accent ?? "info"] === "critical"
                                  ? "critical"
                                  : "info"
                          })`,
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-bone">{a.summary}</p>
                        <p className="font-mono text-[0.625rem] uppercase tracking-wide text-ash-dim">
                          {titleCase(a.kind)} · {relativeTime(a._creationTime)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </Section>
      </div>

      {data && (
        <p className="flex items-center gap-1.5 text-xs text-ash-dim">
          {compactNumber(data.kpis.activeSongs)} songs in production ·{" "}
          {compactNumber(data.kpis.rosterSize)} on the roster
          <Link href="/songs" className="inline-flex items-center gap-0.5 text-gold hover:underline">
            View catalog <ArrowRight className="size-3" />
          </Link>
          <span className="text-ash-dim">- last refreshed {shortDate(lastRefreshed)}</span>
        </p>
      )}
    </div>
  );
}
