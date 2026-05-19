"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Building2, CalendarCheck, CircleDollarSign, Power } from "lucide-react";
import { PageHeader, Section } from "@/components/ui/page";
import { StatTile } from "@/components/ui/stat-tile";
import { SkeletonCards, SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/feedback";
import { money } from "@/lib/format";
import { CreateSubaccountDialog } from "@/components/agency/create-subaccount-dialog";
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
        title="Studios"
        description="Every studio subaccount on the platform — usage, status, and provisioning in one command center."
        actions={<CreateSubaccountDialog />}
      />

      {/* Cross-studio totals */}
      {overview === undefined ? (
        <SkeletonCards cards={4} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Studios" value={String(overview.studioCount)} icon={Building2} accent />
          <StatTile label="Active" value={String(overview.activeCount)} icon={Power} />
          <StatTile
            label="Total bookings"
            value={String(overview.bookingCount)}
            icon={CalendarCheck}
          />
          <StatTile
            label="Collected"
            value={money(overview.collectedCents, { compact: true })}
            icon={CircleDollarSign}
          />
        </div>
      )}

      {/* Subaccount list */}
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
