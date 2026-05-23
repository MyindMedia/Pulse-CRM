import {
  LayoutDashboard,
  Music2,
  Users,
  KanbanSquare,
  Inbox,
  CalendarDays,
  Ticket,
  Receipt,
  BarChart3,
  Rocket,
  ScrollText,
  SlidersHorizontal,
  Boxes,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short description - used in the command palette. */
  blurb: string;
};

/* The primary navigation. Songs is listed first under Dashboard because the
   song record is the spine of Pulse - everything else hangs off it. */
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, blurb: "Studio at a glance" },
  { label: "Songs", href: "/songs", icon: Music2, blurb: "The catalog - every record in flight" },
  { label: "Roster", href: "/roster", icon: Users, blurb: "Artists, producers and labels" },
  { label: "Pipeline", href: "/pipeline", icon: KanbanSquare, blurb: "Inquiries to booked work" },
  { label: "Inbox", href: "/inbox", icon: Inbox, blurb: "AI agent drafts awaiting your approval" },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, blurb: "Sessions and room bookings" },
  { label: "Bookings", href: "/bookings", icon: Ticket, blurb: "Online bookings, deposits and holds" },
  { label: "Payments", href: "/payments", icon: Receipt, blurb: "Invoices and cash flow" },
  { label: "Reports", href: "/reports", icon: BarChart3, blurb: "Revenue command center - where money leaks" },
  { label: "Releases", href: "/releases", icon: Rocket, blurb: "Rollout campaigns" },
  { label: "Licensing", href: "/licensing", icon: ScrollText, blurb: "Sync placements and beat licenses" },
  { label: "Studio", href: "/studio", icon: SlidersHorizontal, blurb: "Rooms and the team" },
  { label: "Inventory", href: "/inventory", icon: Boxes, blurb: "Equipment assets and their value" },
  { label: "Settings", href: "/settings", icon: Settings, blurb: "Workspace configuration" },
];

/** Resolve the nav item whose route is active for a given pathname. */
export function activeNav(pathname: string): NavItem | undefined {
  return NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
