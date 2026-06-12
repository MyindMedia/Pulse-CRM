import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* ============================================================
   PULSE - Convex schema
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
  // ── Orgs - one row per studio subaccount. orgId is the Clerk org id
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
    brandPalette: v.optional(v.array(v.string())),
    tagline: v.optional(v.string()),
    // Branding
    logoId: v.optional(v.id("_storage")),
    // Public booking-page theming
    bookingHeroId: v.optional(v.id("_storage")),
    generatedHeroId: v.optional(v.id("_storage")),
    demoMode: v.optional(v.boolean()), // agency demo-data switch (see demoMode.ts)
    bookingHeadline: v.optional(v.string()),
    bookingIntro: v.optional(v.string()),
    depositPolicyText: v.optional(v.string()),
    // Provisioning metadata
    ownerName: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    clerkOrgId: v.optional(v.string()), // set once a real Clerk org is created
    createdByAgency: v.optional(v.boolean()),
    // Feature toggles - nav features the agency has DISABLED for this sub-account
    // (empty/unset = everything enabled). Keys match src/lib/features.ts.
    disabledFeatures: v.optional(v.array(v.string())),
    // NEW (agency mode - cycle 1)
    agencyId: v.optional(v.string()),     // parent agency, null for base tier
    tier: v.optional(v.union(             // cached for cap-check perf
      v.literal("studio"),
      v.literal("pro"),
      v.literal("agency"),
    )),
    // Per-service hourly rates (cents). Service keys mirror sessions.serviceType.
    // When unset, the room's hourlyRateCents is the source of truth.
    servicePricing: v.optional(
      v.object({
        recording: v.optional(v.number()),
        mixing: v.optional(v.number()),
        mastering: v.optional(v.number()),
        production: v.optional(v.number()),
        consultation: v.optional(v.number()),
        rehearsal: v.optional(v.number()),
        writing: v.optional(v.number()),
      }),
    ),
    // Custom discount codes the owner issues themselves (separate from
    // the AI rate-cut generator's deterministic codes). Stored on the
    // org so they're tenant-scoped and reusable across surfaces.
    discountCodes: v.optional(
      v.array(
        v.object({
          code: v.string(),
          pct: v.number(),
          label: v.optional(v.string()),
          active: v.boolean(),
        }),
      ),
    ),
    // Default cut % the AI rate-cut recommender suggests when it finds
    // an underused window. When unset the recommender uses its rule-based
    // default (15% / 20%).
    defaultRateCutPct: v.optional(v.number()),
    // US sales tax config. State drives a default rate; the owner can
    // override `taxRate` manually. `taxApply` toggles whether invoices
    // automatically add tax on top of the subtotal.
    taxState: v.optional(v.string()),
    taxRate: v.optional(v.number()),
    taxApply: v.optional(v.boolean()),
    // ── Studio onboarding (agency invite flow) ──
    // Company / contact info captured during the new-owner onboarding wizard.
    contact: v.optional(
      v.object({
        legalName: v.optional(v.string()),
        contactEmail: v.optional(v.string()),
        phone: v.optional(v.string()),
        address: v.optional(v.string()),
        website: v.optional(v.string()),
      }),
    ),
    // Set once the owner finishes (or explicitly skips to the end of) the
    // branded onboarding wizard. Unset => the dashboard nudges them to finish.
    onboardingCompletedAt: v.optional(v.number()),
    termsAcceptedAt: v.optional(v.number()),
    termsVersion: v.optional(v.string()),
    termsAcceptedBy: v.optional(v.string()),
    // ── Stripe Connect (P3) - studio collects deposits via its OWN account ──
    stripeAccountId: v.optional(v.string()),        // acct_… (Express connected account)
    stripeChargesEnabled: v.optional(v.boolean()),  // can accept charges
    stripeDetailsSubmitted: v.optional(v.boolean()), // finished Stripe onboarding
    // ── Email (P4) - per-account client-comms channel ──
    emailProvider: v.optional(v.union(v.literal("google"), v.literal("internal"))),
    googleEmail: v.optional(v.string()),            // connected Gmail address
    googleConnectedAt: v.optional(v.number()),
    googleRefreshToken: v.optional(v.string()),     // OAuth refresh token (server-only; never returned to client)
    // ── Inbound Google Calendar sync (Google -> Pulse busy blocks) ──
    googleCalendarSyncToken: v.optional(v.string()),  // Google incremental syncToken; undefined = full pull next
    googleCalendarSyncedAt: v.optional(v.number()),   // last successful inbound pull
    googleCalendarSyncError: v.optional(v.string()),  // last pull error (cleared on success)
    smsRemindersEnabled: v.optional(v.boolean()),   // automated session SMS reminders (default on when unset)
  })
    .index("by_org", ["orgId"])
    .index("by_slug", ["slug"])
    .index("by_agency", ["agencyId"])
    .index("by_stripe_account", ["stripeAccountId"]),

  users: defineTable({
    clerkUserId: v.string(),
    email: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
  }).index("by_clerk_id", ["clerkUserId"]),

  // ── Agency - the SaaS tenant. Only exists for Pro/Agency tier customers.
  //    Base-tier studios have no agency row. orgs.agencyId is optional. ──
  agencies: defineTable({
    agencyId: v.string(),                 // Clerk org_xxx of agency-level Clerk org
    name: v.string(),
    slug: v.string(),                     // resolves /a/<slug>
    plan: v.union(
      v.literal("studio"),
      v.literal("pro"),
      v.literal("growth"),
      v.literal("enterprise"),
      v.literal("agency"),                // legacy
      v.literal("agency_plus"),           // RESELL HOOK
    ),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("trial")),
    // Branding (white-label)
    logoId: v.optional(v.id("_storage")),
    faviconId: v.optional(v.id("_storage")),
    accentColor: v.optional(v.string()),
    customDomain: v.optional(v.string()),
    appName: v.optional(v.string()),
    // Stripe
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    // Resell hook (Agency Plus / SaaS Mode)
    resellEnabled: v.optional(v.boolean()),
    markupCents: v.optional(v.number()),
    // Provisioning
    ownerClerkUserId: v.string(),
    ownerEmail: v.string(),
  })
    .index("by_agency", ["agencyId"])
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerClerkUserId"]),

  // ── Agency members - humans with access to the agency console. The owner
  //    plus zero-or-more agency staff. NOT the same as members inside a sub-account. ──
  agencyMembers: defineTable({
    agencyId: v.string(),
    clerkUserId: v.string(),
    email: v.string(),
    name: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("admin"),
      v.literal("staff"),
      v.literal("billing"),
    ),
    capabilityOverrides: v.optional(v.array(v.string())),
    status: v.union(v.literal("active"), v.literal("invited"), v.literal("suspended")),
    invitedAt: v.number(),
    lastActiveAt: v.optional(v.number()),
  })
    .index("by_agency", ["agencyId"])
    .index("by_clerk", ["clerkUserId"])
    .index("by_agency_clerk", ["agencyId", "clerkUserId"]),

  // ── Agency-member scopes - which sub-accounts a "staff" role can reach.
  //    Empty for owner/admin (they get all). One row per (agencyMember, subAccountOrgId). ──
  agencyMemberScopes: defineTable({
    agencyId: v.string(),
    agencyMemberId: v.id("agencyMembers"),
    subAccountOrgId: v.string(),
    capabilityOverrides: v.optional(v.array(v.string())),
  })
    .index("by_member", ["agencyMemberId"])
    .index("by_subaccount", ["subAccountOrgId"]),

  // ── Magic-link collaborator grants - scoped pass for a non-account user.
  //    Token-backed, time-bounded. Music-industry-unique pattern. ──
  collaboratorGrants: defineTable({
    orgId: v.string(),                    // issuing studio
    agencyId: v.optional(v.string()),     // denormalized for audit
    email: v.string(),
    name: v.string(),
    scope: v.union(
      v.literal("session"),
      v.literal("song"),
      v.literal("deliverable"),
      v.literal("splitsheet"),
      v.literal("artist_portal"),
    ),
    entityId: v.string(),                 // sessions._id | songs._id | etc.
    capabilities: v.array(v.string()),
    token: v.string(),
    expiresAt: v.number(),
    revoked: v.optional(v.boolean()),
    invitedBy: v.string(),                // clerkUserId of issuer
    firstUsedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_token", ["token"])
    .index("by_entity", ["entityId"]),

  // ── Invites - beta studio-owner invitation flow. One row per outbound
  //    invite. Token-backed, time-bounded, single-use. The invite email
  //    links to /invite/<token> where the recipient creates their Pulse
  //    account. ──
  invites: defineTable({
    orgId: v.string(),                       // org string key (== clerkOrgId when Clerk is on, else synthetic "studio_<slug>"); matches orgs.orgId
    clerkOrgId: v.optional(v.string()),      // real Clerk org id, used for the Clerk membership API call
    agencyId: v.optional(v.string()),        // denormalized for console/audit
    email: v.string(),                       // invited owner email (lowercased)
    phone: v.optional(v.string()),           // optional pre-filled cell (E.164), carried invite→accept
    ownerName: v.string(),                   // shown on the screen + email
    studioName: v.string(),                  // shown on the screen + email
    role: v.union(                           // owner invite, or a staff role
      v.literal("owner"),
      v.literal("manager"),
      v.literal("engineer"),
      v.literal("assistant_engineer"),
      v.literal("artist_relations"),
      v.literal("producer"),
      v.literal("intern"),
      v.literal("accountant"),
    ),
    token: v.string(),                       // URL-safe random
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    expiresAt: v.number(),
    invitedBy: v.string(),                   // clerkUserId of issuer, or "system"
    emailStatus: v.union(
      v.literal("sent"),
      v.literal("failed"),
      v.literal("simulated"),
    ),
    acceptedAt: v.optional(v.number()),
  })
    .index("by_token", ["token"])
    .index("by_org", ["orgId"])
    .index("by_email", ["email"]),

  // ── SMS opt-outs - one row per phone that texted STOP. Checked before every
  //    send (A2P 10DLC compliance). Keyed globally by E.164 phone. ──
  smsOptOuts: defineTable({
    phone: v.string(),       // E.164
    optedOut: v.boolean(),
    updatedAt: v.number(),
  }).index("by_phone", ["phone"]),

  // ── Pulse Agent — tenant-isolated AI ops layer. Spec "workspace" == orgId.
  //    New tables per the Agent spec; gated by the access engine; the model
  //    reasons/drafts while Convex authorizes, executes, meters, and audits. ──
  agentPolicies: defineTable({
    orgId: v.string(),
    enabled: v.boolean(),
    defaultTone: v.union(
      v.literal("professional"), v.literal("friendly"), v.literal("luxury"),
      v.literal("direct"), v.literal("custom"),
    ),
    customToneInstructions: v.optional(v.string()),
    // Autonomy: approval-first by default. "suggest" = drafts/approvals only;
    // "auto_low" = low-risk internal actions auto; "auto_trusted" = trusted sends auto.
    autonomy: v.union(v.literal("suggest"), v.literal("auto_low"), v.literal("auto_trusted")),
    digestEnabled: v.boolean(),
    digestHourLocal: v.optional(v.number()), // 0-23, studio-local morning brief
    lastDigestAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_org", ["orgId"]),

  agentRuns: defineTable({
    orgId: v.string(),
    clerkUserId: v.optional(v.string()),
    initiatedBy: v.union(v.literal("user"), v.literal("system"), v.literal("automation")),
    runType: v.union(
      v.literal("chat"), v.literal("daily_digest"), v.literal("analytics_review"),
      v.literal("automation_recommendation"), v.literal("client_outreach_draft"),
      v.literal("session_prep"),
    ),
    status: v.union(
      v.literal("queued"), v.literal("running"), v.literal("needs_approval"),
      v.literal("completed"), v.literal("failed"), v.literal("cancelled"),
    ),
    prompt: v.optional(v.string()),
    summary: v.optional(v.string()),
    modelName: v.optional(v.string()),
    source: v.optional(v.string()),       // "openai" | "fallback"
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),

  agentMessages: defineTable({
    orgId: v.string(),
    runId: v.id("agentRuns"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    body: v.string(),
  }).index("by_run", ["runId"]),

  agentInsights: defineTable({
    orgId: v.string(),
    runId: v.optional(v.id("agentRuns")),
    title: v.string(),
    severity: v.union(v.literal("info"), v.literal("opportunity"), v.literal("warning"), v.literal("critical")),
    explanation: v.string(),
    status: v.union(v.literal("active"), v.literal("dismissed")),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),

  agentApprovals: defineTable({
    orgId: v.string(),
    runId: v.optional(v.id("agentRuns")),
    actionType: v.union(
      v.literal("send_email"), v.literal("send_sms"), v.literal("create_invoice"),
      v.literal("update_invoice"), v.literal("schedule_session"), v.literal("enable_automation"),
      v.literal("deliver_files"), v.literal("update_client_record"),
    ),
    title: v.string(),
    explanation: v.string(),
    proposedPayload: v.any(),
    riskLevel: v.union(v.literal("low"), v.literal("medium"), v.literal("high"), v.literal("critical")),
    status: v.union(
      v.literal("pending"), v.literal("approved"), v.literal("rejected"),
      v.literal("executed"), v.literal("failed"), v.literal("expired"),
    ),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    executedAt: v.optional(v.number()),
    result: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),

  agentUsage: defineTable({
    orgId: v.string(),
    period: v.string(),        // YYYY-MM
    runs: v.number(),
    drafts: v.number(),
    sends: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    updatedAt: v.number(),
  }).index("by_org_period", ["orgId", "period"]),

  agentAuditLogs: defineTable({
    orgId: v.string(),
    runId: v.optional(v.id("agentRuns")),
    event: v.string(),         // run.created, llm.called, insight.created, approval.created/decided/executed, ...
    detail: v.optional(v.string()),
    actor: v.optional(v.string()),
    at: v.number(),
  }).index("by_org", ["orgId"]),

  // Recurring agent task (spec 12). A saved prompt the agent runs on a schedule
  // - the deterministic side of "convert a suggestion into an automation".
  agentAutomations: defineTable({
    orgId: v.string(),
    name: v.string(),
    prompt: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly")),
    weekday: v.optional(v.number()),   // 0-6 for weekly
    enabled: v.boolean(),
    lastRunAt: v.optional(v.number()),
    runCount: v.number(),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_enabled", ["orgId", "enabled"]),

  // Per-workspace long-term agent memory. Never shared across orgs; explicit,
  // auditable, editable, deletable (spec 14).
  agentMemories: defineTable({
    orgId: v.string(),
    memoryType: v.union(
      v.literal("studio_profile"), v.literal("tone_preferences"), v.literal("business_rules"),
      v.literal("client_patterns"), v.literal("risk_notes"), v.literal("automation_history"),
    ),
    summary: v.string(),
    confidence: v.number(),
    source: v.union(v.literal("user"), v.literal("agent")),
    status: v.union(v.literal("active"), v.literal("pending"), v.literal("dismissed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"]),

  // ── Audit log - every Access Engine deny/grant for sensitive actions ──
  auditEvents: defineTable({
    agencyId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    viewerType: v.union(
      v.literal("agency_member"),
      v.literal("studio_member"),
      v.literal("guest"),
    ),
    viewerId: v.string(),
    action: v.string(),
    resource: v.optional(v.string()),
    result: v.union(v.literal("allow"), v.literal("deny")),
    reason: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_agency", ["agencyId"]),

  // ── App state - a keyed singleton. In demo mode (no Clerk) it holds the
  //    org the agency console is currently "entered into". ──
  appState: defineTable({
    key: v.string(), // "demo"
    activeOrgId: v.optional(v.string()),
  }).index("by_key", ["key"]),

  members: defineTable({
    orgId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),         // E.164 cell - studio record + future SMS
    role: v.union(
      v.literal("owner"),
      v.literal("manager"),
      v.literal("engineer"),
      v.literal("assistant_engineer"),    // NEW
      v.literal("artist_relations"),      // NEW
      v.literal("producer"),              // NEW
      v.literal("intern"),                // NEW
      v.literal("accountant"),            // NEW
    ),
    capabilityOverrides: v.optional(v.array(v.string())),  // NEW
    clerkUserId: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    photoId: v.optional(v.id("_storage")), // uploaded profile photo (Convex storage)
    clerkImageUrl: v.optional(v.string()), // auto-filled from the Clerk account avatar
    skills: v.array(v.string()), // gear / certifications, e.g. "Neve-certified"
    notes: v.optional(v.string()), // internal notes about the teammate
  })
    .index("by_org", ["orgId"])
    .index("by_org_clerk", ["orgId", "clerkUserId"]),

  // ── Artists / clients - the CRM contacts ──
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
    // Lead-source attribution (web booking form, referral, instagram, etc.) -
    // powers the lead-source ROI report + the lead→booking funnel.
    source: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["orgId"] }),

  // ── Songs - the spine of the product ──
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
    // Song Workspace overview signals
    deadline: v.optional(v.number()),
    ownerMemberId: v.optional(v.id("members")),
  })
    .index("by_org", ["orgId"])
    .index("by_org_stage", ["orgId", "stage"])
    .index("by_org_artist", ["orgId", "artistId"])
    .index("by_parent", ["parentSongId"])
    .searchIndex("search_title", { searchField: "title", filterFields: ["orgId"] }),

  // ── Rooms - the bookable studios / spaces ──
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
    heroImageUrl: v.optional(v.string()), // hero photo shown on the room card (seeded URL)
    heroImageId: v.optional(v.id("_storage")), // uploaded hero photo (Convex storage)
    // "auto" -> room status is computed from the live calendar (in_use when
    // a confirmed/in-progress session is happening now). "manual" -> staff
    // pinned the status and the recomputer leaves it alone. Undefined is
    // treated as "auto" for back-compat with already-seeded rooms.
    statusSource: v.optional(v.union(v.literal("auto"), v.literal("manual"))),
  }).index("by_org", ["orgId"]),

  // ── Equipment - gear assets. Installed in a room or sitting in storage.
  //    Installed gear inherits its room's availability; storage gear owns its
  //    own status. Every item carries a purchase price and a current value. ──
  equipment: defineTable({
    orgId: v.string(),
    name: v.string(),
    category: v.union(
      v.literal("console"),
      v.literal("mic"),
      v.literal("preamp"),
      v.literal("interface"),
      v.literal("outboard"),
      v.literal("monitor"),
      v.literal("monitor_controller"),
      v.literal("headphones"),
      v.literal("synth"),
      v.literal("midi"),
      v.literal("instrument"),
      v.literal("computer"),
      v.literal("rig"),
      v.literal("furniture"),
      v.literal("acoustic"),
      v.literal("decor"),
      v.literal("cable"),
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
    quantity: v.optional(v.number()), // units of this item (default 1); values are per-unit
    purchaseCents: v.number(), // what was paid (per unit)
    currentValueCents: v.number(), // current worth (per unit)
    purchaseDate: v.optional(v.number()),
    serialNumber: v.optional(v.string()),
    condition: v.optional(v.string()),
    notes: v.optional(v.string()),
    lastServicedAt: v.optional(v.number()),
    nextServiceAt: v.optional(v.number()),
    photoId: v.optional(v.id("_storage")), // uploaded photo (Convex file storage)
    photoUrl: v.optional(v.string()), // fallback URL - seeded demo gear
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
    smsRemindersSent: v.optional(v.array(v.string())), // which SMS reminders fired: "24h" | "2h"
    // Two-way Google Calendar sync: when the studio is connected, this is the
    // Google event id we created for this session so we can patch / delete it.
    googleCalendarEventId: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_start", ["orgId", "startTime"])
    .index("by_song", ["songId"])
    .index("by_artist", ["artistId"]),

  // ── Payments - the booking-payment ledger and the provider seam.
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

  // ── Notifications - confirmation / reminder messages. The notify() seam
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

  // ── Engineering log - "Recall Sheet 2.0" ──
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

  // ── Deliverables - versioned files with approval + payment gate ──
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
    // Stored file (Convex storage). Download is gated server-side when
    // paymentGated is true and the song's balance is unpaid.
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    mimeType: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_song", ["songId"]),

  // ── Revision comments - timestamped, version-anchored ──
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

  // ── Split sheets - composition + master, an enforced gate ──
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
        // Captured at signing time via the public /sign/[token] page so the
        // `signed` flag is legally backed rather than a bare checkbox.
        signedAt: v.optional(v.number()),
        signature: v.optional(v.string()), // typed full name or drawn data URI
        signedFromUa: v.optional(v.string()), // user-agent at signing time
      }),
    ),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_song", ["songId"]),

  // ── Invoices ──
  // Registry of rows inserted by the agency demo-data filler, so flipping a
  // sub-account back to live deletes exactly what the demo added.
  demoRows: defineTable({
    orgId: v.string(),
    table: v.string(),
    docId: v.string(),
  }).index("by_org", ["orgId"]),

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
    overdueNotifiedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_artist", ["artistId"]),

  // ── Reusable invoice fee templates - flat one-off charges (mix/master
  //    per song, annual maintenance, etc.) a studio can quick-add to an
  //    invoice. Invoice lines stay plain {label, amountCents}; these are
  //    just the saved presets. ──
  feeTemplates: defineTable({
    orgId: v.string(),
    label: v.string(),
    amountCents: v.number(),
    description: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  // ── Software + license management - DAWs, plugins, sample libraries and
  //    subscriptions the studio owns. Tracks cost, seats, renewal, and the
  //    license key. Tenant-scoped. ──
  softwareLicenses: defineTable({
    orgId: v.string(),
    name: v.string(),                  // "Pro Tools", "FabFilter Pro-Q 3"
    vendor: v.optional(v.string()),    // "Avid", "FabFilter"
    category: v.union(
      v.literal("daw"),
      v.literal("plugin"),
      v.literal("sample_library"),
      v.literal("subscription"),
      v.literal("utility"),
      v.literal("other"),
    ),
    licenseType: v.union(v.literal("perpetual"), v.literal("subscription")),
    seats: v.optional(v.number()),
    costCents: v.number(),
    billingInterval: v.union(
      v.literal("one_time"),
      v.literal("monthly"),
      v.literal("annual"),
    ),
    purchaseDate: v.optional(v.number()),
    renewalDate: v.optional(v.number()),   // next charge / expiry (subscriptions)
    licenseKey: v.optional(v.string()),    // serial / auth code (sensitive)
    seatHolder: v.optional(v.string()),    // machine or person it's installed on
    status: v.union(
      v.literal("active"),
      v.literal("expired"),
      v.literal("unused"),
    ),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

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
    notes: v.optional(v.string()),
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

  // ── AI insights - recaps, nudges, intelligence ──
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

  // ── AI-generated artifacts: session recaps, prep packets, no-show
  //    reminders, weekly briefings, rate-cut promo emails. Stored so the
  //    studio owner can review, copy, edit, and (eventually) send. ──
  aiArtifacts: defineTable({
    orgId: v.string(),
    kind: v.union(
      v.literal("session_recap"),
      v.literal("prep_packet"),
      v.literal("reminder_24h"),
      v.literal("reminder_1h"),
      v.literal("weekly_briefing"),
      v.literal("rate_cut_promo"),
      // Agentic drafts (created by the named AI agents -> approval inbox)
      v.literal("lead_followup"),
      v.literal("revision_triage"),
      v.literal("reactivation_campaign"),
      v.literal("rights_alert"),
    ),
    // Entity link (sometimes session, sometimes none for org-level artifacts)
    sessionId: v.optional(v.id("sessions")),
    roomId: v.optional(v.id("rooms")),
    // The artifact body itself
    title: v.string(),
    summary: v.string(), // short, plain text (for the dashboard card)
    body: v.optional(v.string()), // longer markdown / formatted body
    emailDraft: v.optional(
      v.object({
        to: v.optional(v.string()),
        subject: v.string(),
        body: v.string(),
      }),
    ),
    // Source = "openai" or "fallback" so the UI can mark which is which
    source: v.union(v.literal("openai"), v.literal("fallback")),
    model: v.optional(v.string()),
    status: v.union(
      v.literal("ready"),
      v.literal("acknowledged"),
      v.literal("dismissed"),
    ),
    generatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_kind", ["orgId", "kind"])
    .index("by_session", ["sessionId"])
    .index("by_org_status", ["orgId", "status"]),

  // ── Pre / post session checklists. One row per (session, kind).
  //    Pre-checklist is staged when the session is created, and pruned if
  //    the session is cancelled before it runs. Post-checklist sticks
  //    around as a record of what was done after a completed session. ──
  sessionChecklists: defineTable({
    orgId: v.string(),
    sessionId: v.id("sessions"),
    roomId: v.optional(v.id("rooms")),
    kind: v.union(v.literal("pre"), v.literal("post")),
    items: v.array(
      v.object({
        label: v.string(),
        done: v.boolean(),
        doneByName: v.optional(v.string()),
        doneAt: v.optional(v.number()),
      }),
    ),
  })
    .index("by_org", ["orgId"])
    .index("by_session", ["sessionId"])
    .index("by_session_kind", ["sessionId", "kind"]),

  // ── External calendars (read-only iCal feeds - Google, Apple, Outlook,
  //    any source that exposes an .ics URL). One row per (room, feed). ──
  externalCalendars: defineTable({
    orgId: v.string(),
    roomId: v.id("rooms"),
    label: v.string(),
    source: v.union(
      v.literal("google"),
      v.literal("ical"),
      v.literal("outlook"),
      v.literal("apple"),
      v.literal("other"),
    ),
    icalUrl: v.string(),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    eventCount: v.optional(v.number()),
    active: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_room", ["roomId"]),

  // ── Imported external events. Block times so the studio doesn't get
  //    double-booked against an outside calendar. Idempotent on externalUid. ──
  externalCalendarEvents: defineTable({
    orgId: v.string(),
    calendarId: v.id("externalCalendars"),
    roomId: v.id("rooms"),
    externalUid: v.string(),
    title: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    allDay: v.optional(v.boolean()),
    location: v.optional(v.string()),
    description: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_calendar", ["calendarId"])
    .index("by_org_room_start", ["orgId", "roomId", "startTime"])
    .index("by_uid", ["calendarId", "externalUid"]),

  // ── Busy blocks pulled from the studio's CONNECTED Google primary calendar
  //    (OAuth, not iCal). Org-wide (the primary calendar isn't room-specific):
  //    they give conflict awareness on the schedule without fabricating
  //    sessions. Pulse-origin events are skipped on pull so nothing loops.
  //    Idempotent on (orgId, googleEventId). ──
  googleBusyBlocks: defineTable({
    orgId: v.string(),
    googleEventId: v.string(),
    title: v.string(),
    startTime: v.number(),
    endTime: v.number(),
    allDay: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_start", ["orgId", "startTime"])
    .index("by_event", ["orgId", "googleEventId"]),

  // ── Ops Autopilot - proposed (or executed) operational actions. Unlike
  //    `insights` (read-only nudges), each row carries an executable payload
  //    and an approval lifecycle. The ops brain writes these; the owner
  //    approves/dismisses, or trusted types auto-execute. ──
  opsActions: defineTable({
    orgId: v.string(),
    type: v.union(
      v.literal("reengage_quiet_artist"),
      v.literal("payment_reminder"),
      v.literal("confirm_unconfirmed_session"),
      v.literal("promote_underused_room"),
      v.literal("resolve_revision_overflow"),
      v.literal("chase_split_sheet"),
      v.literal("deposit_unpaid_nudge"),
      // Named-agent action types (unified approval inbox)
      v.literal("convert_lead"),
      v.literal("session_prep_packet"),
      v.literal("post_session_recap"),
      v.literal("revision_triage"),
      v.literal("complete_rights_metadata"),
      v.literal("pricing_opportunity"),
      v.literal("no_show_risk"),
      v.literal("weak_lead_source"),
      v.literal("waitlist_fill"),
    ),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    title: v.string(),
    rationale: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    // What executing the action actually does.
    payload: v.union(
      v.object({
        kind: v.literal("email"),
        to: v.optional(v.string()),
        subject: v.string(),
        body: v.string(),
        notifyKind: v.string(),
      }),
      v.object({
        kind: v.literal("session_status"),
        sessionId: v.id("sessions"),
        newStatus: v.union(v.literal("confirmed"), v.literal("cancelled")),
      }),
      v.object({ kind: v.literal("note_only") }),
    ),
    status: v.union(
      v.literal("proposed"),
      v.literal("approved"),
      v.literal("executing"),
      v.literal("executed"),
      v.literal("failed"),
      v.literal("dismissed"),
      v.literal("snoozed"),
    ),
    autonomy: v.boolean(), // true when auto-executed (Phase 3)
    source: v.union(v.literal("openai"), v.literal("rule")),
    model: v.optional(v.string()),
    dedupeKey: v.string(), // `${type}:${entityId}` - open-row dedupe
    snoozeUntil: v.optional(v.number()),
    decidedBy: v.optional(v.string()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    executedAt: v.optional(v.number()),
    result: v.optional(v.string()),
    // Unified inbox: link to the rich AI draft (body lives in aiArtifacts) and
    // the user-edited body captured before approve/send.
    artifactId: v.optional(v.id("aiArtifacts")),
    editedBody: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_dedupe", ["orgId", "dedupeKey"])
    .index("by_entity", ["entityId"]),

  // ── Ops Autopilot autonomy policy + trust stats, per (org, actionType).
  //    mode "auto" graduates an action type to auto-execute. ──
  opsAutonomy: defineTable({
    orgId: v.string(),
    actionType: v.string(),
    mode: v.union(v.literal("manual"), v.literal("auto")),
    approvedCount: v.number(),
    dismissedCount: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_type", ["orgId", "actionType"]),

  // ── Usage metering - one aggregate counter per (org, period, metric).
  //    period is "YYYY-MM" (or "all" for non-resetting totals like storage).
  //    Drives plan-limit enforcement + the usage panel. Aggregate counters
  //    (not event rows) keep reads cheap. ──
  usageCounters: defineTable({
    orgId: v.string(),
    period: v.string(), // "YYYY-MM" | "all"
    metric: v.string(), // "ai_credits" | "storage_bytes" | "email" | "sms" | "exports" | "subaccounts"
    value: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_period_metric", ["orgId", "period", "metric"]),

  // ── Staff scheduling - shifts assign a team member to a time window and
  //    (optionally) a studio/room. kind "session" shifts are auto-created when
  //    an engineer is booked onto a session and link back via sessionId. ──
  shifts: defineTable({
    orgId: v.string(),
    memberId: v.id("members"),
    startTime: v.number(),
    endTime: v.number(),
    roomId: v.optional(v.id("rooms")),       // studio/room they're staffing
    kind: v.union(v.literal("scheduled"), v.literal("session")),
    sessionId: v.optional(v.id("sessions")), // set for kind "session"
    status: v.union(v.literal("scheduled"), v.literal("confirmed"), v.literal("cancelled")),
    note: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_member", ["orgId", "memberId"])
    .index("by_org_start", ["orgId", "startTime"])
    .index("by_session", ["sessionId"]),

  // ── Recurring weekly availability a staff member sets for themselves. ──
  availability: defineTable({
    orgId: v.string(),
    memberId: v.id("members"),
    weekday: v.number(),        // 0=Sun … 6=Sat
    startMinutes: v.number(),   // minutes from midnight, local
    endMinutes: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_member", ["orgId", "memberId"]),

  // ── Time-off requests with a simple approval flow. ──
  timeOff: defineTable({
    orgId: v.string(),
    memberId: v.id("members"),
    startTime: v.number(),
    endTime: v.number(),
    reason: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied")),
    decidedBy: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_member", ["orgId", "memberId"])
    .index("by_org_status", ["orgId", "status"]),

  // ── Client email log - outbound messages sent to a client (artist), so the
  //    studio sees a per-client history. Channel = google (their Gmail) or
  //    internal (Resend via Pulse). ──
  clientMessages: defineTable({
    orgId: v.string(),
    artistId: v.id("artists"),
    direction: v.union(v.literal("out"), v.literal("in")),
    subject: v.string(),
    body: v.string(),
    channel: v.union(v.literal("google"), v.literal("internal"), v.literal("sms")),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("simulated"), v.literal("received")),
    sentBy: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_artist", ["artistId"]),

  // ── Waitlist - artists waiting for an open slot. When a hold expires or a
  //    booking is cancelled, smart-fill ranks matching entries and proposes a
  //    `waitlist_fill` action (notify the best match) into the approval inbox. ──
  waitlistEntries: defineTable({
    orgId: v.string(),
    artistId: v.id("artists"),
    roomId: v.optional(v.id("rooms")), // preferred room; absent = any room
    serviceType: v.optional(serviceType), // preferred service; absent = any
    note: v.optional(v.string()),
    priority: v.union(v.literal("standard"), v.literal("high")), // manual VIP bump
    status: v.union(
      v.literal("waiting"),
      v.literal("notified"),
      v.literal("booked"),
      v.literal("removed"),
    ),
    preferredFrom: v.optional(v.number()), // earliest desired start (epoch ms)
    preferredTo: v.optional(v.number()), // latest desired start (epoch ms)
    lastNotifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_artist", ["artistId"]),

  // ── Membership plans - studio-defined monthly/yearly tiers (priority booking,
  //    bundled hours, member discount) billed via Stripe Connect. ──
  membershipPlans: defineTable({
    orgId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),
    billingInterval: v.union(v.literal("month"), v.literal("year")),
    // Perks (any combination).
    bundledHoursPerPeriod: v.optional(v.number()),
    memberDiscountPct: v.optional(v.number()), // 0-100, applied to session rate
    priorityBooking: v.optional(v.boolean()),
    active: v.boolean(),
    // The studio creates a recurring Price in its own Stripe dashboard and
    // pastes the price id here; we never create products on their behalf.
    stripePriceId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_active", ["orgId", "active"]),

  memberships: defineTable({
    orgId: v.string(),
    artistId: v.id("artists"),
    planId: v.id("membershipPlans"),
    status: v.union(
      v.literal("pending"), // checkout created, not yet confirmed
      v.literal("active"),
      v.literal("past_due"),
      v.literal("cancelled"),
      v.literal("trialing"),
    ),
    currentPeriodStart: v.optional(v.number()),
    currentPeriodEnd: v.optional(v.number()),
    hoursUsedThisPeriod: v.number(),
    stripeSubscriptionId: v.optional(v.string()),
    stripeCustomerId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_artist", ["artistId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),
});
