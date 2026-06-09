"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  Building2,
  CalendarCheck,
  CircleDollarSign,
  KanbanSquare,
  Receipt,
  Send,
  TrendingUp,
} from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SkeletonCards, SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import { TrendArea, HBars, CategoryDonut } from "@/components/charts";
import { CreateSubaccountDialog } from "@/components/agency/create-subaccount-dialog";
import { InviteStudioDialog } from "@/components/agency/invite-studio-dialog";
import {
  SubaccountTable,
  type SubaccountRow,
} from "@/components/agency/subaccount-table";

export default function AgencyOverviewPage() {
  const overview = useQuery(api.agency.overview);
  const subaccounts = useQuery(api.agency.subaccounts);

  const rows: SubaccountRow[] | undefined = subaccounts?.map((s) => ({
    orgId: s.orgId,
    name: s.name,
    slug: s.slug,
    plan: s.plan,
    status: s.status,
    accentColor: s.accentColor,
    roomCount: s.roomCount,
    bookingCount: s.bookingCount,
    collectedCents: s.collectedCents,
    _creationTime: s._creationTime,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        overline="Agency"
        title="System overview"
        description="The whole network in one place - revenue, subscribers, pipelines, outreach, and the studios that drive it all."
        actions={
          <div className="flex items-center gap-2">
            <CreateSubaccountDialog />
            <InviteStudioDialog />
          </div>
        }
      />

      {/* Headline KPIs */}
      {overview === undefined ? (
        <SkeletonCards cards={6} />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile
            label="Studios"
            value={String(overview.studioCount)}
            icon={Building2}
            accent
            hint={`${overview.activeCount} active`}
          />
          <StatTile
            label="Bookings"
            value={String(overview.bookingCount)}
            icon={CalendarCheck}
          />
          <StatTile
            label="Collected · MTD"
            value={money(overview.collectedThisMonthCents, { compact: true })}
            icon={CircleDollarSign}
            hint={`${money(overview.collectedCents, { compact: true })} lifetime`}
          />
          <StatTile
            label="Pipeline value"
            value={money(overview.pipelineValueCents, { compact: true })}
            icon={KanbanSquare}
            hint={`${overview.pipelineCount} opps`}
          />
          <StatTile
            label="Outstanding"
            value={money(overview.outstandingCents, { compact: true })}
            icon={Receipt}
            hint={
              overview.overdueCents > 0
                ? `${money(overview.overdueCents, { compact: true })} overdue`
                : "All current"
            }
          />
          <StatTile
            label="Touches · 30d"
            value={String(overview.recentTouches)}
            icon={Send}
            hint="across all studios"
          />
        </div>
      )}

      {/* Revenue + subscribers row */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue · last 12 months</CardTitle>
          </CardHeader>
          <CardContent>
            {overview === undefined ? (
              <div className="skeleton h-48 rounded-md" />
            ) : overview.revenueTrend.every((r) => r.revenue === 0) ? (
              <EmptyState
                icon={TrendingUp}
                title="No revenue yet"
                description="Once subaccounts process payments, the network's revenue curve lands here."
              />
            ) : (
              <TrendArea data={overview.revenueTrend} xKey="month" yKey="revenue" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscribers by plan</CardTitle>
          </CardHeader>
          <CardContent>
            {overview === undefined ? (
              <div className="skeleton h-48 rounded-md" />
            ) : overview.subscribersByPlan.length === 0 ? (
              <EmptyState
                icon={Building2}
                title="No subscribers"
                description="Studios you provision show up here grouped by their billing tier."
              />
            ) : (
              <CategoryDonut
                data={overview.subscribersByPlan}
                labelKey="plan"
                valueKey="count"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline + outreach row */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Pipeline by stage</CardTitle>
          </CardHeader>
          <CardContent>
            {overview === undefined ? (
              <div className="skeleton h-44 rounded-md" />
            ) : overview.pipelineByStage.length === 0 ? (
              <EmptyState
                icon={KanbanSquare}
                title="No opportunities yet"
                description="Cross-studio pipeline stages land here as subaccounts log deals."
              />
            ) : (
              <HBars
                data={overview.pipelineByStage}
                labelKey="stage"
                valueKey="count"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outreach · last 30 days</CardTitle>
          </CardHeader>
          <CardContent>
            {overview === undefined ? (
              <div className="skeleton h-44 rounded-md" />
            ) : overview.outreachBreakdown.length === 0 ? (
              <EmptyState
                icon={Send}
                title="Quiet network"
                description="Session, invoice, and pipeline activity across all studios shows up here."
              />
            ) : (
              <HBars
                data={overview.outreachBreakdown}
                labelKey="kind"
                valueKey="count"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top studios leaderboard */}
      <Section title="Top studios · lifetime revenue">
        {overview === undefined ? (
          <SkeletonRows rows={5} />
        ) : overview.topStudios.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No studios yet"
            description="Provision a subaccount to start a leaderboard."
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-hairline">
                {overview.topStudios.map((s, idx) => (
                  <li key={s.orgId}>
                    <Link
                      href={`/agency/${s.orgId}`}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-coal-2"
                    >
                      <span className="font-meta text-[0.6875rem] text-steel/70 w-5">
                        #{idx + 1}
                      </span>
                      <span className="grid size-8 place-items-center rounded-md bg-coal-2 text-gold-dim">
                        <Building2 className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-bone">
                          {s.name}
                        </p>
                        <p className="font-meta text-[0.625rem] uppercase tracking-wide text-steel/70">
                          /{s.slug} · {s.sessions} session
                          {s.sessions === 1 ? "" : "s"}
                        </p>
                      </span>
                      <Badge tone="neutral">{s.plan}</Badge>
                      <span className="font-meta text-sm font-medium tabular-nums text-bone">
                        {money(s.collectedCents)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </Section>

      {/* Full subaccount list */}
      <Section
        title={rows ? `${rows.length} subaccount${rows.length === 1 ? "" : "s"}` : "Subaccounts"}
      >
        {rows === undefined ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No studios yet"
            description="Create your first subaccount to spin up a studio workspace with its own rooms, roster, and booking page."
            action={<CreateSubaccountDialog triggerSize="sm" />}
          />
        ) : (
          <SubaccountTable rows={rows} />
        )}
      </Section>
    </div>
  );
}
