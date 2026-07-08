/* Toggleable nav features. The agency can disable any of these per sub-account
   (stored on orgs.disabledFeatures); Dashboard and Settings are core and are
   always on. Keys are matched against NavItem.feature in src/lib/nav.ts. */
export type FeatureKey =
  | "agent"
  | "songs"
  | "clients"
  | "roster"
  | "pipeline"
  | "inbox"
  | "calendar"
  | "schedule"
  | "bookings"
  | "payments"
  | "reports"
  | "releases"
  | "licensing"
  | "studio"
  | "inventory"
  | "software";

export const TOGGLEABLE_FEATURES: { key: FeatureKey; label: string; blurb: string }[] = [
  { key: "agent", label: "Agent", blurb: "AI studio operations manager" },
  { key: "songs", label: "Songs", blurb: "Song catalog" },
  { key: "clients", label: "Clients", blurb: "Client directory" },
  { key: "roster", label: "Roster", blurb: "Artist roster" },
  { key: "pipeline", label: "Pipeline", blurb: "Leads pipeline" },
  { key: "inbox", label: "Inbox", blurb: "Agent approval inbox" },
  { key: "calendar", label: "Calendar", blurb: "Sessions calendar" },
  { key: "schedule", label: "Schedule", blurb: "Staff shifts" },
  { key: "bookings", label: "Bookings", blurb: "Online bookings + deposits" },
  { key: "payments", label: "Payments", blurb: "Invoices + cash flow" },
  { key: "reports", label: "Reports", blurb: "Revenue command center" },
  { key: "releases", label: "Releases", blurb: "Rollout campaigns" },
  { key: "licensing", label: "Licensing", blurb: "Sync + beat licenses" },
  { key: "studio", label: "Studio", blurb: "Rooms + team" },
  { key: "inventory", label: "Inventory", blurb: "Equipment assets" },
  { key: "software", label: "Software", blurb: "Software + licenses" },
];

/** Map a route path to its feature key (for route-level gating), or null when
 *  the route is always available. */
export function featureForPath(pathname: string): FeatureKey | null {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  // /roster powers both "Clients" and "Roster" nav items; it's available if
  // EITHER is enabled, so route-gating keys it to "clients" (the broader one).
  const map: Record<string, FeatureKey> = {
    agent: "agent",
    songs: "songs",
    roster: "clients",
    pipeline: "pipeline",
    inbox: "inbox",
    calendar: "calendar",
    schedule: "schedule",
    clock: "schedule", // the staff time clock rides the Schedule feature

    bookings: "bookings",
    payments: "payments",
    reports: "reports",
    releases: "releases",
    licensing: "licensing",
    studio: "studio",
    inventory: "inventory",
    software: "software",
  };
  return map[seg] ?? null;
}
