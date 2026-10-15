/**
 * The first URL segment of every route in the authenticated app
 * (src/app/(app)/*). The cached first-paint theme (src/lib/boot-cache.ts) and
 * the root loader's app chassis (src/app/loading.tsx) apply only here: the
 * public pages (/book, /visit, /kiosk...) carry their own studio's brand.
 * boot-cache.test.ts fails if this list and the folder drift apart. A module
 * of its own because the root loader ships with every page.
 */
export const APP_ROUTE_SEGMENTS = [
  "agent", "banking", "bookings", "brief", "calendar", "changes", "clock", "dashboard", "expenses",
  "feature-requests", "inbox", "inventory", "library", "licensing", "marketing", "mixes", "packages",
  "patch", "payments", "payroll", "pipeline", "projects", "releases", "rentals", "reports", "roster",
  "schedule", "settings", "software", "songs", "studio", "today", "visitors",
] as const;
