"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page";
import { UnpaidAgingReport } from "@/components/reports/unpaid-aging";
import { RoomUtilizationReport } from "@/components/reports/room-utilization";
import { DormantClientsReport } from "@/components/reports/dormant-clients";
import { NoShowRiskReport } from "@/components/reports/no-show-risk";
import { LeadSourceRoiReport } from "@/components/reports/lead-source-roi";

const TABS = [
  { value: "aging", label: "Aging" },
  { value: "utilization", label: "Utilization" },
  { value: "dormant", label: "Dormant" },
  { value: "risk", label: "No-show risk" },
  { value: "sources", label: "Lead ROI" },
];

export default function ReportsPage() {
  return (
    <div className="space-y-7">
      <PageHeader
        overline="Revenue Command Center"
        title="Reports"
        description="Where the money is - unpaid balances, room utilization, dormant clients, no-show risk and which lead sources actually pay off."
      />

      <Tabs defaultValue="aging" className="space-y-5">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="aging">
          <UnpaidAgingReport />
        </TabsContent>
        <TabsContent value="utilization">
          <RoomUtilizationReport />
        </TabsContent>
        <TabsContent value="dormant">
          <DormantClientsReport />
        </TabsContent>
        <TabsContent value="risk">
          <NoShowRiskReport />
        </TabsContent>
        <TabsContent value="sources">
          <LeadSourceRoiReport />
        </TabsContent>
      </Tabs>
    </div>
  );
}
