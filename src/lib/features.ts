import { MODULES, NAV_MODULE_KEYS } from "@convex/lib/modules";

/* Nav feature keys, derived from the one module registry in
   convex/lib/modules.ts. Kept as a thin re-export so nav gating, the
   switchboard and the server entitlement check can never drift apart:
   there is exactly one list of modules in this codebase. */

export type FeatureKey = (typeof NAV_MODULE_KEYS)[number];

export const TOGGLEABLE_FEATURES: { key: string; label: string; blurb: string }[] =
  MODULES.filter((m) => m.nav && !m.core).map((m) => ({
    key: m.key,
    label: m.label,
    blurb: m.blurb,
  }));

/** Map a route path to its feature key (for route-level gating), or null when
 *  the route is always available. */
export function featureForPath(pathname: string): FeatureKey | null {
  const seg = pathname.split("/").filter(Boolean)[0] ?? "";
  // /roster is the "Clients" surface (artists, clients, and leads in one
  // directory) - the separate Roster nav item was consolidated into it.
  const map: Record<string, FeatureKey> = {
    agent: "agent",
    brief: "bookings",
    songs: "songs",
    roster: "clients",
    pipeline: "pipeline",
    inbox: "inbox",
    calendar: "calendar",
    schedule: "schedule",
    clock: "schedule", // the staff time clock rides the Schedule feature
    visitors: "visitors",

    bookings: "bookings",
    payments: "payments",
    reports: "reports",
    releases: "releases",
    licensing: "licensing",
    studio: "studio",
    inventory: "inventory",
    software: "software",
    patch: "patch",
  };
  return map[seg] ?? null;
}
