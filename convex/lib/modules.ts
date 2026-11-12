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
  clients: "Clients",
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
    blurb: "Codes you issue, plus suggested codes for quiet hours that you approve" },
  { key: "calendarSync", label: "Calendar sync", area: "bookings", nav: false,
    blurb: "Two-way Google sync, other calendars shown read-only on the room page" },

  // ── Money ──
  { key: "payments", label: "Payments", area: "money", nav: true,
    blurb: "Invoices, payment ledger and cash flow" },
  { key: "cardOnFile", label: "Card on file", area: "money", nav: false,
    blurb: "Not ready yet: saving a card Pulse can charge later" },
  { key: "dunning", label: "Dunning ladder", area: "money", nav: false,
    blurb: "Automatic 3, 7 and 14 day invoice chasing" },
  { key: "packages", label: "Hour packages", area: "money", nav: false,
    blurb: "Set up prepaid blocks and draw hours down from a client's credit" },
  { key: "memberships", label: "Memberships", area: "money", nav: false,
    blurb: "Recurring plans with a public subscribe page" },
  { key: "expenses", label: "Expenses", area: "money", nav: false,
    blurb: "Costs recorded against the studio" },
  { key: "profitability", label: "Profitability", area: "money", nav: false,
    blurb: "A profit score for the studio and the levers that would raise it" },

  // ── No-show & risk ──
  { key: "noShowShield", label: "No-show shield", area: "risk", nav: false,
    blurb: "Cancellation policy, kept deposits and drafted no-show fee bills" },

  // ── Clients ──
  { key: "clients", label: "Clients", area: "clients", nav: true,
    blurb: "Client, artist and lead directory with full history" },
  { key: "pipeline", label: "Pipeline", area: "clients", nav: true,
    blurb: "Lead pipeline and opportunity tracking" },
  { key: "clientPortal", label: "Client portal", area: "clients", nav: false,
    blurb: "Magic-link portal to rebook, pay and download mixes" },
  { key: "reviewsReferrals", label: "Reviews & referrals", area: "clients", nav: false,
    blurb: "Post-session review requests" },

  // ── Staff & scheduling ──
  { key: "schedule", label: "Schedule", area: "staff", nav: true,
    blurb: "Shift grid, availability and time off" },
  { key: "timeClock", label: "Time clock", area: "staff", nav: false,
    blurb: "Self-service clock in and out from a phone" },
  { key: "payroll", label: "Payroll", area: "staff", nav: false,
    blurb: "Hours against rates, pay periods, engineer cuts you approve" },

  // ── Floor & front desk ──
  { key: "studio", label: "Studio", area: "floor", nav: true,
    blurb: "Rooms and team" },
  { key: "visitors", label: "Visitors", area: "floor", nav: true,
    blurb: "Front-desk guest log and QR check-in" },

  // ── Gear, rooms & patch ──
  { key: "inventory", label: "Inventory", area: "gear", nav: true,
    blurb: "Equipment assets with photos" },
  { key: "maintenance", label: "Maintenance", area: "gear", nav: false,
    blurb: "Mark gear as in for repair and see how many pieces are out" },
  { key: "rentals", label: "Rentals", area: "gear", nav: false,
    blurb: "Gear as a paid add-on on bookings, added to the session bill" },
  { key: "patch", label: "Patch bay", area: "gear", nav: true,
    blurb: "Signal routing, devices, ports and cable management" },
  { key: "software", label: "Software", area: "gear", nav: true,
    blurb: "Plugin and DAW licenses with renewal costs" },
  { key: "gearModels", label: "Gear models", area: "gear", nav: false,
    blurb: "Describe a model once; every copy of it uses the same details" },
  { key: "specSheetImport", label: "Maker's sheet import", area: "gear", nav: false,
    blurb: "Read a spec sheet and propose every input and output for you to approve" },
  { key: "patchHistory", label: "Cable map notes and history", area: "gear", nav: false,
    blurb: "Notes, groups and a record of who moved which cable" },
  { key: "gearCheckout", label: "Gear check-out", area: "gear", nav: false,
    blurb: "Scan a label to check gear in and out, with who has what and what is overdue" },

  // ── Music & catalog ──
  { key: "finishedMixes", label: "Finished mixes", area: "catalog", nav: false,
    blurb: "Numbered mix versions, notes on a version, the version the client signed off on" },
  { key: "songs", label: "Songs", area: "catalog", nav: true,
    blurb: "Song catalog, cover art and streaming links" },
  { key: "mediaLibrary", label: "Media library", area: "catalog", nav: true,
    blurb: "Sessions, stems, mixes, masters and artwork, every upload a numbered version with notes and approval" },
  { key: "sharedMediaLibrary", label: "Shared media library", area: "catalog", nav: false,
    blurb: "Not open to customers yet: the group admin searching shared studio files" },
  { key: "projects", label: "Projects", area: "catalog", nav: true,
    blurb: "Post-production tracking from tracking through mixing, mastering and delivery, with tasks, owners and due dates" },
  { key: "crossStudioProjects", label: "Projects across every studio", area: "catalog", nav: false,
    blurb: "Not open to customers yet: every studio's projects on one screen" },
  { key: "splitSheets", label: "Split sheets", area: "catalog", nav: false,
    blurb: "Ownership splits with real e-signatures" },
  { key: "catalogImport", label: "Catalog import", area: "catalog", nav: false,
    blurb: "Pull a released catalog in with credits, codes and drafted split sheets" },
  { key: "royalties", label: "Royalties", area: "catalog", nav: true,
    blurb: "Distributor statements divided by the signed split sheets" },
  { key: "releases", label: "Releases", area: "catalog", nav: true,
    blurb: "Rollout campaigns" },
  { key: "licensing", label: "Licensing", area: "catalog", nav: true,
    blurb: "Sync pitches and beat license records" },

  // ── The AI layer ──
  { key: "agent", label: "Pulse Agent", area: "ai", nav: true,
    blurb: "The AI studio operations manager" },
  { key: "inbox", label: "Approval inbox", area: "ai", nav: true,
    blurb: "Drafts from the scheduled checks" },
  { key: "aiReceptionist", label: "AI receptionist", area: "ai", nav: false,
    blurb: "24/7 auto-reply to booking texts from existing clients" },
  { key: "aiAutonomy", label: "Agent autonomy", area: "ai", nav: false,
    blurb: "Low-risk reminders run without an approval" },
  { key: "dailySummary", label: "Daily summary", area: "ai", nav: false,
    blurb: "A short note on what happened and what needs attention" },
  { key: "healthScore", label: "Studio health score", area: "ai", nav: false,
    blurb: "One score for how the business is doing, from six fixed parts" },

  // ── Communication ──
  { key: "smsFlows", label: "SMS & reminders", area: "comms", nav: false,
    blurb: "Confirmations and the 24h / 2h reminder ladder" },
  { key: "gmailSend", label: "Send from Gmail", area: "comms", nav: false,
    blurb: "Emails you write to clients, from the studio's own Gmail address" },
  { key: "marketing", label: "Marketing", area: "comms", nav: true,
    blurb: "Scheduled social posts, promos and results" },

  // ── Reporting ──
  { key: "reports", label: "Reports", area: "reporting", nav: true,
    blurb: "Revenue command center and operating KPIs" },
  { key: "apiExports", label: "Data exports", area: "reporting", nav: false,
    blurb: "The studio's numbers, out, on demand" },

  // ── Branding & white label ──
  { key: "whiteLabelUi", label: "White-label UI", area: "brand", nav: false,
    blurb: "Their logo, palette, fonts and sign-in across the whole app" },
  { key: "customDomain", label: "Custom domain", area: "brand", nav: false,
    blurb: "Not ready yet: the app on the studio's own address" },

  // ── Agency & multi-studio ──
  { key: "multiStudio", label: "Multi-studio", area: "agency", nav: false,
    blurb: "Not open to customers yet: more than one studio from one console" },
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
  { id: "agencyConsole", area: "agency", kind: "plan", tier: "max",
    label: "Agency console", blurb: "Pulse team only for now. Every studio, its health and its numbers, from one screen" },
  { id: "studioInvites", area: "agency", kind: "plan", tier: "max",
    label: "Studio invites & onboarding", blurb: "Pulse team only for now. Invite by email, branded onboarding, taking bookings the same day" },
  { id: "priceBook", area: "agency", kind: "plan", tier: "max",
    label: "Price book & rebilling", blurb: "Pulse team only for now. The plans an operator sells on, with trials and per-account pricing" },
  { id: "scopedStaff", area: "agency", kind: "plan", tier: "max",
    label: "Scoped agency staff", blurb: "Pulse team only for now. Team members who only see the studios they are assigned" },
  { id: "crossApprovals", area: "agency", kind: "plan", tier: "max",
    label: "Cross-studio approvals", blurb: "Pulse team only for now. Everything waiting on a human across the fleet, in one queue" },
  { id: "siteImport", area: "agency", kind: "plan", tier: "max",
    label: "Import from their website", blurb: "Pulse team only for now. Pull a new studio's details off the site they already have" },
  { id: "demoData", area: "agency", kind: "plan", tier: "max",
    label: "Demo data switch", blurb: "Pulse team only for now. Fill a sub-account with realistic data for a pitch, then clear it" },

  // ── Platform & security ──
  { id: "tenantIsolation", area: "platform", kind: "always",
    label: "Tenant isolation", blurb: "Every query scoped to one studio; cross-studio access denied at the engine" },
  { id: "accessEngine", area: "platform", kind: "always",
    label: "Access engine", blurb: "One resolver and one permission check that every write uses" },
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
