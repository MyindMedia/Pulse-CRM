/* ============================================================
   Pulse OS pricing and tier config. THE single source of truth.

   Three tiers, cheapest first: core, growth, max. Each tier includes
   everything below it. Every surface reads from here:
     - plan gating      convex/lib/plans.ts derives PLAN_LIMITS and the
                        per-tier capability sets from CAPABILITY_TIER
     - allowance caps   convex/usage.ts via PLAN_LIMITS (ALLOWANCES)
     - Stripe           convex/lib/stripe.ts (env var names per tier)
     - /mypulse         the internal sales sheet (FEATURE_GROUPS, PRICING)
     - /pricing         the public page (publicFeatureGroups, PRICING,
                        PULSE_APP_CAPABILITIES)

   It is a leaf module: it imports nothing, so Convex functions and the
   Next app (via the @convex/lib/pricing alias) can both import it without
   pulling server code into a client bundle.

   Copy rules for every string in here: no em dashes, never call Pulse a
   customer-relationship product (the three-letter acronym is banned), no
   rival names, American spelling.
   ============================================================ */

/* ── Tiers ─────────────────────────────────────────────────── */

export const TIERS = ["core", "growth", "max"] as const;
export type TierKey = (typeof TIERS)[number];

/** 0 for core, 1 for growth, 2 for max. Unknown strings rank as core so a
 *  typo can never unlock a paid capability. */
export function tierRank(tier: TierKey | string): number {
  const i = (TIERS as readonly string[]).indexOf(tier);
  return i === -1 ? 0 : i;
}

/** True when `tier` sits at or above `min`. */
export function tierAtLeast(tier: TierKey, min: TierKey): boolean {
  return tierRank(tier) >= tierRank(min);
}

