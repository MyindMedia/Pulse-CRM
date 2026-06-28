import {
  LayoutDashboard,
  Sparkles,
  Music2,
  Mic2,
  Users,
  KanbanSquare,
  Inbox,
  CalendarDays,
  CalendarClock,
  Ticket,
  Receipt,
  BarChart3,
  Rocket,
  ScrollText,
  SlidersHorizontal,
  Boxes,
  Tags,
  AppWindow,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short description - used in the command palette. */
  blurb: string;
  /** Toggleable feature key (src/lib/features.ts). Omitted = always shown. */
  feature?: string;
  /** Capability required to see this item. Omitted = visible to every role.
      Mirrors the server policy; the page/query still enforces on its own. */
  capability?: string;
};

/* The primary navigation. Songs is listed first under Dashboard because the
   song record is the spine of Pulse - everything else hangs off it. */
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, blurb: "Studio at a glance" },
  { label: "Agent", href: "/agent", icon: Sparkles, blurb: "Your AI studio operations manager", feature: "agent" },
  { label: "Songs", href: "/songs", icon: Music2, blurb: "The catalog - every record in flight", feature: "songs" },
  { label: "Clients", href: "/roster", icon: Users, blurb: "Everyone the studio works with - artists, clients, leads", feature: "clients" },
  { label: "Roster", href: "/roster?segment=artists", icon: Mic2, blurb: "The artists you develop and work with", feature: "roster" },
  { label: "Pipeline", href: "/pipeline", icon: KanbanSquare, blurb: "Inquiries to booked work", feature: "pipeline" },
  { label: "Inbox", href: "/inbox", icon: Inbox, blurb: "AI agent drafts awaiting your approval", feature: "inbox" },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, blurb: "Sessions and room bookings", feature: "calendar" },
  { label: "Schedule", href: "/schedule", icon: CalendarClock, blurb: "Staff shifts - who's working, in which room", feature: "schedule" },
  { label: "Bookings", href: "/bookings", icon: Ticket, blurb: "Online bookings, deposits and holds", feature: "bookings" },
  { label: "Payments", href: "/payments", icon: Receipt, blurb: "Invoices and cash flow", feature: "payments", capability: "invoices.read" },
  { label: "Reports", href: "/reports", icon: BarChart3, blurb: "Revenue command center - where money leaks", feature: "reports", capability: "insights.read" },
  { label: "Releases", href: "/releases", icon: Rocket, blurb: "Rollout campaigns", feature: "releases" },
  { label: "Licensing", href: "/licensing", icon: ScrollText, blurb: "Sync placements and beat licenses", feature: "licensing" },
  { label: "Studio", href: "/studio", icon: SlidersHorizontal, blurb: "Rooms and the team", feature: "studio" },
  { label: "Inventory", href: "/inventory", icon: Boxes, blurb: "Equipment assets and their value", feature: "inventory" },
  { label: "Rentals", href: "/rentals", icon: Tags, blurb: "Gear clients can add to a booking, and rental pricing", feature: "inventory" },
  { label: "Software", href: "/software", icon: AppWindow, blurb: "DAWs, plugins and license management", feature: "software" },
  { label: "Settings", href: "/settings", icon: Settings, blurb: "Workspace configuration", capability: "branding.edit" },
];

/** Resolve the nav item whose route is active for a given pathname. */
export function activeNav(pathname: string): NavItem | undefined {
  return NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
