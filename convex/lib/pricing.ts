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

/* ── Trials and the beta (owner rule, 2026-10-07) ──────────────
   Every trial needs a card to start. Stripe saves it at checkout and
   charges it automatically when the trial ends, then renews normally.
   The beta is the only exception: free for 365 days with no card, and
   payment is required after the term. */

/** Free trial length on the public Core / Growth / Max checkout, in days.
 *  0 = no trial: those plans bill on the day you subscribe. Any value above 0
 *  turns on a card-required trial through the same checkout helper
 *  (convex/lib/trialCheckout.ts), and the /pricing FAQ follows this number. */
export const PLATFORM_TRIAL_DAYS = 0;

/** The beta term, in days. The only card-free access Pulse gives. */
export const BETA_TERM_DAYS = 365;

/** Customer-safe trial terms, quoted by /pricing, /mypulse, the agency
 *  console and the billing screens so the promise reads the same everywhere. */
export const TRIAL_TERMS = {
  cardRequired: "A card is required to start a free trial.",
  autoRenew: "When the trial ends, your card is charged automatically and the plan renews on its normal schedule.",
  cancel: "Cancel any time before the trial ends and you will not be charged.",
  beta: `The beta is free for ${BETA_TERM_DAYS} days with no card. Payment is required after the term to keep using Pulse, and your data stays put.`,
} as const;

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

/** The drop down text for one feature on /pricing. `tiers` is generated
 *  from the real tier and ALLOWANCES by tiersLine(). */
export type FeatureDetail = { what: string; does: string; tiers: string };

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
  /** The drop down on /pricing: what it is, what it does, which plan. */
  detail: FeatureDetail;
};

type RawFeature = Omit<Feature, "detail">;

export type FeatureGroup = {
  id: string;
  title: string;
  /** INTERNAL. The rep's note for the group. Never public. */
  salesNote: string;
  /** True for the 15th group added with this build. */
  isNew?: boolean;
  items: Feature[];
};

type RawFeatureGroup = Omit<FeatureGroup, "items"> & { items: RawFeature[] };

const f = (
  name: string,
  tier: TierKey,
  gate?: CapabilityKey,
  extra: Partial<Pick<Feature, "moved" | "built">> = {},
): RawFeature => ({ name, tier, ...(gate ? { gate } : {}), built: true, ...extra });

const RAW_FEATURE_GROUPS: RawFeatureGroup[] = [
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
      f("Post-production project tracking", "growth", "projects"),
      f("Projects across every studio", "max", "crossStudioProjects"),
      f("Media file management with version control", "growth", "mediaLibrary"),
      f("One media library shared across studios", "max", "sharedMediaLibrary"),
      f("Barcode equipment check-in and check-out", "growth", "gearCheckout"),
    ],
  },
];

/* ── Feature explainers ────────────────────────────────────── */

/** What a feature's drop down on /pricing says. `what` is what it is, `does`
 *  is what it does for a studio owner, `tiers` is generated from the real
 *  tier and allowances (see tiersLine), so it can never disagree with the
 *  table. Every sentence is grounded in the built product. */
type LimitKind = "rooms" | "assistant" | "storage" | "staff" | "studios" | "unmetered" | "allowances";

/* [what, does, optional limit line]. Keyed by exact feature name; a name used
   in two groups can be overridden with "groupId:name". */