export function isTierKey(value: unknown): value is TierKey {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** The higher of two tiers. */
export function maxTier(a: TierKey, b: TierKey): TierKey {
  return tierRank(a) >= tierRank(b) ? a : b;
}

/* ── Prices ────────────────────────────────────────────────── */

export type BillingInterval = "month" | "year";

export type TierPricing = {
  key: TierKey;
  /** Customer-facing plan name. */
  name: string;
  /** One line under the name on a price card. */
  tagline: string;
  /** Who the plan is for, in the studio owner's words. Customer safe. */
  who: string;
  /** What the plan adds, in plain words. Customer safe. */
  gets: string;
  /** INTERNAL. How a rep tells which plan fits, on a call. Never public. */
  salesTell: string;
  monthlyUsd: number;
  annualUsd: number;
  monthlyCents: number;
  annualCents: number;
  /** Max includes unlimited studios at one flat price. There is no per-studio
   *  charge on any tier, so this is the only studio-count field. */
  unlimitedStudios: boolean;
  /** Highlighted card on the pricing page. */
  highlight: boolean;
};

export const PRICING: Record<TierKey, TierPricing> = {
  core: {
    key: "core",
    name: "Core",
    tagline: "Book it, hold the card, get paid.",
    who: "One or two rooms. The owner does most of the work, and anyone else who helps is paid per session rather than being on the payroll.",
    gets: "Everything needed to take a booking and get paid for it. The public booking page, money up front, charging for a client who does not show, the client list, bills and reminders, the today screen, finished mixes, Google Calendar both ways, sending from your own Gmail, the daily summary and the studio health score.",
    salesTell: "If they answer their own phone and book their own sessions, this is their plan.",
    monthlyUsd: 149,
    annualUsd: 1490,
    monthlyCents: 14900,
    annualCents: 149000,
    unlimitedStudios: false,
    highlight: false,
  },
  growth: {
    key: "growth",
    name: "Growth",
    tagline: "Staff, payroll and the whole floor.",
    who: "A studio with people on the payroll, or more than two rooms at one location.",
    gets: "Everything in Core, plus the staff side and the thinking side. The staff schedule, clocking in and out, payroll, time off, the gear list, the cable map, software subscriptions, prepaid hours and memberships, what each room really earns, and the assistant.",
    salesTell: "The moment they say the word employee, or name an engineer who draws a wage, they are Growth.",
    monthlyUsd: 297,
    annualUsd: 2970,
    monthlyCents: 29700,
    annualCents: 297000,
    unlimitedStudios: false,
    highlight: true,
  },
  max: {
    key: "max",
    name: "Max",
    tagline: "Every studio you run, one flat price.",
    who: "A record company, a production company, or a brand running several studios.",
    gets: "Everything in Growth, plus song ownership and the multi-studio layer. Split sheets with real signatures, release plans, selling the right to use a song, the whole app in your own brand on your own web address, and one screen above every studio you run. Unlimited studios included.",
    salesTell: "If they own the songs as well as the rooms, or they run more than one studio, they are Max.",
    monthlyUsd: 699,
    annualUsd: 6990,
    monthlyCents: 69900,
    annualCents: 699000,
    unlimitedStudios: true,
    highlight: false,
  },
};

/** Price for an interval, in cents. */
export function priceCentsFor(tier: TierKey, interval: BillingInterval): number {
  return interval === "year" ? PRICING[tier].annualCents : PRICING[tier].monthlyCents;
}

/** "$149" or "$1,490". Whole dollars: every price on the ladder is whole. */
export function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** The six Stripe price env var names, by tier and interval. Names only; the
 *  ids live in the Convex and Netlify environments, never in the repo. */
export const STRIPE_PRICE_ENV: Record<TierKey, Record<BillingInterval, string>> = {
  core: { month: "STRIPE_PRICE_CORE_MONTHLY", year: "STRIPE_PRICE_CORE_ANNUAL" },
  growth: { month: "STRIPE_PRICE_GROWTH_MONTHLY", year: "STRIPE_PRICE_GROWTH_ANNUAL" },
  max: { month: "STRIPE_PRICE_MAX_MONTHLY", year: "STRIPE_PRICE_MAX_ANNUAL" },
};

/* ── Terms that hold on every tier ─────────────────────────── */

export const ALL_TIER_TERMS = [
  "Month to month, no contract.",
  "No per-seat or per-login fees. Plans are priced by features.",
  "No booking commission. Card payments go to the studio's own Stripe account and Pulse never holds the money.",
] as const;

/* ── Roles ─────────────────────────────────────────────────── */

export const ROLES = ["owner", "manager", "engineer", "staff", "guest"] as const;
export type RoleKey = (typeof ROLES)[number];

/** Roles each tier is sold with. Display only: the role engine
 *  (lib/accessPolicies.ts) does not gate roles by tier today. */
export const TIER_ROLES: Record<TierKey, readonly RoleKey[]> = {
  core: ["owner", "engineer", "staff", "guest"],
  growth: ROLES,
  max: ROLES,
};

/** Access summary lines per tier, for the /mypulse and /pricing tables. */
export const TIER_ACCESS: Record<TierKey, readonly string[]> = {
  core: [
    "Owner plus engineer and staff logins, no payroll tools",
    "Unlimited guest passes",
    "Up to 2 rooms",
  ],
  growth: [
    "All five roles: owner, manager, engineer, staff and guest",
    "Managers approve time off and assistant actions",
    "Engineers see only their own sessions",
    "Unlimited rooms at one location",
  ],
  max: [
    "A group admin layer above every studio",
    "Staff who see only their studios",
    "Switch parts off per studio",
    "One approval queue for all studios",
    "Unlimited studios, and studios cannot see each other",
  ],
};

/* ── Allowances ────────────────────────────────────────────── */

/** Count sentinel for "no cap". Storage is always a real byte cap. */
export const UNLIMITED = 999_999;

export type Allowances = {
  /** Assistant credits per month. */
  assistantPerMonth: number;
  /** File storage, GB. */
  storageGb: number;
  /** Bookable rooms. */
  rooms: number;
  /** Team members with a login. */
  staff: number;
  /** Studios (sub-accounts) under one account. */
  studios: number;
  /** Expiring guest and invite links per month. */
  inviteLinksPerMonth: number;
  /** Connected social accounts. */
  socialAccounts: number;
  /** Scheduled social posts per month. */
  socialPostsPerMonth: number;
  /** True when the allowance is shared across every studio in the group
   *  rather than counted per studio. */
  pooled: boolean;
};

/* Derived from the previous ladder (assistant 100 / 1,000 / 5,000; storage
   10 / 100 / 1,000 GB; rooms 2 / 6 / unlimited; staff 3 / 15 / unlimited).
   Growth raises rooms to unlimited at one location.

   Texts and email are NOT metered on any tier and are deliberately absent:
   there is no SMS or email cap in the product today, so none is sold. */
export const ALLOWANCES: Record<TierKey, Allowances> = {
  core: {
    assistantPerMonth: 100,
    storageGb: 10,
    rooms: 2,
    staff: 3,
    studios: 1,
    inviteLinksPerMonth: 15,
    socialAccounts: 3,
    socialPostsPerMonth: 20,
    pooled: false,
  },
  growth: {
    assistantPerMonth: 1_000,
    storageGb: 100,
    rooms: UNLIMITED,
    staff: 15,
    studios: 1,
    inviteLinksPerMonth: 50,
    socialAccounts: UNLIMITED,
    socialPostsPerMonth: UNLIMITED,
    pooled: false,
  },
  max: {
    assistantPerMonth: 5_000,
    storageGb: 1_000,
    rooms: UNLIMITED,
    staff: UNLIMITED,
    studios: UNLIMITED,
    inviteLinksPerMonth: UNLIMITED,
    socialAccounts: UNLIMITED,
    socialPostsPerMonth: UNLIMITED,
    pooled: true,
  },
};

/** Channels that are never capped. Listed so nobody invents a cap for them. */
export const UNMETERED = ["texts", "email"] as const;

/* ── Capabilities ──────────────────────────────────────────── */

/** Every gateable capability in the app. Nav-surface keys mirror
 *  src/lib/features.ts FeatureKey; the rest gate behavior, not routes. */
export type CapabilityKey =
  // nav surfaces
  | "agent"
  | "songs"
  | "clients"
  | "pipeline"
  | "inbox"
  | "calendar"
  | "schedule"
  | "visitors"
  | "bookings"
  | "payments"
  | "reports"
  | "releases"
  | "licensing"
  | "studio"
  | "inventory"
  | "patch"
  | "software"
  | "marketing"
  // behaviors
  | "cardOnFile"
  | "noShowShield"
  | "dunning"
  | "clientPortal"
  | "smsFlows"
  | "reviewsReferrals"
  | "discountCodes"
  | "calendarSync"
  | "gmailSend"
  | "dailySummary"
  | "healthScore"
  | "finishedMixes"
  | "timeClock"
  | "payroll"
  | "packages"
  | "memberships"
  | "expenses"
  | "profitability"
  | "rentals"
  | "maintenance"
  | "splitSheets"
  | "aiReceptionist"
  | "aiAutonomy"
  | "apiExports"
  | "customDomain"
  | "whiteLabelUi"
  | "multiStudio"
  | "gearModels"
  | "specSheetImport"
  | "patchHistory"
  // new production, media and gear check-out features
  | "projects"
  | "mediaLibrary"
  | "gearCheckout"
  | "crossStudioProjects"
  | "sharedMediaLibrary";

/** The cheapest tier that includes each capability. A tier's capability set
 *  is every key at or below it, so a capability can never be present at a
 *  lower tier and absent above. */
export const CAPABILITY_TIER: Record<CapabilityKey, TierKey> = {
  // Core
  bookings: "core",
  calendar: "core",
  payments: "core",
  clients: "core",
  studio: "core",
  marketing: "core",
  cardOnFile: "core",
  noShowShield: "core",
  dunning: "core",
  clientPortal: "core",
  smsFlows: "core",
  reviewsReferrals: "core",
  discountCodes: "core",
  calendarSync: "core",
  gmailSend: "core",
  dailySummary: "core",
  healthScore: "core",
  finishedMixes: "core",
  // Growth
  agent: "growth",
  inbox: "growth",
  schedule: "growth",
  reports: "growth",
  pipeline: "growth",
  songs: "growth",
  visitors: "growth",
  inventory: "growth",
  patch: "growth",
  software: "growth",
  timeClock: "growth",
  payroll: "growth",
  packages: "growth",
  memberships: "growth",
  expenses: "growth",
  profitability: "growth",
  rentals: "growth",
  maintenance: "growth",
  aiReceptionist: "growth",
  apiExports: "growth",
  projects: "growth",
  mediaLibrary: "growth",
  gearCheckout: "growth",
  // Max
  releases: "max",
  licensing: "max",
  splitSheets: "max",
  aiAutonomy: "max",
  customDomain: "max",
  whiteLabelUi: "max",
  multiStudio: "max",
  gearModels: "max",
  specSheetImport: "max",
  patchHistory: "max",
  crossStudioProjects: "max",
  sharedMediaLibrary: "max",
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_TIER) as CapabilityKey[];

/** Every capability a tier includes, cheapest tier's first. */
export function capabilitiesAtTier(tier: TierKey): CapabilityKey[] {
  return CAPABILITY_KEYS.filter((k) => tierAtLeast(tier, CAPABILITY_TIER[k]));
}

/** White label level per tier. Core: Pulse chrome (the studio's logo still
 *  shows on its own booking page and client page). Growth: their logo and
 *  color inside the app. Max: the full skin, login screen, emails and domain,
 *  with the small Pulse mark that cannot be removed. */
export type WhitelabelLevel = false | "studio_level" | "full";
export const WHITELABEL: Record<TierKey, WhitelabelLevel> = {
  core: false,
  growth: "studio_level",
  max: "full",
};

/* ── The feature list ──────────────────────────────────────── */

export type Feature = {
  /** Exact name from the /mypulse sheet. Joined on by name, so never reword
   *  one here without rewording it there. */
  name: string;
  /** The cheapest tier that includes it. */
  tier: TierKey;
  /** The capability that enforces it in code, when one does. Absent means
   *  the feature has no tier gate of its own (see UNGATED_ABOVE_CORE). */
  gate?: CapabilityKey;
  /** Moved in the Core/Growth/Max repack: "down" to a cheaper tier. */
  moved?: "down";
  /** False until the feature works end to end. Unbuilt features are never
   *  shown publicly. */
  built: boolean;
};

export type FeatureGroup = {
  id: string;
  title: string;
  /** INTERNAL. The rep's note for the group. Never public. */
  salesNote: string;
  /** True for the 15th group added with this build. */
  isNew?: boolean;
  items: Feature[];
};

const f = (
  name: string,
  tier: TierKey,
  gate?: CapabilityKey,
  extra: Partial<Pick<Feature, "moved" | "built">> = {},
): Feature => ({ name, tier, ...(gate ? { gate } : {}), built: true, ...extra });

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "bookings",
    title: "Booking and the calendar",
    salesNote: "Show this part first. A client picks a room and a time on the studio's own web page and pays to hold it. Nobody has to answer the phone.",
    items: [
      f("Your own booking page", "core", "bookings"),
      f("No double bookings", "core", "bookings"),
      f("Money paid up front", "core", "bookings"),
      f("Extras at checkout", "core", "bookings"),
      f("Discount codes", "core", "discountCodes"),
      f("Reviews and credits on the page", "core", "reviewsReferrals"),
      f("See who sends you clients", "core", "reviewsReferrals"),
      f("Instant text confirmation", "core", "smsFlows"),
      f("Book a returning client in one tap", "core", "bookings"),
      f("Waiting list", "core", "bookings"),
      f("Deposit links for staff bookings", "core", "payments"),
      f("The calendar", "core", "calendar"),
      f("Change a session while it runs", "core", "calendar"),
      f("Checklists before and after", "core", "calendar"),
      f("Google Calendar, both ways", "core", "calendarSync", { moved: "down" }),
      f("Other calendars mark hours busy", "core", "calendarSync", { moved: "down" }),
    ],
  },
  {
    id: "money",
    title: "Money",
    salesNote: "Pulse never holds the studio's money. Each studio connects its own account with Stripe, the company that moves card payments, and Stripe pays it out to their bank.",
    items: [
      f("Their own card-payment account", "core", "payments"),
      f("Money paid and money owed", "core", "payments"),
      f("Saved card", "core", "cardOnFile"),
      f("Bills with a pay button", "core", "payments"),
      f("Bills that write themselves", "core", "payments"),
      f("Automatic payment reminders", "core", "dunning"),
      f("Take the rest of the money in the room", "core", "payments"),
      f("Every payment recorded", "core", "payments"),
      f("Saved charges", "core", "payments"),
      f("Money Pulse won back", "core", "payments"),
      f("Sales tax", "core", "payments"),
      f("Prepaid blocks of hours", "growth", "packages"),
      f("Monthly memberships", "growth", "memberships"),
      f("What the studio spends", "growth", "expenses"),
      f("What each room really made", "growth", "profitability"),
      f("Your own price list", "max", "multiStudio"),
    ],
  },
  {
    id: "noshow",
    title: "People who do not turn up",
    salesNote: "Start a cold call here. When a client misses a session, the studio usually gets nothing for that time. Pulse charges for it and tries to sell those hours to someone else.",
    items: [
      f("Cancellation rules", "core", "noShowShield"),
      f("Keep the deposit", "core", "noShowShield"),
      f("Charge for a missed session", "core", "noShowShield"),
      f("The awkward message, sent for you", "core", "noShowShield"),
      f("Refill the empty hours", "core", "noShowShield"),
      f("Which bookings look shaky", "core", "noShowShield"),
      f("Warnings about money problems", "growth", "reports"),
    ],
  },
  {
    id: "clients",
    title: "Clients",
    salesNote: "One place for every client, everyone who has ever asked about a session, and everyone who worked on a song. Their whole history sits under their name.",
    items: [
      f("One list of everyone", "core", "clients"),
      f("One person's whole history", "core", "clients"),
      f("Your own tags", "core", "clients"),
      f("Bring your list in from a spreadsheet", "core", "clients"),
      f("A private page for the client", "core", "clientPortal"),
      f("Guest passes", "core"),
      f("Ask for a review", "core", "reviewsReferrals"),
      f("Turn a review into a referral", "core", "reviewsReferrals"),
      f("Job board", "growth", "pipeline"),
      f("What each open job is worth", "growth", "pipeline"),
    ],
  },
  {
    id: "staff",
    title: "Staff and shifts",
    salesNote: "This is why a studio with employees moves up a plan. Putting an engineer on a session also puts them on the staff schedule, which is the grid of who works when. The same information is only entered once.",
    items: [
      f("The week's schedule", "growth", "schedule"),
      f("Booking an engineer makes their shift", "growth", "schedule"),
      f("Warning when someone is booked twice", "growth", "schedule"),
      f("Hours each person can work", "growth", "schedule"),
      f("Time off requests", "growth", "schedule"),
      f("Who is on today", "growth", "schedule"),
      f("Clock in on a phone", "growth", "timeClock"),
      f("Payroll", "growth", "payroll"),
      f("Pay periods", "growth", "payroll"),
      f("New staff set themselves up", "growth"),
      f("Alerts for each person", "growth"),
    ],
  },
  {
    id: "floor",
    title: "The front desk",
    salesNote: "What the studio keeps open on a screen from the morning until the last session ends.",
    items: [
      f("The today screen", "core"),
      f("Get ready for the next client", "core"),
      f("Is the room free", "core", "studio"),
      f("Notes on how the session was set up", "core", "calendar"),
      f("It installs on a phone", "core"),
      f("Phone alerts", "core"),
      f("Sign-in screen at the door", "growth", "visitors"),
      f("A printable sign with your code", "growth", "visitors"),
      f("A named parking badge", "growth", "visitors"),
    ],
  },
  {
    id: "gear",
    title: "Rooms, gear and cables",
    salesNote: "The part ordinary business software does not have. What gear is in the room, what it is worth, and what it is plugged into.",
    items: [
      f("Rooms", "core", "studio"),
      f("A list of every piece of gear", "growth", "inventory"),
      f("What needs servicing", "growth", "maintenance"),
      f("Renting gear out", "growth", "rentals"),
      f("Bring the gear list in from a spreadsheet", "growth", "inventory"),
      f("Software subscriptions", "growth", "software", { moved: "down" }),
      f("A map of the cables", "growth", "patch", { moved: "down" }),
      f("Fill in a piece of gear once", "max", "gearModels"),
      f("Look up what a socket does", "growth", "patch", { moved: "down" }),
      f("Set up sockets from the maker's sheet", "max", "specSheetImport"),
      f("Notes and history on the cable map", "max", "patchHistory"),
    ],
  },
  {
    id: "catalog",
    title: "Songs",
    salesNote: "Studios sell hours, and those hours produce songs. Pulse tracks the songs as well as the appointments.",
    items: [
      f("Finished mixes", "core", "finishedMixes"),
      f("Notes on one version of a mix", "core", "finishedMixes"),
      f("Every song in one place", "growth", "songs"),
      f("Paste a streaming link", "growth", "songs"),
      f("Who owns what share of a song", "max", "splitSheets"),
      f("Real signatures by link", "max", "splitSheets"),
      f("The form fills itself in", "max", "splitSheets"),
      f("A plan for putting a song out", "max", "releases"),
      f("Selling the right to use a song", "max", "licensing"),
      f("Print who owns what", "max", "splitSheets"),
    ],
  },
  {
    id: "ai",
    title: "The assistant",
    salesNote: "An assistant that reads the studio's own records, suggests what to do next, and waits for a person to say yes before it does anything.",
    items: [
      f("It does not take orders from a client message", "core"),
      f("Pulse Agent", "growth", "agent"),
      f("It always asks first", "growth", "agent"),
      f("Daily summary", "core", "dailySummary", { moved: "down" }),
      f("Studio health score", "core", "healthScore", { moved: "down" }),
      f("It remembers", "growth", "agent"),
      f("A record of what it did", "growth", "agent"),
      f("It answers booking texts day and night", "growth", "aiReceptionist"),
      f("The scheduled check (Ops Autopilot)", "growth", "agent"),
      f("The connection map (Studio Brain)", "growth", "reports"),
      f("Guesses from your own history", "growth", "reports"),
      f("A short list of what matters", "growth", "agent"),
      f("It writes, you send", "growth", "agent"),
      f("Let simple reminders run themselves", "max", "aiAutonomy"),
      f("Ask it the same thing every week", "max", "aiAutonomy"),
      f("All the assistants on one screen", "max", "multiStudio"),
    ],
  },
  {
    id: "comms",
    title: "Talking to clients",
    salesNote: "Emails to clients can go out from Pulse, or from the studio's own Gmail. The studio picks which.",
    items: [
      f("Email that works on day one", "core"),
      f("Text messages", "core", "smsFlows"),
      f("STOP means stop", "core", "smsFlows"),
      f("Reminders before the session", "core", "smsFlows"),
      f("The conversation stays with the client", "core", "clients"),
      f("Telling the right staff", "core"),
      f("Send from your own Gmail", "core", "gmailSend", { moved: "down" }),
      f("One inbox", "growth", "inbox"),
    ],
  },
  {
    id: "reporting",
    title: "Numbers",
    salesNote: "Most studio owners cannot tell you which of their rooms makes money. These screens answer that.",
    items: [
      f("How much money came in", "growth", "reports"),
      f("The numbers that matter", "growth", "reports"),
      f("Arrange the home screen", "growth"),
      f("Charts", "growth", "reports"),
      f("What the booking page earned", "growth", "reports"),
      f("How much of the plan is used", "growth"),
      f("Download your numbers", "growth", "apiExports"),
    ],
  },
  {
    id: "brand",
    title: "Making it look like theirs",
    salesNote: "Upload a logo and the app changes to the studio's colors. On the top plan the whole thing looks like software they built.",
    items: [
      f("Colors from your logo", "core"),
      f("A photo at the top of the booking page", "core"),
      f("The words on the booking page", "core"),
      f("One brand color everywhere", "core"),
      f("Their brand inside the app", "growth"),
      f("The app looks like theirs", "max", "whiteLabelUi"),
      f("Their own login screen", "max", "whiteLabelUi"),
      f("Emails in their colors", "max", "whiteLabelUi"),
      f("Their own web address", "max", "customDomain"),
      f("Colors stay readable", "max", "whiteLabelUi"),
      f("A small Pulse mark", "max", "whiteLabelUi"),
    ],
  },
  {
    id: "agency",
    title: "Running many studios",
    salesNote: "One screen sitting above a group of studios. Each studio only ever sees its own work.",
    items: [
      f("One screen for every studio", "max", "multiStudio"),
      f("Invite a studio by email", "max", "multiStudio"),
      f("Step-by-step setup", "max", "multiStudio"),
      f("Pull details off their website", "max", "multiStudio"),
      f("Switch parts off per studio", "max", "multiStudio"),
      f("Your own price list", "max", "multiStudio"),
      f("Staff who see only their studios", "max", "multiStudio"),
      f("The console under your brand", "max", "multiStudio"),
      f("One approval queue for all studios", "max", "multiStudio"),
      f("Who did what, where", "max", "multiStudio"),
      f("Fake data for a pitch", "max", "multiStudio"),
    ],
  },
  {
    id: "platform",
    title: "Safety and privacy",
    salesNote: "One studio can never see another studio's records. Pulse blocks it in the code that reads the database, so hiding a button is not what is protecting them.",
    items: [
      f("Studios cannot see each other", "core"),
      f("One place that checks permissions", "core"),
      f("Roles", "core"),
      f("You get what you paid for", "core"),
      f("A permanent record", "core"),
      f("Clients can get or delete their data", "core"),
      f("Guest links that expire", "core"),
      f("Allowances counted per plan", "core"),
      f("Use it before setup is finished", "core"),
      f("We move your data for free", "core"),
      f("No contract", "core"),
      f("955 automatic checks", "core"),
    ],
  },
  {
    id: "production",
    title: "Production, media and gear check-out",
    salesNote: "Closes the gap with the studio tools that track a record after the session. The project, every file version, and who has which piece of gear.",
    isNew: true,
    items: [
      f("Post-production project tracking", "growth", "projects", { built: false }),
      f("Projects across every studio", "max", "crossStudioProjects", { built: false }),
      f("Media file management with version control", "growth", "mediaLibrary"),
      f("One media library shared across studios", "max", "sharedMediaLibrary"),
      f("Barcode equipment check-in and check-out", "growth", "gearCheckout"),
    ],
  },
];

