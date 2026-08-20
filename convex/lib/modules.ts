import {
  PLAN_LIMITS,
  SELLABLE_TIERS,
  type CapabilityKey,
  type TierKey,
} from "./plans";

/* ============================================================
   Module registry - the switchboard.

   One row per gateable module in the product. This is the list the
   agency console renders, the list a studio owner can hide things
   from, and the vocabulary `orgs.disabledFeatures` is written in.

   Two different questions, never confused:
     tier      - what this workspace BOUGHT.       (plans.ts)
     toggle    - what the operator SWITCHED OFF.   (this file)

   A toggle can only ever subtract from a tier. Switching a module on
   cannot grant a capability the plan does not include - see
   effectiveDisabledFeatures in entitlements.ts.
   ============================================================ */

/** The fourteen areas, matching the feature catalog exactly so the
 *  switchboard and the catalog are read as one document. */
export type ModuleArea =
  | "bookings"
  | "money"
  | "risk"
  | "clients"
  | "staff"
  | "floor"
  | "gear"
  | "catalog"
  | "ai"
  | "comms"
  | "reporting"
  | "brand"
  | "agency"
  | "platform";

export const AREA_LABELS: Record<ModuleArea, string> = {
  bookings: "Bookings & calendar",
  money: "Money",
  risk: "No-show & risk",
  clients: "Clients & CRM",
  staff: "Staff & scheduling",
  floor: "Floor & front desk",
  gear: "Gear, rooms & patch",
  catalog: "Music & catalog",
  ai: "The AI layer",
  comms: "Communication",
  reporting: "Reporting",
  brand: "Branding & white label",
  agency: "Agency & multi-studio",
  platform: "Platform & security",
};

/** Display order for the areas in the switchboard. */
export const AREA_ORDER: ModuleArea[] = [
  "bookings", "money", "risk", "clients", "staff", "floor",
  "gear", "catalog", "ai", "comms", "reporting", "brand",
  "agency", "platform",
];

export type ModuleDef = {
  key: CapabilityKey;
  label: string;
  blurb: string;
  area: ModuleArea;
  /** True when the module owns a nav destination (participates in route gating). */
  nav: boolean;
  /**
   * Core modules cannot be switched off. Pulse without a way to take a
   * booking and see it on a calendar is not Pulse; every other module is
   * the operator's call.
   */
  core?: true;
};

