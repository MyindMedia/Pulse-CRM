"use client";

import type { ReactNode } from "react";
import { TodayBoard } from "@/components/today/today-board";
import { KpiStats } from "@/components/dashboard/kpi-stats";
import { RevenueChartCard } from "@/components/dashboard/revenue-chart-card";
import { UpcomingSessionsCard } from "@/components/dashboard/upcoming-sessions-card";
import { ActivityCard } from "@/components/dashboard/activity-card";
import {
  PipelineChartCard,
  ServiceChartCard,
  CatalogChartCard,
  InsightsCard,
  RecoveredCard,
} from "@/components/dashboard/chart-cards";
import { PulseAiPanel } from "@/components/ai/pulse-ai-panel";
import { OpsAutopilotPanel } from "@/components/ai/ops-autopilot-panel";
import { Section } from "@/components/ui/page";

/* The dashboard widget catalog. Every tile the dashboard can show lives here;
   the customizable grid renders from this list in the user's saved order.
   Spans map onto the 4-column grid. Adding a widget = adding an entry. */

export type WidgetSpan = "full" | "wide" | "half" | "tile";

export type DashboardWidgetDef = {
  key: string;
  title: string;
  blurb: string;
  span: WidgetSpan;
  /** Hidden until the user adds it from the tray. */
  defaultHidden?: boolean;
  render: () => ReactNode;
};

export const SPAN_CLASS: Record<WidgetSpan, string> = {
  full: "col-span-full",
  wide: "col-span-full lg:col-span-3",
  half: "col-span-full sm:col-span-2",
  tile: "col-span-full sm:col-span-1",
};

export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  {
    key: "today",
    title: "Today board",
    blurb: "Live counters, rooms right now, timeline, arrivals, balances, on shift",
    span: "full",
    render: () => <TodayBoard />,
  },
  {
    key: "kpis",
    title: "Studio KPIs",
    blurb: "Revenue, sessions, pipeline, outstanding, leads",
    span: "full",
    render: () => <KpiStats />,
  },
  {
    key: "revenue",
    title: "Revenue chart",
    blurb: "Collected per month with range select",
    span: "wide",
    render: () => <RevenueChartCard />,
  },
  {
    key: "insights",
    title: "Pulse insights",
    blurb: "AI nudges from your studio's data",
    span: "tile",
    render: () => <InsightsCard />,
  },
  {
    key: "pipeline",
    title: "Pipeline by stage",
    blurb: "Open opportunities distribution",
    span: "tile",
    render: () => <PipelineChartCard />,
  },
  {
    key: "services",
    title: "Bookings by service",
    blurb: "Where session time goes",
    span: "tile",
    render: () => <ServiceChartCard />,
  },
  {
    key: "recovered",
    title: "Recovered by Pulse",
    blurb: "Deposits, fees and no-shows Pulse recovered",
    span: "tile",
    render: () => <RecoveredCard />,
  },
  {
    key: "catalog",
    title: "Catalog by stage",
    blurb: "Songs in production distribution",
    span: "tile",
    defaultHidden: true, // removed from the default view; re-addable from the tray
    render: () => <CatalogChartCard />,
  },
  {
    key: "upcoming",
    title: "Upcoming sessions",
    blurb: "Confirmed and tentative work on the books",
    span: "half",
    render: () => <UpcomingSessionsCard />,
  },
  {
    key: "activity",
    title: "Activity",
    blurb: "Everything the studio just did",
    span: "half",
    render: () => <ActivityCard />,
  },
  {
    key: "autopilot",
    title: "Ops Autopilot",
    blurb: "The deterministic ops layer's proposed actions",
    span: "half",
    render: () => (
      <Section title="Ops Autopilot">
        <OpsAutopilotPanel />
      </Section>
    ),
  },
  {
    key: "pulse-ai",
    title: "Pulse AI",
    blurb: "Ask the studio agent anything",
    span: "half",
    render: () => (
      <Section title="Pulse AI">
        <PulseAiPanel />
      </Section>
    ),
  },
];

export const WIDGET_KEYS = DASHBOARD_WIDGETS.map((w) => w.key);
export const DEFAULT_HIDDEN = DASHBOARD_WIDGETS.filter((w) => w.defaultHidden).map((w) => w.key);