const DETAIL_COPY: Record<string, [string, string, LimitKind?]> = {
  /* Booking and the calendar */
  "Your own booking page": [
    "A web page with your studio's name, logo and colors on it, where clients book a room and a time.",
    "A client opens your link, picks a room and a time, and pays to hold it, the way they would book a hotel room. Nobody has to answer the phone or trade messages to find an open slot.",
  ],
  "No double bookings": [
    "A check that stops two people from booking the same room at the same time.",
    "Pulse looks at the room's calendar before it accepts a booking. If the time is already taken, the booking does not go through, so you never have two clients show up for one slot.",
  ],
  "Money paid up front": [
    "A deposit the client pays to hold their time. It is part of the price, paid when they book.",
    "The deposit goes into your own payment account. How much deposit each room needs is set on the room, so a small room and a big room can ask for different amounts.",
  ],
  "Extras at checkout": [
    "Add-ons a client can pick while they book.",
    "While booking, the client can also pay for an engineer, extra gear or extra hours. It all happens in the same checkout, so you do not have to chase a second payment for the extras.",
  ],
  "Discount codes": [
    "Codes you make that take money off a price.",
    "You create a code, give it to a client, and they enter it at checkout.",
  ],
  "Reviews and credits on the page": [
    "A section of your booking page that shows what past clients said.",
    "The page can show review answers from earlier clients, plus the engineers' names and the records they worked on. A new visitor sees proof of your work right where they decide to book.",
  ],
  "See who sends you clients": [
    "A record of which client referred which new client.",
    "When an artist sends a friend, Pulse remembers who sent them. You can then see which clients bring in the most work and who deserves a thank-you.",
  ],
  "Instant text confirmation": [
    "A text message sent to the client right after they book.",
    "The client gets a text saying the booking worked, so they know it went through without waiting on an email. Clients who replied STOP are not texted.",
  ],
  "Book a returning client in one tap": [
    "A shortcut for someone who has been to your studio before.",
    "Staff tap once and the booking form is already filled in from the client's last visit. Repeat clients do not have to be asked for the same details again.",
  ],
  "Waiting list": [
    "A list of people who asked to be told when time opens up.",
    "When someone cancels, Pulse offers those hours to the people on the list. A cancellation can turn into a booking from someone who was waiting, instead of an empty gap in the calendar.",
  ],
  "Deposit links for staff bookings": [
    "A payment link for the deposit when your team books a session by hand.",
    "When staff book a client over the phone or in person, Pulse still texts the client a link to pay the deposit. A booking made at the front desk gets the same up-front money as one made on the web page.",
  ],
  "The calendar": [
    "Every session in one place.",
    "Look at a whole month, one week, or a list of today. Everyone on the team works from the same calendar, so there is one answer to what is booked.",
  ],
  "Change a session while it runs": [
    "Controls for adjusting a session once it has started.",
    "Staff can add time, add gear, start a timer, write the engineer's notes, mark the client as arrived, or book the next session. A session that runs long or changes shape is updated on the spot.",
  ],
  "Checklists before and after": [
    "A list of jobs to do before the client arrives and after they leave.",
    "Pulse writes the list when the session is booked. Staff see what has to happen before and after each session without keeping it in their heads.",
  ],
  "Google Calendar, both ways": [
    "A two-way link between Pulse and Google Calendar.",
    "The two keep each other up to date. Block time in one and it blocks in the other, so a personal appointment on your own calendar does not turn into a double booking.",
  ],
  "Other calendars mark hours busy": [
    "A way for an outside calendar to gray out hours in Pulse.",
    "Hours that are busy on another calendar are shown as unavailable in Pulse, without showing anyone what those hours are for. Clients cannot book a time you are not free.",
  ],

  /* Money */
  "Their own card-payment account": [
    "Your own Stripe account, connected when you sign up. Stripe is the company that moves card payments.",
    "Client payments land in your account and Stripe pays them out to your bank. Pulse runs the checkout, never holds your money, and takes no booking commission.",
  ],
  "Money paid and money owed": [
    "A running tally of what has been paid and what is still owed on every session.",
    "It includes part payments made along the way, such as a deposit followed by a balance. You can open a session and see what the client still owes.",
  ],
  "Saved card": [
    "A client's card, kept on file with their permission.",
    "You can charge it later without asking again, for example for a missed session. Clients are not asked to type the same card in twice.",
  ],
  "Bills with a pay button": [
    "A bill you send that the client can pay straight from.",
    "The client taps the button in the bill and pays. There is no need to read out a card number or wait for a check.",
  ],
  "Bills that write themselves": [
    "Bills Pulse creates when a session ends with money still owed.",
    "Pulse writes the bill and sends it, minus what the client already paid. You do not have to work out the balance by hand after each session.",
  ],
  "Automatic payment reminders": [
    "Reminders Pulse sends when a bill goes unpaid.",
    "Pulse sends a reminder after 3 days, another after 7, and another after 14. After that it flags the bill for a person to follow up, so late bills get chased without you having to remember.",
  ],
  "Take the rest of the money in the room": [
    "Ways to collect the balance while the client is still in the studio.",
    "Staff can collect it on the spot with a pay link, a code the client scans with a phone camera, or a text. The balance is paid before the client leaves instead of after.",
  ],
  "Every payment recorded": [
    "One list of every payment.",
    "It is sorted by what kind of payment it was, and includes payments staff type in by hand and any credit you give back. When you need to know what came in, the list is in one place.",
  ],
  "Saved charges": [
    "Charges you add often, saved once.",
    "Drop a saved charge onto a bill in one click instead of typing the name and price each time.",
  ],
  "Money Pulse won back": [
    "A monthly total of money your studio would otherwise have lost.",
    "Pulse adds up kept deposits, late fees, canceled hours it resold, and bills paid after a reminder, and sends you the total once a month.",
  ],
  "Sales tax": [
    "Tax settings for your studio.",
    "You pick your state and your tax rate, and Pulse adds the tax at checkout. You do not have to add it to each bill yourself.",
  ],
  "Prepaid blocks of hours": [
    "Studio time that a client buys in advance.",
    "Pulse holds the purchase as credit and takes hours off it as the client uses them. Good for a regular client who wants to pay once and book several sessions.",
  ],
  "Monthly memberships": [
    "A plan clients pay for every month.",
    "Members get a sign-up page and first pick of the calendar. It gives the studio a steady monthly payment from clients who come back often.",
  ],
  "What the studio spends": [
    "A place to enter your studio's costs.",
    "You type in what the studio spends. Pulse takes the costs off what came in, so you see what is left and not only what was charged.",
  ],
  "What each room really made": [
    "What each room and each session earned after costs.",
    "You see what was left after costs, not just what was charged. It shows which rooms are paying for themselves.",
  ],
  "Your own price list": [
    "A price list for a company that runs several studios.",
    "You set your own prices for the studios you bring onto Pulse. Each one is billed at the plans you chose.",
  ],
  "agency:Your own price list": [
    "The plans you resell to your studios.",
    "You can add offers and different terms for one account if you want. Free trials take a card at the start and renew automatically afterward. The beta is the one plan with no card.",
  ],

  /* People who do not turn up */
  "Cancellation rules": [
    "Rules you set for how late is too late to cancel.",
    "You decide the cutoff and how much of the money the studio keeps when a client cancels after it. Pulse then follows your rules every time, so you are not deciding case by case.",
  ],
  "Keep the deposit": [
    "Pulse keeps the deposit when a client cancels too late or never shows.",
    "It happens on its own, using the rules you set. You do not have to argue about what was paid.",
  ],
  "Charge for a missed session": [
    "A charge to the card on file when a client misses a session.",
    "Pulse charges the saved card for the missed session, following the same cancellation rules. The studio is paid for the time it held.",
  ],
  "The awkward message, sent for you": [
    "The message that tells a client they missed the session and are being charged.",
    "Pulse sends it, written in your studio's own words. You do not have to write that message yourself.",
  ],
  "Refill the empty hours": [
    "A way to sell the hours a no-show freed up.",
    "The freed-up hours go out to the waiting list right away, so someone else can take them. An empty room can turn back into a booking.",
  ],
  "Which bookings look shaky": [
    "A flag on bookings that look likely to fall through.",
    "Pulse points them out before they do, so you can confirm with the client or plan for an open room.",
  ],
  "Warnings about money problems": [
    "Alerts about money your studio is losing without anyone noticing.",
    "Pulse reads your records and warns the owner when it finds money slipping away. You learn about it from a warning instead of from a month-end surprise.",
  ],

  /* Clients */
  "One list of everyone": [
    "A single list of the people your studio deals with.",
    "Clients, artists, and people who have only asked about a session so far all sit in one place.",
  ],
  "One person's whole history": [
    "A timeline for one person.",
    "Every message, session, bill and note about them is shown in the order it happened. Open one name and you see the whole relationship.",
  ],
  "Your own tags": [
    "Tags and extra boxes you add yourself.",
    "You sort the client list the way your studio thinks about it, with your own labels and extra boxes for details you care about.",
  ],
  "Bring your list in from a spreadsheet": [
    "An upload for the client list you already keep.",
    "Upload the spreadsheet and your clients are in Pulse on day one. You do not have to retype them.",
  ],
  "A private page for the client": [
    "A page that belongs to one client.",
    "The client taps a link in an email and lands on their own page. From there they can book again, pay a bill and download finished songs.",
  ],
  "Guest passes": [
    "A link for someone helping on one job, like a bass player or an outside mixer.",
    "The link shows them only their part and stops working after a set time. They get what they need without access to the rest of your studio.",
  ],
  "Ask for a review": [
    "A message that asks a client what they thought of the session.",
    "A day after the session, Pulse asks the client. You can put the answers on your booking page.",
  ],
  "Turn a review into a referral": [
    "A referral link inside the review message.",
    "The same message carries a link the client can pass to a friend. Pulse tracks who sent who.",
  ],
  "Job board": [
    "A row of cards you move along as a job moves.",
    "The stages run from asked about it, serious, quoted, booked, in the room and delivered, to bought more. You see at a glance which jobs are waiting on you.",
  ],
  "What each open job is worth": [
    "A dollar value on each job that is not yet won.",
    "Pulse shows how much each open job is worth and how likely the client is to say yes. It helps you decide which inquiry to answer first.",
  ],

  /* Staff and shifts */
  "The week's schedule": [
    "A grid of who works which day, in which room.",
    "You change it by typing straight on the grid. The whole team can see who is working when.",
  ],
  "Booking an engineer makes their shift": [
    "A link between session bookings and the staff schedule.",
    "Put an engineer on a session and their shift appears on the schedule by itself. The same information is entered once.",
  ],
  "Warning when someone is booked twice": [
    "An alert when a person is needed in two places at once.",
    "Pulse warns you about the clash. It still lets you go ahead if you know it is fine.",
  ],
  "Hours each person can work": [
    "The hours each team member is normally free.",
    "Every member of staff sets their own hours. You can see who is free before you book them.",
  ],
  "Time off requests": [
    "A way for staff to ask for days off.",
    "Staff ask in the app. Managers get the request and say yes or no, and both sides are told the answer.",
  ],
  "Who is on today": [
    "A strip across the home screen.",
    "It shows which staff are scheduled to work today, so you know who is in without checking the schedule.",
  ],
  "Clock in on a phone": [
    "Staff start and end their shift on their own phone.",
    "Pulse saves their pay rate at the moment they clock in, so a later raise cannot change old shifts. Hours are recorded without a paper timesheet.",
  ],
  "Payroll": [
    "Pay worked out from hours and pay rates.",
    "Pulse multiplies each person's hours by their pay rate, spreads salaries across the pay period and adds the engineer's share of each session. What it works out goes into your studio's costs.",
  ],
  "Pay periods": [
    "The schedule you pay people on.",
    "Pay people once a month, or every two weeks counting from a date you pick.",
  ],
  "New staff set themselves up": [
    "A guided start for a new hire.",
    "A new hire gets an invite with your studio's branding on it, reads what their job can do in the app, and adds a photo and their hours. Then they are working.",
  ],
  "Alerts for each person": [
    "Alerts that go only to the people they matter to.",
    "Each person is only alerted about the things that are their job, so alerts stay useful instead of noisy.",
  ],

  /* The front desk */
  "The today screen": [
    "One screen that shows today.",
    "It lists every session in order and who is in which room. It also shows who has arrived, who still owes money, who is working, and what tomorrow looks like.",
  ],
  "Get ready for the next client": [
    "A shared list of what to set up before the next person walks in.",
    "Check something off and every staff screen updates at once. The team does not have to ask each other what is already done.",
  ],
  "Is the room free": [
    "A free or busy status for each room.",
    "It shows busy until what time, worked out from the real bookings, so nobody has to figure it out.",
  ],
  "Notes on how the session was set up": [
    "Notes the engineer writes about a session.",
    "They record which gear was used, what it was plugged into, and the speed and key of the song. Pulse saves it against the session.",
  ],
  "It installs on a phone": [
    "Pulse on a phone home screen.",
    "It sits there with its own row of buttons along the bottom. It does not have to come from an app store.",
  ],
  "Phone alerts": [
    "Alerts that buzz a staff member's phone.",
    "They are for the things that cannot wait for an email.",
  ],
  "Sign-in screen at the door": [
    "A sign-in page and a code to scan by the front door.",
    "Guests sign themselves in, so you know who is in the building.",
  ],
  "A printable sign with your code": [
    "A sign carrying your studio's own scan code.",
    "It is ready to print and put in a frame by the door.",
  ],
  "A named parking badge": [
    "A badge with the client's name for their parking space.",
    "A small touch that clients remember.",
  ],

  /* Rooms, gear and cables */
  "Rooms": [
    "A page for each room in your studio.",
    "Each room has photos, an hourly price, how much deposit it needs, and prices for different kinds of work. Clients booking online see these details.",
    "rooms",
  ],
  "A list of every piece of gear": [
    "A list of everything the studio owns.",
    "Each item has photos taken on a phone or picked from a library. You know what you have and what it looks like.",
  ],
  "What needs servicing": [
    "A record of repairs and services.",
    "It shows what is due for a repair or a service, and what has already been done.",
  ],
  "Renting gear out": [
    "Tracking for gear lent to other people.",
    "Rentals are tracked and billed like any other charge, so lent gear does not go unpaid or unrecorded.",
  ],
  "Bring the gear list in from a spreadsheet": [
    "An upload for the gear spreadsheet you already keep.",
    "Upload it and your gear is in Pulse without retyping.",
  ],
  "Software subscriptions": [
    "A list of the software your studio pays for.",
    "It shows what each one costs to renew, so a renewal is never a surprise.",
  ],
  "A map of the cables": [
    "A written-down map of which box is plugged into which socket.",
    "The whole team can see it, so setup knowledge does not live in one engineer's head.",
  ],
  "Fill in a piece of gear once": [
    "A shared description for each model of gear.",
    "Describe a model once and every copy of it in the building uses the same details. You do not repeat the entry for each unit.",
  ],
  "Look up what a socket does": [
    "A lookup for the sockets on a piece of gear.",
    "Check what a socket is without looking it up in the manual.",
  ],
  "Set up sockets from the maker's sheet": [
    "An import from the maker's specification sheet.",
    "Upload the sheet. Pulse reads it and fills in every input and output on that piece of gear, instead of you typing them one by one.",
  ],
  "Notes and history on the cable map": [
    "Notes and groups on the cable map, plus a log of changes.",
    "You can see who moved which cable and when. If something stops working, there is a record to look at.",
  ],

  /* Songs */
  "Finished mixes": [
    "A home for every version of a mix.",
    "Versions are saved in order and numbered. The client listens, approves and downloads them in Pulse instead of over email.",
  ],
  "Notes on one version of a mix": [
    "Feedback that is attached to a specific version.",
    "Notes go with the exact version they are about, so feedback stops getting lost in text messages.",
  ],
  "Every song in one place": [
    "A page for each song.",
    "Each song shows its artwork, how far along it is, and which sessions made it.",
  ],
  "Paste a streaming link": [
    "A shortcut for adding a released song.",
    "Paste a link to the song on a streaming service and Pulse fills in the artwork and the details.",
  ],
  "Who owns what share of a song": [
    "A form that records each person's share of a song.",
    "It holds the percentage each writer and producer owns, agreed and written down in one place. Ownership questions have a written answer.",
  ],
  "Real signatures by link": [
    "Signing the ownership form with a link.",
    "Everyone on the song signs by clicking the link they are sent. They do not need to be in the room.",
  ],
  "The form fills itself in": [
    "A form that starts with the people already on the song.",
    "People already listed on the song are already on the ownership form, so you do not enter them twice.",
  ],
  "A plan for putting a song out": [
    "A release plan for a song.",
    "It is a list of jobs and dates, tracked from planning until the song is out.",
  ],
  "Selling the right to use a song": [
    "Licensing for songs and beats.",
    "You can sell permission to use a song in a film, on television, in an ad or in a game. You can also sell a beat, at levels running from a cheap audio file up to an exclusive license.",
  ],
  "Print who owns what": [
    "A download of the full ownership picture.",
    "When a publisher asks who owns what, you have the document ready to send.",
  ],

  /* The assistant */
  "It does not take orders from a client message": [
    "A safety rule for the assistant.",
    "If a client writes instructions into a message, the assistant treats them as words to read and does not act on them. It can only ever see your studio's own records.",
  ],
  "Pulse Agent": [
    "An assistant you type to in plain English.",
    "Ask a question about your studio and it answers from your own records. It saves you from digging through screens.",
    "assistant",
  ],
  "It always asks first": [
    "An approval step before the assistant acts.",
    "Nothing that reaches a client and nothing involving money happens until a person taps approve.",
  ],
  "Daily summary": [
    "A short note on what happened and what needs attention.",
    "It is sent at whatever hour you pick, so you start the day knowing where things stand.",
  ],
  "Studio health score": [
    "One score for how your business is doing.",
    "It is built from six fixed things, so the number means the same today as it did last week. You can tell if the studio is getting better or worse.",
  ],
  "It remembers": [
    "Memory for the assistant.",
    "Tell it something once and it still knows later, so you do not repeat yourself.",
  ],
  "A record of what it did": [
    "A log of the assistant's actions.",
    "Every action it took is written down and never edited. You can also see how much of your plan's assistant allowance has been used.",
    "assistant",
  ],
  "It answers booking texts day and night": [
    "Automatic replies to booking questions sent by text.",
    "When someone texts asking about a session at any hour, it replies with your booking link. It never promises a time it cannot actually hold.",
  ],
  "The scheduled check (Ops Autopilot)": [
    "A check of the studio that runs on a schedule.",
    "It looks over the studio and puts together a list of things worth doing.",
  ],
  "The connection map (Studio Brain)": [
    "A map of how everything in your studio connects.",
    "It shows which artist made which song, in which room, with which gear and which engineer.",
  ],
  "Guesses from your own history": [
    "Forecasts built from your studio's own history.",
    "The forecasts are built from what your studio has actually done.",
  ],
  "A short list of what matters": [
    "A ranked list of the things worth knowing today.",
    "The most important come first, and each one shows why the assistant thinks so.",
  ],
  "It writes, you send": [
    "Drafts written by the assistant.",
    "It drafts the email, the session summary or the offer. A person reads it and presses send.",
  ],
  "Let simple reminders run themselves": [
    "A switch that lets plain reminders go out without approval.",
    "The owner can turn it on. Everything else still waits for approval.",
  ],
  "Ask it the same thing every week": [
    "A saved question the assistant answers on a schedule.",
    "Save a question and the assistant answers it every day or every week without being asked.",
  ],
  "All the assistants on one screen": [
    "An overview for a company that runs many studios.",
    "It shows every studio's assistant, how each studio is doing, and everything waiting for approval, in one place.",
    "studios",
  ],

  /* Talking to clients */
  "Email that works on day one": [
    "Client email that is ready as soon as you sign up.",
    "Pulse sends your studio's client emails from the first minute. You do not have to set anything up first.",
    "unmetered",
  ],
  "Text messages": [
    "Texting to clients and staff.",
    "The phone company paperwork needed to send business texts is already done, so the messages arrive instead of being blocked.",
    "unmetered",
  ],
  "STOP means stop": [
    "Respect for a text opt-out.",
    "If someone replies STOP, they stop getting texts for good, and Pulse writes that down.",
  ],
  "Reminders before the session": [
    "Reminders sent to clients ahead of a session.",
    "Pulse reminds the client before the session starts, with the last one two hours out, so they remember to come.",
  ],
  "The conversation stays with the client": [
    "Messages saved under the client's name.",
    "Any member of staff can open the conversation, so nobody has to ask what was already said.",
  ],
  "Telling the right staff": [
    "Notifications to the people who need to know.",
    "When something happens, Pulse tells the staff it affects.",
  ],
  "Send from your own Gmail": [
    "Client email sent from your studio's own address.",
    "Connect Google and client emails go out from your real address.",
  ],
  "One inbox": [
    "One place for conversations and approvals.",
    "Conversations and things waiting for approval are in one place instead of five.",
  ],

  /* Numbers */
  "How much money came in": [
    "A money summary for the month.",
    "It shows the month's total, whether it is going up or down, and where it came from.",
  ],
  "The numbers that matter": [
    "Four numbers Pulse tracks for you.",
    "They are how fast you reply to a new inquiry, how many inquiries turn into bookings, how many clients miss sessions, and how many bills are late.",
  ],
  "Arrange the home screen": [
    "A home screen the owner can rearrange.",
    "The owner drags the boxes around so the first screen matches the way they work.",
  ],
  "Charts": [
    "Charts of money and jobs.",
    "They show money over time, and how the open jobs are spread across the stages.",
  ],
  "What the booking page earned": [
    "A report on your public booking page.",
    "It shows how much money the page brought in and how many of those clients were new.",
  ],
  "How much of the plan is used": [
    "A meter for what your plan includes.",
    "It shows how much assistant use, storage, texting and email your studio has used against what the plan includes.",
    "allowances",
  ],
  "Download your numbers": [
    "An export of your studio's figures.",
    "You can pull your own figures out whenever you want them.",
  ],

  /* Making it look like theirs */
  "Colors from your logo": [
    "Brand colors pulled from your logo.",
    "Upload the logo. Pulse pulls the colors out of it and repaints the app while you watch.",
  ],
  "A photo at the top of the booking page": [
    "A header picture on your booking page.",
    "Upload one, or have Pulse make one that looks like your own photography.",
  ],
  "The words on the booking page": [
    "Editable text on your booking page.",
    "You write the headline, the welcome text and the deposit rules in your own voice.",
  ],
  "One brand color everywhere": [
    "Your color across everything a client sees.",
    "Clients see the same color on the booking page, the emails and the other pages meant for them.",
  ],
  "Their brand inside the app": [
    "Your logo and color in the app your team uses all day.",
    "Your staff open Pulse and see your studio's look, not a generic one.",
  ],
  "The app looks like theirs": [
    "A full skin for the app.",
    "It covers your colors, your fonts, how round the corners are, and how much space sits between things.",
  ],
  "Their own login screen": [
    "A login screen in your branding.",
    "The first screen anyone sees carries your headline, your words and your picture.",
  ],
  "Emails in their colors": [
    "Automatic emails in your studio's look.",
    "They go out in your colors and sign off in your words.",
  ],
  "Their own web address": [
    "The app on your own address.",
    "The whole app sits at your studio's own web address instead of ours.",
  ],
  "Colors stay readable": [
    "A readability check on your colors.",
    "Pulse checks that the colors you pick still have enough contrast to read, so nobody ends up with an app they cannot see.",
  ],
  "A small Pulse mark": [
    "A small Pulse name and symbol under your logo.",
    "It comes with the plan and cannot be removed.",
  ],

  /* Running many studios */
  "One screen for every studio": [
    "A single view for a company that runs many studios.",
    "You see all the studios, how each one is doing and what each one earned, in one place.",
    "studios",
  ],
  "Invite a studio by email": [
    "An email invitation to join Pulse under your brand.",
    "Send an email. The studio gets a sign-up with your branding on it and can take bookings the same day.",
  ],
  "Step-by-step setup": [
    "A guided setup for a new studio.",
    "It covers the logo, business details, booking words, payments, email and the first room. A studio can stop halfway and finish later.",
  ],
  "Pull details off their website": [
    "A way to fill in a new studio's details from its website.",
    "Take the details straight from the website the studio already has, instead of typing them in.",
  ],
  "Switch parts off per studio": [
    "Control over what each studio can use.",
    "Turn a whole section of the app off for one studio without touching any of the others.",
  ],
  "Staff who see only their studios": [
    "Limited access for your team.",
    "Team members are given a few studios and cannot open the rest.",
  ],
  "The console under your brand": [
    "Your studio-group screen under your own name.",
    "Your screen and all its studios appear under your name and your own web address.",
  ],
  "One approval queue for all studios": [
    "A single list of what is waiting for a person.",
    "Everything waiting on a person, across every studio, is lined up in one list.",
  ],
  "Who did what, where": [
    "A record of actions across your studios.",
    "It shows every action, which studio it happened in, and when.",
  ],
  "Fake data for a pitch": [
    "Sample data for a demo.",
    "Fill an empty studio with realistic made-up bookings and money for a demo, then wipe it clean.",
  ],

  /* Safety and privacy */
  "Studios cannot see each other": [
    "A wall between studios.",
    "Every question the app asks the database is locked to one studio. Files only open for the studio that owns them.",
  ],
  "One place that checks permissions": [
    "A single permission check used by the whole app.",
    "Every part of the app asks the same piece of code whether a person is allowed. With only one place to check, there is only one place to get right.",
  ],
  "Roles": [
    "Owner, manager, engineer, staff and guest.",
    "Each role opens only its own part of the app, so people see what their job needs.",
    "staff",
  ],
  "You get what you paid for": [
    "Your plan is enforced in the code itself.",
    "A locked feature stays locked even if someone finds its address.",
  ],
  "A permanent record": [
    "A log of important actions.",
    "Pulse writes down every refund, approval, invite and signature. It can add new entries, and nobody can change or delete an old one.",
  ],
  "Clients can get or delete their data": [
    "Tools for privacy requests.",
    "A client can ask for a copy of everything held about them, or ask for it to be deleted. Pulse builds both in.",
  ],
  "Guest links that expire": [
    "Guest links with a time limit.",
    "A guest link opens one thing only, stops working after a set time, and can be switched off early.",
  ],
  "Allowances counted per plan": [
    "Usage counting against your plan.",
    "Pulse counts how much the assistant and the file storage are used and caps them at what the plan includes.",
    "allowances",
  ],
  "Use it before setup is finished": [
    "A start that does not wait for setup.",
    "You can start working the moment you sign up and finish setting up later. The first booking does not have to wait.",
  ],
  "We move your data for free": [
    "A free move from your current system.",
    "Pulse copies your existing information across for you at no charge, and you are running within a day.",
  ],
  "No contract": [
    "Month to month billing.",
    "Cancel any month. There is no year-long agreement. Paying yearly is optional.",
  ],
  "955 automatic checks": [
    "Automatic tests that run on their own.",
    "They cover the money, the rule that keeps one studio's records away from another, and what each plan includes.",
  ],

  /* Production, media and gear check-out */
  "Post-production project tracking": [
    "A project for each record, with stages from tracking through mixing, mastering and delivery.",
    "Tasks, owners, due dates and deliverables sit on cards like the job board and on the today screen. They are linked to the sessions, songs, rooms, engineers and bills.",
  ],
  "Projects across every studio": [
    "A view of every project for a company that runs many studios.",
    "Every project in every studio is in one view.",
    "studios",
  ],
  "Media file management with version control": [
    "One searchable library for sessions, stems, mixes, masters, artwork and deliverables.",
    "Every upload is a numbered version with its history and notes, and the client approves the version they want.",
    "storage",
  ],
  "One media library shared across studios": [
    "A shared library for a company that runs many studios.",
    "Every studio can draw from one library, while each studio's own files stay its own.",
    "studios",
  ],
  "Barcode equipment check-in and check-out": [
    "Barcode labels for your gear.",
    "Print or assign a label for each piece of gear and scan it with a phone camera to check it out to a person, a session or a rental, and back in again. Pulse shows who has what, what is overdue, and keeps the history on the item.",
  ],
};