export const MODULES: ModuleDef[] = [
  // ── Bookings & calendar ──
  { key: "bookings", label: "Bookings", area: "bookings", nav: true, core: true,
    blurb: "Public booking page, deposits, add-ons, waitlist" },
  { key: "calendar", label: "Calendar", area: "bookings", nav: true, core: true,
    blurb: "Sessions calendar and the session sheet" },
  { key: "discountCodes", label: "Discount codes", area: "bookings", nav: false,
    blurb: "Owner-issued and AI-generated codes at checkout" },
  { key: "calendarSync", label: "Calendar sync", area: "bookings", nav: false,
    blurb: "Two-way Google and external calendar sync" },

  // ── Money ──
  { key: "payments", label: "Payments", area: "money", nav: true,
    blurb: "Invoices, payment ledger and cash flow" },
  { key: "cardOnFile", label: "Card on file", area: "money", nav: false,
    blurb: "Saved payment method and off-session charging" },
  { key: "dunning", label: "Dunning ladder", area: "money", nav: false,
    blurb: "Automatic 3, 7 and 14 day invoice chasing" },
  { key: "packages", label: "Hour packages", area: "money", nav: false,
    blurb: "Prepaid blocks of studio time drawn down as credits" },
  { key: "memberships", label: "Memberships", area: "money", nav: false,
    blurb: "Recurring plans with a public subscribe page" },
  { key: "expenses", label: "Expenses", area: "money", nav: false,
    blurb: "Costs recorded against the studio" },
  { key: "profitability", label: "Profitability", area: "money", nav: false,
    blurb: "What each room and session actually cleared" },

  // ── No-show & risk ──
  { key: "noShowShield", label: "No-show shield", area: "risk", nav: false,
    blurb: "Cancellation policy, deposit forfeit and no-show fees" },

  // ── Clients & CRM ──
  { key: "clients", label: "Clients", area: "clients", nav: true,
    blurb: "Client, artist and lead directory with full history" },
  { key: "pipeline", label: "Pipeline", area: "clients", nav: true,
    blurb: "Lead pipeline and opportunity tracking" },
  { key: "clientPortal", label: "Client portal", area: "clients", nav: false,
    blurb: "Magic-link portal to rebook, pay and download mixes" },
  { key: "reviewsReferrals", label: "Reviews & referrals", area: "clients", nav: false,
    blurb: "Post-session review request and the referral loop" },

  // ── Staff & scheduling ──
  { key: "schedule", label: "Schedule", area: "staff", nav: true,
    blurb: "Shift grid, availability and time off" },
  { key: "timeClock", label: "Time clock", area: "staff", nav: false,
    blurb: "Self-service clock in and out from a phone" },
  { key: "payroll", label: "Payroll", area: "staff", nav: false,
    blurb: "Hours against rates, engineer cuts, pay periods" },

  // ── Floor & front desk ──
  { key: "studio", label: "Studio", area: "floor", nav: true,
    blurb: "Rooms and team" },
  { key: "visitors", label: "Visitors", area: "floor", nav: true,
    blurb: "Front-desk guest log and QR check-in" },

  // ── Gear, rooms & patch ──
  { key: "inventory", label: "Inventory", area: "gear", nav: true,
    blurb: "Equipment assets with photos" },
  { key: "maintenance", label: "Maintenance", area: "gear", nav: false,
    blurb: "What needs servicing, and what has been" },
  { key: "rentals", label: "Rentals", area: "gear", nav: false,
    blurb: "Gear rented out, tracked and billed" },
  { key: "patch", label: "Patch bay", area: "gear", nav: true,
    blurb: "Signal routing, devices, ports and cable management" },
  { key: "software", label: "Software", area: "gear", nav: true,
    blurb: "Plugin and DAW licenses with renewal costs" },

  // ── Music & catalog ──
  { key: "songs", label: "Songs", area: "catalog", nav: true,
    blurb: "Song catalog, cover art and deliverables" },
  { key: "splitSheets", label: "Split sheets", area: "catalog", nav: false,
    blurb: "Ownership splits with real e-signatures" },
  { key: "releases", label: "Releases", area: "catalog", nav: true,
    blurb: "Rollout campaigns" },
  { key: "licensing", label: "Licensing", area: "catalog", nav: true,
    blurb: "Sync and beat licenses, rights export" },

  // ── The AI layer ──
  { key: "agent", label: "Pulse Agent", area: "ai", nav: true,
    blurb: "The AI studio operations manager" },
  { key: "inbox", label: "Approval inbox", area: "ai", nav: true,
    blurb: "Everything the agent is waiting on a human for" },
  { key: "aiReceptionist", label: "AI receptionist", area: "ai", nav: false,
    blurb: "24/7 auto-reply to inbound booking texts" },
  { key: "aiAutonomy", label: "Agent autonomy", area: "ai", nav: false,
    blurb: "Low-risk reminders run without an approval" },

  // ── Communication ──
  { key: "smsFlows", label: "SMS & reminders", area: "comms", nav: false,
    blurb: "Confirmations and the 48h / 24h / 2h reminder ladder" },

  // ── Reporting ──
  { key: "reports", label: "Reports", area: "reporting", nav: true,
    blurb: "Revenue command center and operating KPIs" },
  { key: "apiExports", label: "Data exports", area: "reporting", nav: false,
    blurb: "The studio's numbers, out, on demand" },

  // ── Branding & white label ──
  { key: "whiteLabelUi", label: "White-label UI", area: "brand", nav: false,
    blurb: "Their logo, palette, fonts and sign-in across the whole app" },
  { key: "customDomain", label: "Custom domain", area: "brand", nav: false,
    blurb: "The app on the studio's own address" },

  // ── Agency & multi-studio ──
  { key: "multiStudio", label: "Multi-studio", area: "agency", nav: false,
    blurb: "Run more than one studio from one console" },
];

/* ── Always-on rows ───────────────────────────────────────────
   Capabilities that exist but are not switchable: either platform
   guarantees that hold for every workspace, or agency-side surfaces
   that belong to the operator rather than to one sub-account.

   They are listed so the switchboard mirrors the feature catalog and
   nobody goes hunting for a switch that should not exist. They carry
   no CapabilityKey because nothing gates on them per workspace. */
export type AlwaysOnDef = {
  id: string;
  label: string;
  blurb: string;
  area: ModuleArea;
  /** "always" holds for every plan; "plan" ships with a specific tier. */
  kind: "always" | "plan";
  tier?: TierKey;
};

