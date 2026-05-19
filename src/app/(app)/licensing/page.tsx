"use client";

import { useState } from "react";
import { Music4, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PitchSyncDialog } from "@/components/licensing/pitch-sync-dialog";
import { SellLicenseDialog } from "@/components/licensing/sell-license-dialog";
import { SyncBoard } from "@/components/licensing/sync-board";
import { LicenseTable } from "@/components/licensing/license-table";

type Tab = "sync" | "licenses";

export default function LicensingPage() {
  const [tab, setTab] = useState<Tab>("sync");

  return (
    <div className="space-y-7">
      <PageHeader
        overline="Revenue"
        title="Licensing"
        description="Sync placements pitched to supervisors and beat licenses sold to artists — every deal on one board."
        actions={tab === "sync" ? <PitchSyncDialog /> : <SellLicenseDialog />}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-5">
        <TabsList>
          <TabsTrigger value="sync">
            <Music4 className="size-4" />
            Sync placements
          </TabsTrigger>
          <TabsTrigger value="licenses">
            <ScrollText className="size-4" />
            Beat licenses
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sync">
          <SyncBoard />
        </TabsContent>

        <TabsContent value="licenses">
          <LicenseTable />
        </TabsContent>
      </Tabs>
    </div>
  );
}
