import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* ============================================================
   PULSE — Convex schema
   A song-centric CRM. The `songs` table is the spine: one record
   carries from inquiry → session → splits → delivery → release.
   Every business table is scoped by `orgId` (Clerk org id, or the
   "pulse-demo" workspace in demo mode). orgId is field #1 of every index.
   Money is stored as integer cents.
   ============================================================ */

// ── Shared validators ──
const artistType = v.union(
  v.literal("artist"),
  v.literal("producer"),
  v.literal("band"),
  v.literal("label"),
  v.literal("songwriter"),
  v.literal("other"),
);

const songStage = v.union(
  v.literal("writing"),
  v.literal("demo"),
  v.literal("tracking"),
  v.literal("editing"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("delivered"),
  v.literal("released"),
);

const serviceType = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
);

const sessionStatus = v.union(
  v.literal("tentative"),
  v.literal("confirmed"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("no_show"),
);

const pipelineStage = v.union(
  v.literal("inquiry"),
  v.literal("qualified"),
  v.literal("proposal"),
  v.literal("booked"),
  v.literal("in_progress"),
  v.literal("delivered"),
  v.literal("won"),
  v.literal("lost"),
);

export default defineSchema({
  // ── Orgs — one row per studio subaccount. orgId is the Clerk org id
  //    (org_xxx) or "pulse-demo". The agency console provisions these. ──
  orgs: defineTable({
    orgId: v.string(), // Clerk org_xxx or "pulse-demo"
    name: v.string(),
    slug: v.string(), // resolves /book/<slug>
    plan: v.union(v.literal("solo"), v.literal("studio"), v.literal("label")),
    status: v.optional(
      v.union(v.literal("active"), v.literal("paused"), v.literal("setup")),
    ),
    accentColor: v.optional(v.string()),
    tagline: v.optional(v.string()),
    // Branding
    logoId: v.optional(v.id("_storage")),
    // Public booking-page theming
    bookingHeroId: v.optional(v.id("_storage")),
    bookingHeadline: v.optional(v.string()),
    bookingIntro: v.optional(v.string()),
    depositPolicyText: v.optional(v.string()),
    // Provisioning metadata
    ownerName: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    clerkOrgId: v.optional(v.string()), // set once a real Clerk org is created
    createdByAgency: v.optional(v.boolean()),
  })
    .index("by_org", ["orgId"])
    .index("by_slug", ["slug"]),

  users: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
  }).index("by_clerk_id", ["clerkUserId"]),

  // ── App state — a keyed singleton. In demo mode (no Clerk) it holds the
  //    org the agency console is currently "entered into". ──
  appState: defineTable({
    key: v.string(), // "demo"
    activeOrgId: v.optional(v.string()),
  }).index("by_key", ["key"]),

  members: defineTable({
    orgId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("manager"), v.literal("engineer")),
    clerkUserId: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    skills: v.array(v.string()), // gear / certifications, e.g. "Neve-certified"
  })
    .index("by_org", ["orgId"])
    .index("by_org_clerk", ["orgId", "clerkUserId"]),

  // ── Artists / clients — the CRM contacts ──
  artists: defineTable({
    orgId: v.string(),
    name: v.string(),
    type: artistType,
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    location: v.optional(v.string()),
    genres: v.array(v.string()),
    tags: v.array(v.string()),
    avatarColor: v.optional(v.string()),
    instagram: v.optional(v.string()),
    spotify: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.union(v.literal("lead"), v.literal("active"), v.literal("dormant"), v.literal("vip")),
    lifetimeValueCents: v.number(),
    sessionCount: v.number(),
    reliability: v.union(v.literal("solid"), v.literal("watch"), v.literal("flagged")),
    preferredEngineerId: v.optional(v.id("members")),
    referredByArtistId: v.optional(v.id("artists")),
    lastContactAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["orgId"] }),

  // ── Songs — the spine of the product ──
  songs: defineTable({
    orgId: v.string(),
    title: v.string(),
    artistId: v.id("artists"),
    kind: v.union(
      v.literal("single"),
      v.literal("album_track"),
      v.literal("beat"),
      v.literal("spec"),
      v.literal("ep"),
    ),
    parentSongId: v.optional(v.id("songs")), // album → child tracks
    stage: songStage,
    genre: v.optional(v.string()),
    bpm: v.optional(v.number()),
    musicalKey: v.optional(v.string()),
    mode: v.optional(v.string()), // Major / Minor
    moodTags: v.array(v.string()),
    coverColor: v.optional(v.string()),
    brief: v.optional(v.string()), // creative brief
    referenceTracks: v.array(
      v.object({ title: v.string(), url: v.string(), note: v.optional(v.string()) }),
    ),
    // metadata vault
    isrc: v.optional(v.string()),
    iswc: v.optional(v.string()),
    releaseDate: v.optional(v.number()),
    // revision budget (anti-scope-creep)
    revisionsIncluded: v.number(),
    revisionsUsed: v.number(),
    // spec pipeline
    specStatus: v.optional(
      v.union(v.literal("idea"), v.literal("demo"), v.literal("shopped"), v.literal("pitched"), v.literal("picked_up"), v.literal("shelved")),
    ),
    streamCount: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_stage", ["orgId", "stage"])
    .index("by_org_artist", ["orgId", "artistId"])
    .index("by_parent", ["parentSongId"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["orgId"] }),

  // ── Rooms — the bookable studios / spaces ──
  rooms: defineTable({
    orgId: v.string(),
    name: v.string(),
    roomType: v.optional(v.string()), // "Live room", "Mix suite", "Writing room"...
    hourlyRateCents: v.optional(v.number()),
    status: v.union(
      v.literal("available"),
      v.literal("in_use"),
      v.literal("maintenance"),
      v.literal("retired"),
    ),
    condition: v.optional(v.string()),
    lastServicedAt: v.optional(v.number()),
    nextServiceAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    // Public booking config
    minimumHours: v.optional(v.number()), // shortest bookable block
    depositPct: v.optional(v.number()), // deposit as a % of the booking total
    bookable: v.optional(v.boolean()), // shown on the public /book page
  }).index("by_org", ["orgId"]),

  // ── Equipment — gear assets. Installed in a room or sitting in storage.
  //    Installed gear inherits its room's availability; storage gear owns its
  //    own status. Every item carries a purchase price and a current value. ──
  equipment: defineTable({
    orgId: v.string(),
    name: v.string(),
    category: v.union(
      v.literal("console"),
      v.literal("mic"),
      v.literal("outboard"),
      v.literal("instrument"),
      v.literal("monitor"),
      v.literal("rig"),
      v.literal("other"),
    ),
    installedInRoomId: v.optional(v.id("rooms")), // unset → in storage
    // Authoritative while in storage; installed gear follows its room.
    status: v.union(
      v.literal("available"),
      v.literal("in_use"),
      v.literal("maintenance"),
      v.literal("retired"),
    ),
    purchaseCents: v.number(), // what was paid
    currentValueCents: v.number(), // current worth
    purchaseDate: v.optional(v.number()),
    serialNumber: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
    lastServicedAt: v.optional(v.number()),
    nextServiceAt: v.optional(v.number()),
    photoId: v.optional(v.id("_storage")), // uploaded photo (Convex file storage)
    photoUrl: v.optional(v.string()), // fallback URL — seeded demo gear
  })
    .index("by_org", ["orgId"])
    .index("by_org_room", ["orgId", "installedInRoomId"]),

  // ── Sessions (bookings) ──
  sessions: defineTable({
    orgId: v.string(),
    title: v.string(),
    artistId: v.id("artists"),
    songId: v.optional(v.id("songs")),
    serviceType,
    roomId: v.optional(v.id("rooms")),
    engineerId: v.optional(v.id("members")),
    startTime: v.number(),
    endTime: v.number(),
    status: sessionStatus,
    rateCents: v.number(),
    depositCents: v.number(),
    depositPaid: v.boolean(),
    intakeCompleted: v.boolean(),
    notes: v.optional(v.string()),
    // Payment + booking lifecycle
    amountPaidCents: v.optional(v.number()), // running total of cleared payments
    source: v.optional(v.string()), // "public_booking" | "internal"
    holdExpiresAt: v.optional(v.number()), // unpaid hold auto-releases at this time
    balanceRemindedAt: v.optional(v.number()), // set once the "pay in full" nudge fires
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_start", ["orgId", "startTime"])
    .index("by_song", ["songId"])
    .index("by_artist", ["artistId"]),

  // ── Payments — the booking-payment ledger and the provider seam.
  //    Simulated today; real Stripe records land in the same shape. ──
  payments: defineTable({
    orgId: v.string(),
    sessionId: v.id("sessions"),
    kind: v.union(v.literal("deposit"), v.literal("balance"), v.literal("full")),
    amountCents: v.number(),
    provider: v.union(v.literal("simulated"), v.literal("stripe")),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("refunded"),
    ),
    reference: v.optional(v.string()), // provider charge / checkout reference
    payerName: v.optional(v.string()),
    paidAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_session", ["sessionId"]),

  // ── Notifications — confirmation / reminder messages. The notify() seam
  //    logs them here; real email/SMS delivery drops in behind it later. ──
  notifications: defineTable({
    orgId: v.string(),
    channel: v.union(v.literal("email"), v.literal("sms")),
    recipient: v.string(),
    subject: v.string(),
    body: v.string(),
    kind: v.string(), // booking.confirmed, balance.reminder, hold.released...
    sessionId: v.optional(v.id("sessions")),
    status: v.union(v.literal("simulated"), v.literal("sent"), v.literal("failed")),
  })
    .index("by_org", ["orgId"])
    .index("by_session", ["sessionId"]),

  // ── Engineering log — "Recall Sheet 2.0" ──
  engineeringLogs: defineTable({
    orgId: v.string(),
    sessionId: v.id("sessions"),
    songId: v.optional(v.id("songs")),
    sampleRate: v.optional(v.string()),
    bitDepth: v.optional(v.string()),
    tuningRef: v.optional(v.string()), // 440 / 432
    monitoring: v.optional(v.string()),
    tempoMap: v.optional(v.string()),
    signalChains: v.array(
      v.object({
        track: v.string(),
        source: v.string(),
        mic: v.optional(v.string()),
        preamp: v.optional(v.string()),
        outboard: v.optional(v.string()),
        input: v.optional(v.string()),
        micPosition: v.optional(v.string()),
      }),
    ),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_session", ["sessionId"]),

  // ── Deliverables — versioned files with approval + payment gate ──
  deliverables: defineTable({
    orgId: v.string(),
    songId: v.id("songs"),
    kind: v.union(
      v.literal("mix"),
      v.literal("master"),
      v.literal("stems"),
      v.literal("instrumental"),
      v.literal("reference"),
      v.literal("backup"),
    ),
    version: v.number(),
    label: v.string(),
    status: v.union(v.literal("delivered"), v.literal("in_review"), v.literal("approved"), v.literal("final")),
    durationSec: v.optional(v.number()),
    paymentGated: v.boolean(),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_song", ["songId"]),

  // ── Revision comments — timestamped, version-anchored ──
  revisionComments: defineTable({
    orgId: v.string(),
    songId: v.id("songs"),
    deliverableId: v.id("deliverables"),
    timestampSec: v.number(),
    body: v.string(),
    authorName: v.string(),
    resolved: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_deliverable", ["deliverableId"])
    .index("by_song", ["songId"]),

  // ── Split sheets — composition + master, an enforced gate ──
  splitSheets: defineTable({
    orgId: v.string(),
    songId: v.id("songs"),
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("fully_executed")),
    contributors: v.array(
      v.object({
        name: v.string(),
        role: v.string(),
        masterPct: v.number(),
        publishingPct: v.number(),
        pro: v.optional(v.string()),
        ipi: v.optional(v.string()),
        email: v.optional(v.string()),
        signed: v.boolean(),
      }),
    ),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_song", ["songId"]),

  // ── Invoices ──
  invoices: defineTable({
    orgId: v.string(),
    number: v.string(),
    artistId: v.id("artists"),
    songId: v.optional(v.id("songs")),
    sessionId: v.optional(v.id("sessions")),
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("viewed"),
      v.literal("paid"),
      v.literal("overdue"),
      v.literal("void"),
    ),
    lineItems: v.array(v.object({ label: v.string(), amountCents: v.number() })),
    amountCents: v.number(),
    dueDate: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_artist", ["artistId"]),

  // ── Pipeline / opportunities ──
  opportunities: defineTable({
    orgId: v.string(),
    title: v.string(),
    artistId: v.id("artists"),
    stage: pipelineStage,
    valueCents: v.number(),
    serviceType,
    probability: v.number(), // 0..1
    source: v.optional(v.string()),
    songId: v.optional(v.id("songs")),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_stage", ["orgId", "stage"])
    .index("by_artist", ["artistId"]),

  // ── Sync-licensing pipeline ──
  syncOpportunities: defineTable({
    orgId: v.string(),
    songId: v.id("songs"),
    supervisorName: v.string(),
    outlet: v.string(), // film / TV / ad / game
    stage: v.union(
      v.literal("pitched"),
      v.literal("heard"),
      v.literal("shortlisted"),
      v.literal("negotiating"),
      v.literal("placed"),
      v.literal("passed"),
    ),
    feeCents: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_song", ["songId"]),

  // ── Release campaigns ──
  releaseCampaigns: defineTable({
    orgId: v.string(),
    songId: v.id("songs"),
    releaseDate: v.number(),
    status: v.union(v.literal("planning"), v.literal("active"), v.literal("released")),
    tasks: v.array(
      v.object({ label: v.string(), offsetDays: v.number(), done: v.boolean(), owner: v.optional(v.string()) }),
    ),
  })
    .index("by_org", ["orgId"])
    .index("by_song", ["songId"]),

  // ── Beat licenses (multi-license manager) ──
  licenses: defineTable({
    orgId: v.string(),
    songId: v.id("songs"), // a beat
    buyerName: v.string(),
    buyerArtistId: v.optional(v.id("artists")),
    tier: v.union(v.literal("mp3"), v.literal("wav"), v.literal("trackout"), v.literal("exclusive")),
    priceCents: v.number(),
    termMonths: v.optional(v.number()),
    streamCap: v.optional(v.number()),
    active: v.boolean(),
    soldAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_song", ["songId"]),

  // ── Activity feed ──
  activity: defineTable({
    orgId: v.string(),
    kind: v.string(), // session.completed, invoice.paid, song.stage, etc.
    summary: v.string(),
    actorName: v.optional(v.string()),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    accent: v.optional(v.string()), // gold | positive | critical | info
  }).index("by_org", ["orgId"]),

  // ── AI insights — recaps, nudges, intelligence ──
  insights: defineTable({
    orgId: v.string(),
    kind: v.union(
      v.literal("recap"),
      v.literal("reengage"),
      v.literal("revenue"),
      v.literal("risk"),
      v.literal("opportunity"),
    ),
    title: v.string(),
    body: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    status: v.union(v.literal("new"), v.literal("seen"), v.literal("actioned"), v.literal("dismissed")),
    severity: v.union(v.literal("info"), v.literal("opportunity"), v.literal("warning")),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),
});
