"use client";

import Link from "next/link";
import { DeleteSubaccount } from "@/components/agency/delete-subaccount";
import { GraduateBeta } from "@/components/agency/graduate-beta";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  ArrowLeft,
  CalendarCheck,
  CircleDollarSign,
  DoorOpen,
  KeyRound,
  Mail,
  ShieldCheck,
  SquareDashed,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/ui/page";
import { CountUp } from "@/components/shell/app-motion";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton, SkeletonCards } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { longDate, money } from "@/lib/format";
import {
  PLAN_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "@/components/agency/meta";
import { DetailActions } from "@/components/agency/detail-actions";
import { DemoModeToggle } from "@/components/agency/demo-mode-toggle";
import { StageOnboardingButton } from "@/components/agency/stage-onboarding-button";
import { ModuleSwitchboard } from "@/components/modules/module-switchboard";
import { ActivityFeed } from "@/components/agency/activity-feed";
import { ResendInviteButton } from "@/components/agency/resend-invite-button";
import { SubaccountBilling } from "@/components/agency/subaccount-billing";

export default function SubaccountDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const subaccount = useQuery(api.agency.subaccount, { orgId });
  const invites = useQuery(api.invites.list, subaccount ? { orgId } : "skip");
  const hasPendingInvite = invites?.some((i) => i.status === "pending") ?? false;

  const backLink = (
    <Link
      href="/agency"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-steel transition-colors hover:text-bone"
    >
      <ArrowLeft className="size-3.5" />
      All studios
    </Link>
  );

  if (subaccount === undefined) {
    return (
      <div className="space-y-8">
        {backLink}
        <Skeleton className="h-24 w-full" />
        <SkeletonCards cards={4} />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (subaccount === null) {
    return (
      <div className="space-y-8">
        {backLink}
        <EmptyState
          icon={SquareDashed}
          title="Subaccount not found"
          description="This studio may have been removed, or the link is out of date."
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href="/agency">Back to studios</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const accent = subaccount.accentColor ?? "#fdb913";

  return (
    <div className="space-y-8">
      {backLink}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex items-start gap-4">
          {subaccount.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={subaccount.logoUrl}
              alt=""
              className="mt-0.5 size-12 shrink-0 rounded-lg border border-graphite/60 bg-coal-2 object-contain p-1"
              style={{ boxShadow: `inset 0 0 0 1px ${accent}33` }}
              aria-hidden
            />
          ) : (
            <span
              className="mt-0.5 size-12 shrink-0 rounded-lg border border-graphite/60"
              style={{ backgroundColor: accent }}
              aria-hidden
            />
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="chrome-display text-2xl leading-[0.95] tracking-[-0.01em] text-bone">
                {subaccount.name}
              </h1>
              <Badge tone="neutral">{PLAN_LABEL[subaccount.plan]}</Badge>
              <Badge tone={STATUS_TONE[subaccount.status]} dot>
                {STATUS_LABEL[subaccount.status]}
              </Badge>
            </div>
            <p className="font-meta text-xs text-steel/70">/book/{subaccount.slug}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-steel">
              {subaccount.ownerName && (
                <span className="inline-flex items-center gap-1.5">
                  <User className="size-3.5 text-steel/70" />
                  {subaccount.ownerName}
                </span>
              )}
              {subaccount.ownerEmail && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5 text-steel/70" />
                  {subaccount.ownerEmail}
                </span>
              )}
              {hasPendingInvite && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-warning text-xs font-medium">Invite pending</span>
                  <ResendInviteButton orgId={orgId} />
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="text-steel/70">Created</span>
                {longDate(subaccount._creationTime)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="size-3 rounded-sm border border-graphite/60"
                  style={{ backgroundColor: accent }}
                  aria-hidden
                />
                <span className="font-meta uppercase tracking-wide text-steel/70">{accent}</span>
              </span>
            </div>
          </div>
        </div>
        <DetailActions orgId={subaccount.orgId} slug={subaccount.slug} status={subaccount.status} />
      </div>

      {/* Rollup */}
      <div className="rise-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Rooms" value={<CountUp to={subaccount.roomCount} />} icon={DoorOpen} />
        <StatTile label="Bookings" value={<CountUp to={subaccount.bookingCount} />} icon={CalendarCheck} />
        <StatTile
          label="Collected"
          value={<CountUp to={subaccount.collectedCents} format={(n) => money(n, { compact: true })} />}
          icon={CircleDollarSign}
          accent
        />
        <StatTile label="Plan" value={PLAN_LABEL[subaccount.plan]} icon={KeyRound} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Activity */}
        <Section title="Recent activity" className="lg:col-span-2">
          <Card>
            <CardContent className="pt-5">
              <ActivityFeed items={subaccount.activity} />
            </CardContent>
          </Card>
        </Section>

        {/* Provisioning note */}
        <Section title="Provisioning">
          <Card>
            <CardContent className="space-y-3 pt-5">
              <span
                className={
                  "grid size-9 place-items-center rounded-md " +
                  (subaccount.clerkOrgId
                    ? "bg-positive/10 text-positive"
                    : "bg-coal-2 text-steel/70")
                }
              >
                {subaccount.clerkOrgId ? (
                  <ShieldCheck className="size-4" />
                ) : (
                  <KeyRound className="size-4" />
                )}
              </span>
              {subaccount.clerkOrgId ? (
                <div className="space-y-1">
                  <p className="font-grotesk text-sm font-semibold text-bone">
                    Real Clerk organization
                  </p>
                  <p className="text-sm text-steel">
                    The owner was invited by email and signs in to their own studio workspace.
                  </p>
                  <p className="font-meta text-[0.6875rem] text-steel/70">
                    {subaccount.clerkOrgId}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="font-grotesk text-sm font-semibold text-bone">Demo workspace</p>
                  <p className="text-sm text-steel">
                    No real login yet. Set <span className="font-meta text-steel/70">CLERK_SECRET_KEY</span>{" "}
                    to provision real Clerk organizations for new subaccounts.
                  </p>
                </div>
              )}
              {subaccount.createdByAgency && (
                <Badge tone="gold">Created by agency</Badge>
              )}
            </CardContent>
          </Card>
        </Section>
      </div>

      {/* Plan & billing - the agency's rebilling of this studio */}
      <Section title="Plan & billing">
        <SubaccountBilling orgId={subaccount.orgId} />
      </Section>

      {/* Demo data - fill or wipe sample rows for walkthroughs, and the
          stage-for-onboarding hand-off once a deal closes */}
      <Section title="Demo data">
        <Card>
          <CardContent className="space-y-3 pt-5">
            <DemoModeToggle orgId={subaccount.orgId} />
            <StageOnboardingButton
              orgId={subaccount.orgId}
              slug={subaccount.slug}
              name={subaccount.name}
            />
          </CardContent>
        </Card>
      </Section>

      {/* Feature toggles - enable/disable nav features for this sub-account */}
      <Section title="Features">
        <Card>
          <CardContent className="space-y-4 pt-5">
            <p className="text-sm text-steel">
              Show or hide nav features for this studio. Hidden features disappear from
              their sidebar and stay off until you turn them back on - handy for rolling
              out new tools (like the Agent) gradually.
            </p>
            <GraduateBeta
              orgId={orgId}
              name={subaccount.name}
              betaCohort={subaccount.betaCohort}
              graduatedAt={subaccount.graduatedAt ?? null}
              currentTier={subaccount.tier ?? null}
            />
            <ModuleSwitchboard orgId={orgId} />
            <DeleteSubaccount orgId={orgId} />
          </CardContent>
        </Card>
      </Section>
    </div>
  );
}