/** The 14 original groups (155 features). */
export const EXISTING_GROUPS = FEATURE_GROUPS.filter((g) => !g.isNew);

export const ALL_FEATURES: Feature[] = FEATURE_GROUPS.flatMap((g) => g.items);

/** The cheapest tier for a feature, by exact name, or null if no feature has
 *  that name. Names that appear twice ("Your own price list") carry the same
 *  tier both times, which a test enforces. */
export function featureTier(name: string): TierKey | null {
  return ALL_FEATURES.find((x) => x.name === name)?.tier ?? null;
}

/** Features whose cheapest tier is exactly `tier`. */
export function featuresForTier(tier: TierKey, opts: { builtOnly?: boolean } = {}): Feature[] {
  return ALL_FEATURES.filter((x) => x.tier === tier && (!opts.builtOnly || x.built));
}

/** Everything a tier can use: its own features plus all cheaper tiers'. */
export function featuresIncludedIn(tier: TierKey, opts: { builtOnly?: boolean } = {}): Feature[] {
  return ALL_FEATURES.filter(
    (x) => tierAtLeast(tier, x.tier) && (!opts.builtOnly || x.built),
  );
}

/** Per-tier totals over a set of groups. */
export function tierTotals(groups: FeatureGroup[] = EXISTING_GROUPS): Record<TierKey, number> {
  const out: Record<TierKey, number> = { core: 0, growth: 0, max: 0 };
  for (const g of groups) for (const x of g.items) out[x.tier] += 1;
  return out;
}

