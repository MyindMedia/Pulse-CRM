import {
  AlarmClock,
  LayoutDashboard,
  Sparkles,
  Music2,
  Scale,
  Users,
  MessagesSquare,
  KanbanSquare,
  Inbox,
  CalendarDays,
  CalendarClock,
  Ticket,
  Receipt,
  UserCheck,
  Wallet,
  Clock3,
  BarChart3,
  Rocket,
  ScrollText,
  SlidersHorizontal,
  Boxes,
  Plug,
  Tags,
  Package,
  AppWindow,
  Settings,
  Megaphone,
  History,
  Landmark,
  FolderOpen,
  ListChecks,
  Disc3,
  Coins,
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
  /** Sidebar section (NAV_GROUPS). */
  group: NavGroup;
};

/* The sidebar's sections, in order (the kit groups its rail the same way). */
export type NavGroup = "studio" | "music" | "business" | "system";
export const NAV_GROUPS: ReadonlyArray<{ key: NavGroup; label: string }> = [
  { key: "studio", label: "Studio" },
  { key: "music", label: "Music" },
  { key: "business", label: "Business" },
  { key: "system", label: "System" },
];

/* The primary navigation. Songs is listed first under Dashboard because the
   song record is the spine of Pulse - everything else hangs off it. */
export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, blurb: "The command center - what's happening right now + the studio at a glance", group: "studio" },
  { label: "Bookings", href: "/bookings", icon: Ticket, blurb: "Online bookings, deposits and holds", feature: "bookings", group: "studio" },
  { label: "Agent", href: "/agent", icon: Sparkles, blurb: "Your AI studio operations manager", feature: "agent", group: "system" },
  { label: "Songs", href: "/songs", icon: Music2, blurb: "The catalog - every record in flight", feature: "songs", group: "music" },
  { label: "Projects", href: "/projects", icon: ListChecks, blurb: "Post-production: tracking to delivery, tasks, owners and due dates", feature: "projects", capability: "projects.read", group: "music" },
  { label: "Split sheets", href: "/splits", icon: Scale, blurb: "Who owns what share of each song, signed by everyone on it", capability: "splitsheet.read", group: "music" },
  { label: "Royalties", href: "/royalties", icon: Coins, blurb: "Distributor statements divided by the signed split sheets", feature: "royalties", capability: "invoices.read", group: "music" },
  { label: "Finished mixes", href: "/mixes", icon: Disc3, blurb: "Numbered mix and master versions, notes on each version, client approval", capability: "deliverables.read", group: "music" },
  { label: "Media library", href: "/library", icon: FolderOpen, blurb: "Every session, stem, mix, master and artwork file, with version history and approval", feature: "mediaLibrary", capability: "deliverables.read", group: "music" },
  { label: "Clients", href: "/roster", icon: Users, blurb: "Everyone the studio works with - artists, clients, leads", feature: "clients", group: "business" },
  { label: "Messages", href: "/messages", icon: MessagesSquare, blurb: "Every client conversation - texts, emails and portal messages in one place", feature: "clients", group: "business" },
  { label: "Pipeline", href: "/pipeline", icon: KanbanSquare, blurb: "Inquiries to booked work", feature: "pipeline", group: "business" },
  { label: "Inbox", href: "/inbox", icon: Inbox, blurb: "AI agent drafts awaiting your approval", feature: "inbox", group: "system" },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, blurb: "Sessions and room bookings", feature: "calendar", group: "studio" },
  { label: "Schedule", href: "/schedule", icon: CalendarClock, blurb: "Staff shifts - who's working, in which room", feature: "schedule", group: "studio" },
  { label: "Time Clock", href: "/clock", icon: AlarmClock, blurb: "Clock in and out - your hours and recent entries", feature: "schedule", group: "studio" },
  { label: "Visitors", href: "/visitors", icon: UserCheck, blurb: "Front-desk guest log - QR check-in, timestamps and outreach contacts", feature: "visitors", group: "studio" },
  { label: "Payments", href: "/payments", icon: Receipt, blurb: "Invoices and cash flow", feature: "payments", capability: "invoices.read", group: "business" },
  { label: "Packages", href: "/packages", icon: Package, blurb: "Prepaid hour blocks - sell studio time up front", capability: "invoices.read", group: "business" },
  { label: "Expenses", href: "/expenses", icon: Wallet, blurb: "Costs and profit - the other half of the books", capability: "insights.read", group: "business" },
  { label: "Banking", href: "/banking", icon: Landmark, blurb: "Bank and card accounts, synced - balances, transactions and reconciliation", capability: "insights.read", group: "business" },
  { label: "Payroll", href: "/payroll", icon: Clock3, blurb: "Staff hours, rates and labor cost", feature: "schedule", capability: "insights.read", group: "business" },
  { label: "Reports", href: "/reports", icon: BarChart3, blurb: "Revenue command center - where money leaks", feature: "reports", capability: "insights.read", group: "business" },
  { label: "Change log", href: "/changes", icon: History, blurb: "Who changed what, and when - patch, inventory, check-ins, checklists, bookings", capability: "audit.read", group: "system" },
  { label: "Releases", href: "/releases", icon: Rocket, blurb: "Rollout campaigns", feature: "releases", group: "music" },
  { label: "Marketing", href: "/marketing", icon: Megaphone, blurb: "Scheduled posts, promos and results", feature: "marketing", capability: "marketing.read", group: "business" },
  { label: "Licensing", href: "/licensing", icon: ScrollText, blurb: "Sync placements and beat licenses", feature: "licensing", group: "music" },
  { label: "Studio", href: "/studio", icon: SlidersHorizontal, blurb: "Rooms and the team", feature: "studio", group: "studio" },
  { label: "Inventory", href: "/inventory", icon: Boxes, blurb: "Equipment assets and their value", feature: "inventory", group: "studio" },
  { label: "Patch", href: "/patch", icon: Plug, blurb: "Signal routing and cable management - what is plugged into what", feature: "patch", capability: "patch.read", group: "studio" },
  { label: "Rentals", href: "/rentals", icon: Tags, blurb: "Gear clients can add to a booking, and rental pricing", feature: "inventory", group: "studio" },
  { label: "Software", href: "/software", icon: AppWindow, blurb: "DAWs, plugins and license management", feature: "software", group: "studio" },
  { label: "Settings", href: "/settings", icon: Settings, blurb: "Workspace configuration", capability: "branding.edit", group: "system" },
];

/** Resolve the nav item whose route is active for a given pathname. */
export function activeNav(pathname: string): NavItem | undefined {
  return NAV.filter((n) => pathname === n.href || pathname.startsWith(`${n.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
}
