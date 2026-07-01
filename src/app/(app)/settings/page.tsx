"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Boxes, Building2, CreditCard, Crown, Database, Palette, Receipt, Users, Plug } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspacePanel } from "@/components/settings/workspace-panel";
import { TeamPanel } from "@/components/settings/team-panel";
import { BillingPanel } from "@/components/settings/billing-panel";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";
import { BrandingPanel } from "@/components/settings/branding-panel";
import { TestimonialsPanel } from "@/components/settings/testimonials-panel";
import { EngineerProfilesPanel } from "@/components/settings/engineer-profiles-panel";
import { PricingPanel } from "@/components/settings/pricing-panel";
import { CancellationPolicyPanel } from "@/components/settings/cancellation-policy-panel";
import { DataPanel } from "@/components/settings/data-panel";
import { UsagePanel } from "@/components/settings/usage-panel";
import { ExportPanel } from "@/components/settings/export-panel";
import { MembershipsPanel } from "@/components/settings/memberships-panel";
import { InventoryImportPanel } from "@/components/settings/inventory-import-panel";
import { AiReceptionistPanel } from "@/components/settings/ai-receptionist-panel";
import type { Org } from "@/components/settings/types";
import { CapabilityGuard } from "@/components/shell/capability-guard";

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
  return (
    <CapabilityGuard cap="branding.edit" title="Settings are limited to leadership">
      <SettingsView />
    </CapabilityGuard>
  );
}

function SettingsView() {
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
            <TabsTrigger value="integrations">
              <Plug className="size-4" />
              Integrations
            </TabsTrigger>
            <TabsTrigger value="memberships">
              <Crown className="size-4" />
              Memberships
            </TabsTrigger>
            <TabsTrigger value="billing">
              <CreditCard className="size-4" />
              Billing
            </TabsTrigger>
            <TabsTrigger value="inventory">
              <Boxes className="size-4" />
              Inventory
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
            <div className="space-y-5">
              <BrandingPanel org={org} />
              <TestimonialsPanel org={org} />
            </div>
          </TabsContent>
          <TabsContent value="pricing">
            <div className="space-y-5">
              <PricingPanel org={org} />
              <CancellationPolicyPanel />
            </div>
          </TabsContent>
          <TabsContent value="team">
            <div className="space-y-5">
              <TeamPanel />
              <EngineerProfilesPanel />
            </div>
          </TabsContent>
          <TabsContent value="integrations">
            <div className="space-y-5">
              <IntegrationsPanel />
              <div className="pt-2">
                <h2 className="font-grotesk text-base font-semibold text-bone">AI receptionist</h2>
                <p className="text-sm text-steel">
                  Never miss a booking inquiry - auto-reply to inbound texts with your booking link.
                </p>
              </div>
              <AiReceptionistPanel org={org} />
            </div>
          </TabsContent>
          <TabsContent value="memberships">
            <MembershipsPanel />
          </TabsContent>
          <TabsContent value="billing">
            <BillingPanel org={org} />
          </TabsContent>
          <TabsContent value="inventory">
            <InventoryImportPanel />
          </TabsContent>
          <TabsContent value="data">
            <div className="space-y-4">
              <UsagePanel />
              <ExportPanel />
              <DataPanel />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
