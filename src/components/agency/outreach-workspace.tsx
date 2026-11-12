"use client";

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity, Communications, Drafts, Links, Meetings, Overview, Settings, TestOnlyBanner,
} from "@/components/agency/outreach-panels";
import { OutreachInbox } from "@/components/agency/outreach-inbox";
import { Discover, Dms } from "@/components/agency/outreach-growth";
import { ProspectsToZuops } from "@/components/agency/crm/prospects-zuops";

/* The prospecting workspace (what was the Outreach page), now the CRM's
   Prospects tab. Studios being prospected before they are leads in Zuops. The
   tabs read Convex only; the one card above them (ProspectsToZuops) adds
   prospects to Zuops as leads, after a confirm, with no phone number. The engine behind it (sequences,
   drafts, sending from Lawrence or MaxB with their signatures, approvals) is
   unchanged. The inner tab is plain state, never the URL hash: the CRM page owns
   the hash. */

export const PROSPECTING_SECTIONS = [
  ["overview", "Overview"],
  ["discover", "Discover"],
  ["prospects", "Contacts"],
  ["dms", "DMs"],
  ["drafts", "Review queue"],
  ["communications", "Communications"],
  ["meetings", "Meetings"],
  ["links", "Links & calendars"],
  ["activity", "Activity"],
  ["settings", "Settings"],
] as const;

export function OutreachWorkspace() {
  const overview = useQuery(api.outreach.overview, {});
  // Opens on the contacts (owner report 2026-11-11: Overview first hid them).
  const [tab, setTab] = React.useState("prospects");
  // The studio open in the Prospects inbox survives a trip to the Review queue.
  const [prospect, setProspect] = React.useState<Id<"outreachProspects"> | null>(null);
  return (
    <div className="space-y-6">
      {overview && <TestOnlyBanner paused={overview.paused} mode={overview.mode} />}
      <ProspectsToZuops />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList aria-label="Prospecting sections">
          {PROSPECTING_SECTIONS.map(([id, label]) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="discover"><Discover /></TabsContent>
        <TabsContent value="prospects">
          <OutreachInbox selected={prospect} onSelect={setProspect} onOpenReviewQueue={() => setTab("drafts")} />
        </TabsContent>
        <TabsContent value="dms"><Dms /></TabsContent>
        <TabsContent value="drafts"><Drafts /></TabsContent>
        <TabsContent value="communications"><Communications /></TabsContent>
        <TabsContent value="meetings"><Meetings /></TabsContent>
        <TabsContent value="links"><Links /></TabsContent>
        <TabsContent value="activity"><Activity /></TabsContent>
        <TabsContent value="settings"><Settings /></TabsContent>
      </Tabs>
    </div>
  );
}
