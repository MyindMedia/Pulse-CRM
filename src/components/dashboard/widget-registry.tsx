"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { LiveSessionHero } from "@/components/dashboard/hw/live-hero";
import { MonthKpis } from "@/components/dashboard/hw/month-kpis";
import { RoomUtilization } from "@/components/dashboard/hw/room-utilization";
import { OpsManager } from "@/components/dashboard/hw/ops-manager";
import { TodaysSessions } from "@/components/dashboard/hw/todays-sessions";
import { DepositsFeed } from "@/components/dashboard/hw/deposits-feed";

/* Code splitting. The default overview's light tiles ship with the page; the
   revenue chart (visx) and every widget that starts in the Add widget tray
   load as their own chunks, so a cold load downloads only what the screen
   shows. Each placeholder holds the tile's footprint so nothing jumps when
   the chunk lands. */
function ChunkPlaceholder() {
  return <div aria-hidden className="pl-card min-h-[220px] flex-1 opacity-60" />;
}

const BookingRevenue = dynamic(
  () => import("@/components/dashboard/hw/booking-revenue").then((m) => m.BookingRevenue),
  { loading: () => <ChunkPlaceholder /> },
);
const TodayBoard = dynamic(
  () => import("@/components/today/today-board").then((m) => m.TodayBoard),
  { loading: () => <ChunkPlaceholder /> },
);
const ProjectsTodayCard = dynamic(
  () => import("@/components/projects/today-card").then((m) => m.ProjectsTodayCard),
  { loading: () => <ChunkPlaceholder /> },
);
const WrapUpCard = dynamic(
  () => import("@/components/dashboard/wrapup-card").then((m) => m.WrapUpCard),
  { loading: () => <ChunkPlaceholder /> },
);
const UpcomingSessionsCard = dynamic(
  () => import("@/components/dashboard/upcoming-sessions-card").then((m) => m.UpcomingSessionsCard),
  { loading: () => <ChunkPlaceholder /> },
);
const ActivityCard = dynamic(
  () => import("@/components/dashboard/activity-card").then((m) => m.ActivityCard),
  { loading: () => <ChunkPlaceholder /> },
);
const PipelineChartCard = dynamic(
  () => import("@/components/dashboard/chart-cards").then((m) => m.PipelineChartCard),
  { loading: () => <ChunkPlaceholder /> },
);
const ServiceChartCard = dynamic(
  () => import("@/components/dashboard/chart-cards").then((m) => m.ServiceChartCard),
  { loading: () => <ChunkPlaceholder /> },
);
const CatalogChartCard = dynamic(
  () => import("@/components/dashboard/chart-cards").then((m) => m.CatalogChartCard),
  { loading: () => <ChunkPlaceholder /> },
);
const InsightsCard = dynamic(
  () => import("@/components/dashboard/chart-cards").then((m) => m.InsightsCard),
  { loading: () => <ChunkPlaceholder /> },
);
const RecoveredCard = dynamic(
  () => import("@/components/dashboard/chart-cards").then((m) => m.RecoveredCard),
  { loading: () => <ChunkPlaceholder /> },
);
const PulseAiPanel = dynamic(
  () => import("@/components/ai/pulse-ai-panel").then((m) => m.PulseAiPanel),
  { loading: () => <ChunkPlaceholder /> },
);
const OpsAutopilotPanel = dynamic(
  () => import("@/components/ai/ops-autopilot-panel").then((m) => m.OpsAutopilotPanel),
  { loading: () => <ChunkPlaceholder /> },
);

/* The dashboard widget catalog. Every tile the dashboard can show lives here;
   the customizable grid renders from this list in the user's saved order.
   Spans map onto the 4-column grid. Adding a widget = adding an entry. */

/* Spans map onto a 40-column grid from md up (customizable-dashboard.tsx).
   hero/side and third-wide/third are the kit overview's proportions
   (pulse-overview.png: 670/434 and 404/336/340 px). */
export type WidgetSpan = "full" | "wide" | "half" | "tile" | "hero" | "side" | "third-wide" | "third";

export type DashboardWidgetDef = {
  key: string;
  title: string;
  blurb: string;
  span: WidgetSpan;
  /** Hidden until the user adds it from the tray. */
  defaultHidden?: boolean;
  /** False for composite boards that carry their own section titles. */
  titled?: boolean;
  /** Renders from the boot cache (its queries go through useSnapshotQuery),
   *  so the cold-load preview can show it. Others hold their place there. */
  bootSafe?: boolean;
  /** Capability the widget's data needs. Without it the widget is not
   *  rendered at all, so its query never runs (and never throws). */
  capability?: string;
  render: () => ReactNode;
};

