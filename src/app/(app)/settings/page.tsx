"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Building2, CreditCard, Database, Palette, Receipt, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePanel } from "@/components/settings/workspace-panel";
import { TeamPanel } from "@/components/settings/team-panel";
import { BillingPanel } from "@/components/settings/billing-panel";
import { BrandingPanel } from "@/components/settings/branding-panel";
import { PricingPanel } from "@/components/settings/pricing-panel";
import { DataPanel } from "@/components/settings/data-panel";
import type { Org } from "@/components/settings/types";

/** Shimmer block while the org record loads. */
function SettingsSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-72" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function SettingsPage() {
  const org = useQuery(api.orgs.current) as Org | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Workspace"
        title="Settings"
        description="Configure the workspace identity, the team, the plan and the demo data behind Pulse."
      />

      {org === undefined ? (
        <SettingsSkeleton />
      ) : (
        <Tabs defaultValue="workspace" className="space-y-5">
          <TabsList>
            <TabsTrigger value="workspace">
              <Building2 className="size-4" />
              Workspace
            </TabsTrigger>
            <TabsTrigger value="branding">
              <Palette className="size-4" />
              Branding
            </TabsTrigger>
            <TabsTrigger value="pricing">
              <Receipt className="size-4" />
              Pricing
            </TabsTrigger>
            <TabsTrigger value="team">
              <Users className="size-4" />
              Team
            </TabsTrigger>
            <TabsTrigger value="billing">
              <CreditCard className="size-4" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="data">
              <Database className="size-4" />
              Data
            </TabsTrigger>
          </TabsList>

          <TabsContent value="workspace">
            <WorkspacePanel org={org} />
          </TabsContent>
          <TabsContent value="branding">
            <BrandingPanel org={org} />
          </TabsContent>
          <TabsContent value="pricing">
            <PricingPanel org={org} />
          </TabsContent>
          <TabsContent value="team">
            <TeamPanel />
          </TabsContent>
          <TabsContent value="billing">
            <BillingPanel org={org} />
          </TabsContent>
          <TabsContent value="data">
            <DataPanel />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