export const ALWAYS_ON: AlwaysOnDef[] = [
  // ── Agency & multi-studio ──
  { id: "agencyConsole", area: "agency", kind: "plan", tier: "label",
    label: "Agency console", blurb: "Every studio, its health and its numbers, from one screen" },
  { id: "studioInvites", area: "agency", kind: "plan", tier: "label",
    label: "Studio invites & onboarding", blurb: "Invite by email, branded onboarding, taking bookings the same day" },
  { id: "priceBook", area: "agency", kind: "plan", tier: "label",
    label: "Price book & rebilling", blurb: "The plans an operator sells on, with trials and per-account pricing" },
  { id: "scopedStaff", area: "agency", kind: "plan", tier: "label",
    label: "Scoped agency staff", blurb: "Team members who only see the studios they are assigned" },
  { id: "crossApprovals", area: "agency", kind: "plan", tier: "label",
    label: "Cross-studio approvals", blurb: "Everything waiting on a human across the fleet, in one queue" },
  { id: "siteImport", area: "agency", kind: "plan", tier: "label",
    label: "Import from their website", blurb: "Pull a new studio's details off the site they already have" },
  { id: "demoData", area: "agency", kind: "plan", tier: "label",
    label: "Demo data switch", blurb: "Fill a sub-account with realistic data for a pitch, then clear it" },

  // ── Platform & security ──
  { id: "tenantIsolation", area: "platform", kind: "always",
    label: "Tenant isolation", blurb: "Every query scoped to one studio; cross-studio access denied at the engine" },
  { id: "accessEngine", area: "platform", kind: "always",
    label: "Access engine", blurb: "One resolver, one permission check, one audit hook, on every function" },
  { id: "rbac", area: "platform", kind: "always",
    label: "Role permissions", blurb: "Owner, manager, engineer, staff and guest, each seeing their own surface" },
  { id: "entitlementGate", area: "platform", kind: "always",
    label: "Plan & module gate", blurb: "What was bought and switched on is enforced server-side, not hidden in the nav" },
  { id: "auditTrail", area: "platform", kind: "always",
    label: "Audit trail", blurb: "Append-only records of refunds, approvals, invites and signatures" },
  { id: "dataRights", area: "platform", kind: "always",
    label: "GDPR export & erasure", blurb: "The two rights a studio has to honor for its clients" },
  { id: "guestGrants", area: "platform", kind: "always",
    label: "Expiring guest links", blurb: "Scoped, time-boxed, revocable access for outside collaborators" },
  { id: "usageMetering", area: "platform", kind: "always",
    label: "Usage metering", blurb: "Credits, storage and grants counted and capped per plan" },
];

const BY_KEY = new Map<string, ModuleDef>(MODULES.map((m) => [m.key, m]));

export function moduleFor(key: string): ModuleDef | null {
  return BY_KEY.get(key) ?? null;
}

/** Keys an operator is allowed to switch off. Core modules are excluded. */
export const TOGGLEABLE_KEYS: CapabilityKey[] = MODULES
  .filter((m) => !m.core)
  .map((m) => m.key);

const TOGGLEABLE_SET = new Set<string>(TOGGLEABLE_KEYS);

export function isToggleable(key: string): boolean {
  return TOGGLEABLE_SET.has(key);
}

/** Every key the registry knows, toggleable or not. */
export const MODULE_KEYS: CapabilityKey[] = MODULES.map((m) => m.key);
const MODULE_KEY_SET = new Set<string>(MODULE_KEYS);

export function isModuleKey(key: string): boolean {
  return MODULE_KEY_SET.has(key);
}

/** Nav-owning modules, for route and sidebar gating. */
export const NAV_MODULE_KEYS: CapabilityKey[] = MODULES
  .filter((m) => m.nav)
  .map((m) => m.key);

/** The cheapest sellable tier that includes a module, or null. */
export function tierForModule(key: CapabilityKey): TierKey | null {
  for (const t of SELLABLE_TIERS) {
    if (PLAN_LIMITS[t].capabilities.includes(key)) return t;
  }
  return null;
}

/** Modules grouped by area, in display order, with the tier that unlocks each,
 *  plus the always-on rows for that area. Every one of the fourteen areas is
 *  returned, so the switchboard and the feature catalog stay the same shape. */
export function moduleBoard(): {
  area: ModuleArea;
  label: string;
  modules: (ModuleDef & { tier: TierKey | null })[];
  alwaysOn: AlwaysOnDef[];
}[] {
  return AREA_ORDER.map((area) => ({
    area,
    label: AREA_LABELS[area],
    modules: MODULES
      .filter((m) => m.area === area)
      .map((m) => ({ ...m, tier: tierForModule(m.key) })),
    alwaysOn: ALWAYS_ON.filter((a) => a.area === area),
  }));
}