const fmtLimit = (n: number): string => (n >= UNLIMITED ? "unlimited" : String(n));

/** The "which plan" line, built from the real tier and ALLOWANCES. */
export function tiersLine(tier: TierKey, limit?: LimitKind): string {
  const name = (t: TierKey) => PRICING[t].name;
  const base =
    tier === "core"
      ? `Included on every plan: ${TIERS.map(name).join(", ").replace(/, ([^,]*)$/, " and $1")}.`
      : tier === "growth"
        ? `Included on ${name("growth")} and ${name("max")}. Not included on ${name("core")}.`
        : `Included on ${name("max")} only.`;
  if (!limit) return base;
  const eligible = TIERS.filter((t) => tierAtLeast(t, tier));
  const part = (label: string, pick: (a: Allowances) => number): string =>
    `${label}: ${eligible.map((t) => `${fmtLimit(pick(ALLOWANCES[t]))} on ${name(t)}`).join(", ")}.`;
  const lines: Record<LimitKind, string> = {
    rooms: part("Rooms", (a) => a.rooms),
    assistant: part("Assistant credits a month", (a) => a.assistantPerMonth),
    storage: part("File storage in GB", (a) => a.storageGb),
    staff: part("Team logins", (a) => a.staff),
    studios: part("Studios", (a) => a.studios),
    unmetered: "Texts and email are not capped on any plan.",
    allowances: [
      part("Assistant credits a month", (a) => a.assistantPerMonth),
      part("File storage in GB", (a) => a.storageGb),
    ].join(" "),
  };
  return `${base} ${lines[limit]}`;
}

function detailFor(groupId: string, f: RawFeature): FeatureDetail {
  const copy = DETAIL_COPY[`${groupId}:${f.name}`] ?? DETAIL_COPY[f.name];
  if (!copy) throw new Error(`pricing: no detail copy for feature "${f.name}"`);
  return { what: copy[0], does: copy[1], tiers: tiersLine(f.tier, copy[2]) };
}

export const FEATURE_GROUPS: FeatureGroup[] = RAW_FEATURE_GROUPS.map((g) => ({
  ...g,
  items: g.items.map((x) => ({ ...x, detail: detailFor(g.id, x) })),
}));

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

export type PublicFeature = { name: string; tier: TierKey; detail: FeatureDetail };
export type PublicFeatureGroup = { id: string; title: string; items: PublicFeature[] };

/** The customer-safe comparison table: no sales notes, no gates, and no
 *  feature that is not built. Groups left empty are dropped. Never contains
 *  a NOT_BUILT_YET item, because those were never features. */
export function publicFeatureGroups(): PublicFeatureGroup[] {
  return FEATURE_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    items: g.items
      .filter((x) => x.built)
      .map((x) => ({ name: x.name, tier: x.tier, detail: x.detail })),
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