export const SPAN_CLASS: Record<WidgetSpan, string> = {
  full: "col-span-full",
  wide: "col-span-full xl:col-span-30",
  half: "col-span-full xl:col-span-20",
  tile: "col-span-full md:col-span-20 xl:col-span-10",
  hero: "col-span-full xl:col-span-24",
  side: "col-span-full xl:col-span-16",
  "third-wide": "col-span-full md:col-span-20 xl:col-span-14",
  third: "col-span-full md:col-span-20 xl:col-span-13",
};

export const DASHBOARD_WIDGETS: DashboardWidgetDef[] = [
  /* ── The hardware overview (kit pulse-overview.png), the default layout ── */
  {
    key: "live",
    bootSafe: true,
    title: "Live now",
    blurb: "The session running now, or the next one, with its timer and keys",
    span: "hero",
    titled: false,
    render: () => <LiveSessionHero />,
  },
  {
    key: "kpis",
    bootSafe: true,
    title: "This month",
    blurb: "Revenue, booked hours, deposits held, outstanding",
    span: "side",
    titled: false,
    render: () => <MonthKpis />,
  },
  {
    key: "revenue",
    bootSafe: true,
    title: "Booking revenue",
    blurb: "Collected revenue over 30 days, 90 days or the year",
    span: "third-wide",
    titled: false,
    capability: "invoices.read",
    render: () => <BookingRevenue />,
  },
  {
    key: "rooms",
    bootSafe: true,
    title: "Room utilization",
    blurb: "How booked each room was over the last 30 days",
    span: "third",
    titled: false,
    capability: "insights.read",
    render: () => <RoomUtilization />,
  },
  {
    key: "ops",
    bootSafe: true,
    title: "Ops manager",
    blurb: "Pulse AI's top suggestions, to review or snooze",
    span: "third",
    titled: false,
    capability: "ops.action.approve",
    render: () => <OpsManager />,
  },
  {
    key: "today-sessions",
    bootSafe: true,
    title: "Today's sessions",
    blurb: "Every booking today with its room, engineer and status",
    span: "hero",
    titled: false,
    render: () => <TodaysSessions />,
  },
  {
    key: "deposits",
    bootSafe: true,
    title: "Deposits",
    blurb: "The deposits that cleared most recently",
    span: "side",
    titled: false,
    capability: "invoices.read",
    render: () => <DepositsFeed />,
  },
  /* ── Everything else: one click away in the Add widget tray ── */
  {
    key: "today",
    title: "Today board",
    blurb: "Live counters, rooms right now, timeline, arrivals, balances, on shift",
    span: "full",
    titled: false, // carries its own "Right now" / "Today's sessions" sections
    defaultHidden: true,
    render: () => <TodayBoard />,
  },
  {
    key: "wrapup",
    title: "Wrap-up & studio refresh",
    blurb: "Sessions ending soon: files, billing, gear, notes + room turnover checklist",
    span: "half",
    defaultHidden: true,
    render: () => <WrapUpCard />,
  },
  {
    key: "projects",
    title: "Projects",
    blurb: "Post-production work that is late or due soonest",
    span: "half",
    titled: false, // carries its own title so a studio without projects shows nothing
    defaultHidden: true,
    render: () => <ProjectsTodayCard />,
  },
  {
    key: "insights",
    title: "Pulse insights",
    blurb: "AI nudges from your studio's data",
    span: "tile",
    defaultHidden: true,
    render: () => <InsightsCard />,
  },
  {
    key: "pipeline",
    title: "Pipeline by stage",
    blurb: "Open opportunities distribution",
    span: "tile",
    defaultHidden: true,
    render: () => <PipelineChartCard />,
  },
  {
    key: "services",
    title: "Bookings by service",
    blurb: "Where session time goes",
    span: "tile",
    defaultHidden: true,
    render: () => <ServiceChartCard />,
  },
  {
    key: "recovered",
    title: "Recovered by Pulse",
    blurb: "Deposits, fees and no-shows Pulse recovered",
    span: "tile",
    defaultHidden: true,
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
    defaultHidden: true,
    render: () => <UpcomingSessionsCard />,
  },
  {
    key: "activity",
    title: "Activity",
    blurb: "Everything the studio just did",
    span: "half",
    defaultHidden: true,
    render: () => <ActivityCard />,
  },
  {
    key: "autopilot",
    title: "Ops Autopilot",
    blurb: "The deterministic ops layer's proposed actions",
    span: "half",
    defaultHidden: true,
    render: () => <OpsAutopilotPanel />,
  },
  {
    key: "pulse-ai",
    title: "Pulse Agent",
    blurb: "Ask the studio agent anything",
    span: "half",
    defaultHidden: true,
    render: () => <PulseAiPanel />,
  },
];

export const WIDGET_KEYS = DASHBOARD_WIDGETS.map((w) => w.key);
export const DEFAULT_HIDDEN = DASHBOARD_WIDGETS.filter((w) => w.defaultHidden).map((w) => w.key);
