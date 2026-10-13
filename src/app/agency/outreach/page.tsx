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

export default function OutreachPage() {
  const overview = useQuery(api.outreach.overview, {});
  const [tab, setTab] = React.useState("overview");
  // The studio open in the Prospects inbox survives a trip to the Review queue.
  const [prospect, setProspect] = React.useState<Id<"outreachProspects"> | null>(null);
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="chrome-display text-2xl leading-[0.95] text-bone">Outreach</h1>
        <p className="text-sm text-steel">
          Outbound email, meetings, booking links and calendars in one place.
        </p>
      </header>
      {overview && <TestOnlyBanner paused={overview.paused} mode={overview.mode} />}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList aria-label="Outreach sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="discover">Discover</TabsTrigger>
          <TabsTrigger value="prospects">Prospects</TabsTrigger>
          <TabsTrigger value="dms">DMs</TabsTrigger>
          <TabsTrigger value="drafts">Review queue</TabsTrigger>
          <TabsTrigger value="communications">Communications</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="links">Links &amp; calendars</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
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