export type PublicFeature = { name: string; tier: TierKey };
export type PublicFeatureGroup = { id: string; title: string; items: PublicFeature[] };

/** The customer-safe comparison table: no sales notes, no gates, and no
 *  feature that is not built. Groups left empty are dropped. Never contains
 *  a NOT_BUILT_YET item, because those were never features. */
export function publicFeatureGroups(): PublicFeatureGroup[] {
  return FEATURE_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    items: g.items.filter((x) => x.built).map((x) => ({ name: x.name, tier: x.tier })),
  })).filter((g) => g.items.length > 0);
}

/** INTERNAL. The nine "Not built yet" roadmap items on /mypulse. They must
 *  never appear on a public surface, as a feature or otherwise. */
export const NOT_BUILT_YET = [
  "A public list of studios on Pulse",
  "Paying the engineer automatically",
  "A cheaper plan paid for by payments",
  "A yearly report on the studio business",
  "A page comparing us to the main rival",
  "The moving promise, in writing",
  "Typing the card number into the page",
  "Counting visits to the booking page",
  "Turning a suggestion into a standing rule",
] as const;

/* ── The Pulse app (iPhone) by tier ────────────────────────── */

/** What the Pulse iPhone app does, per tier. WEB COPY ONLY: the app itself
 *  has no plan reads and shows no plan names (App Review). Lists only what
 *  works in the app today, confirmed against pulse-native docs/WEB_PARITY.md.
 *  Each tier adds to the one below. The three new features add their app
 *  lines here once they ship in the app. */
export const PULSE_APP_CAPABILITIES: Record<TierKey, readonly string[]> = {
  core: [
    "Today's sessions and the calendar",
    "Book, extend and change a session",
    "Room status",
    "Take payment in the room with a pay link or a text",
    "Phone alerts",
    "Client history and texts",
    "Bills and payment reminders",
    "Approve a mix version",
  ],
  growth: [
    "Clock in and out",
    "Time off requests and approvals",
    "The staff schedule",
    "The gear list",
    "The cable map",
    "Prepaid hours, the job board and the door sign-in",
    "Payroll, expenses and receipts",
  ],
  max: [
    "Switch between studios",
    "Release plans and song licenses",
  ],
};
