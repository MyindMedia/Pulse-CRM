import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/* ============================================================
   PULSE - Convex schema
   The studio operating system. The `songs` table is one spine: a record
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

/* The studio's own categories, plus "custom".

   A studio does not only sell sessions. Owners block the calendar for a tour,
   a maintenance day, a personal hold - work that is real, occupies a room, and
   is none of the seven services. "custom" carries a label the studio types
   (`sessions.customService`), so the calendar can say "Tour" instead of
   forcing every non-session into "consultation". It is INTERNAL: the public
   booking form never offers it (see convex/booking.ts), because a client
   inventing a category is a different thing entirely. */
const serviceType = v.union(
  v.literal("recording"),
  v.literal("mixing"),
  v.literal("mastering"),
  v.literal("production"),
  v.literal("consultation"),
  v.literal("rehearsal"),
  v.literal("writing"),
  v.literal("custom"),
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

// ── Patch Manager validators ──
// Shared by device profiles, ports, connections and the cable stock fields
// on `equipment`. Kept here so the port template on a profile and the real
// port on an instance can never drift apart.

/** Which way audio moves through a port. */
const portDirection = v.union(
  v.literal("input"),
  v.literal("output"),
  v.literal("bidirectional"),
);

/** Operating level. Drives the mic-into-line style mismatch warnings. */
const signalLevel = v.union(
  v.literal("mic"),
  v.literal("line"),
  v.literal("instrument"),
  v.literal("speaker"),
  v.literal("digital"),
  v.literal("control"),
);

/** Physical connector on the panel. A DB25 is one connector, eight ports.
    Split to real granularity: "USB" is not a connector, USB-A, USB-B and
    USB-C are three plugs that do not fit each other. The bare `xlr` and
    `usb` values are kept for rows written before the split and are treated
    as "some variant of this family" by the mating checks. */
const connectorType = v.union(
  v.literal("xlr3"),
  v.literal("xlr5"),
  v.literal("trs"),
  v.literal("ts"),
  v.literal("trs_mini"),
  v.literal("bantam"),
  v.literal("db25"),
  v.literal("speakon"),
  v.literal("banana"),
  v.literal("rca"),
  v.literal("bnc"),
  v.literal("wordclock_bnc"),
  v.literal("midi_din"),
  v.literal("rj45"),
  v.literal("usb_a"),
  v.literal("usb_b"),
  v.literal("usb_b_mini"),
  v.literal("usb_b_micro"),
  v.literal("usb_c"),
  v.literal("thunderbolt"),
  v.literal("adat_optical"),
  v.literal("spdif_optical"),
  v.literal("spdif_coax"),
  v.literal("xlr4"),
  v.literal("mini_xlr"),
  v.literal("euroblock"),
  v.literal("trrs"),
  // Legacy, pre-split.
  v.literal("xlr"),
  v.literal("usb"),
  v.literal("other"),
);

/** Which half of a mating pair a plug or socket is. */
const connectorGender = v.union(
  v.literal("male"),
  v.literal("female"),
  v.literal("unspecified"),
);

/** Hardware toggles a port can expose. Only rendered when the profile declares it. */
const portCapability = v.union(
  v.literal("phantom"),
  v.literal("pad"),
  v.literal("polarity"),
  v.literal("monoSum"),
  v.literal("hpf"),
  v.literal("impedance"),
);

/** Patchbay row behaviour. Decides what audio does with nothing plugged in. */
const normallingMode = v.union(
  v.literal("full"),
  v.literal("half"),
  v.literal("none"),
);

/** Live toggle state for one port. Every field optional: absent = not applicable. */
const portState = v.object({
  phantom: v.optional(v.boolean()),
  pad: v.optional(v.boolean()),
  polarity: v.optional(v.boolean()),
  monoSum: v.optional(v.boolean()),
  hpf: v.optional(v.boolean()),
  impedance: v.optional(v.string()),
});

/** One port as declared on a reusable profile, before it is instantiated. */
const portTemplateEntry = v.object({
  label: v.string(),
  direction: portDirection,
  signalLevel: signalLevel,
  connector: connectorType,
  gender: v.optional(connectorGender),
  channelIndex: v.optional(v.number()),
  capabilities: v.array(portCapability),
  // Patchbays only: which physical row and column this jack sits on, so
  // normalling can be derived from geometry instead of hand-wiring it.
  bayRow: v.optional(v.union(v.literal("top"), v.literal("bottom"))),
  bayColumn: v.optional(v.number()),
});

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
    // IANA timezone for the studio's location - drives every server-composed
    // time string (device alerts, reminder emails, SMS). Auto-set from a
    // staff device on first load; adjustable in Settings > Workspace.
    timezone: v.optional(v.string()),
    // Pre-session brief policy: when true every checklist step must be
    // checked (accountability mode); unset/false = optional guidance.
    briefRequireAll: v.optional(v.boolean()),
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
      v.literal("flow"),                  // $0 + take rate - payments-monetized
      v.literal("studio"),                // $149.99 - the money loop
      v.literal("pro"),                   // $297.00 - the whole operation
      v.literal("label"),                 // $499.99 - unlocked + white label
      v.literal("enterprise"),
      v.literal("growth"),                // legacy, superseded by "label"
      v.literal("agency"),                // legacy
    )),
    // ── White-label theme. Writable only on a tier whose plan whitelabel
    //    level is "full" (Label). Unset = Pulse chrome. The Powered by Pulse
    //    lockup under the studio logo is never removable, at any tier. ──
    theme: v.optional(
      v.object({
        appName: v.optional(v.string()),
        // Core palette (hex). Unset keys fall back to the Pulse defaults.
        primary: v.optional(v.string()),
        accent: v.optional(v.string()),
        background: v.optional(v.string()),
        surface: v.optional(v.string()),
        text: v.optional(v.string()),
        muted: v.optional(v.string()),
        border: v.optional(v.string()),
        // Typography - a font family name resolved against an allowlist.
        fontHeading: v.optional(v.string()),
        fontBody: v.optional(v.string()),
        // Shape language.
        radius: v.optional(v.union(
          v.literal("sharp"),
          v.literal("soft"),
          v.literal("round"),
        )),
        density: v.optional(v.union(
          v.literal("compact"),
          v.literal("comfortable"),
        )),
        mode: v.optional(v.union(
          v.literal("dark"),
          v.literal("light"),
          v.literal("system"),
        )),
        // Sign-in screen.
        loginHeadline: v.optional(v.string()),
        loginSubhead: v.optional(v.string()),
        loginBackgroundId: v.optional(v.id("_storage")),
        // Transactional email skin.
        emailHeaderColor: v.optional(v.string()),
        emailFooterText: v.optional(v.string()),
        // Wordmark shown beside the logo in the app rail.
        wordmark: v.optional(v.string()),
        updatedAt: v.optional(v.number()),
        updatedBy: v.optional(v.string()),
      }),
    ),
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
    // Pay-period preference for the Payroll page (owner/manager choice).
    // Unset = monthly (calendar months). Biweekly = rolling 14-day windows
    // aligned to payrollAnchorDate (YYYY-MM-DD, the first day of a period,
    // interpreted in the viewer's timezone).
    payrollSchedule: v.optional(v.union(v.literal("monthly"), v.literal("biweekly"))),
    payrollAnchorDate: v.optional(v.string()),
    // What one point is worth, for teammates on the points pay basis.
    pointValueCents: v.optional(v.number()),
    // ── Find a Studio directory ──
    //    Opt-in, off by default. A listed studio appears on the public
    //    directory with its rooms, rates and next open day, linking straight
    //    to its own booking page. Pulse takes no commission on what it sends:
    //    the whole point is to be a lead source rather than another cost.
    directoryListed: v.optional(v.boolean()),
    // Booking page: list the room's gear to clients. Undefined means on - a
    // studio that has never touched the switch has always shown its gear.
    showGearOnBooking: v.optional(v.boolean()),
    /* What the public booking page offers first.

       "rooms" (default) is the original: cards for each bookable room, and the
       client picks a space. "services" is for a studio whose catalogue is what
       it DOES rather than where it does it - Slang City sells recording,
       podcast, green screen, interviews and photoshoots out of two rooms, so
       asking a client to pick "Live Room / Work Space" asks them to know
       something only the studio knows. */
    bookingCatalog: v.optional(v.union(v.literal("rooms"), v.literal("services"))),
    directoryBlurb: v.optional(v.string()),   // one line, the studio's own words
    directoryCity: v.optional(v.string()),
    directoryRegion: v.optional(v.string()),  // state / county / province
    directoryTags: v.optional(v.array(v.string())), // "vocal booth", "SSL", "live room"
    // ── Beta cohort ──
    //    Set when a workspace was created from a signed beta invite. It is a
    //    provenance flag, not a permission: a beta studio is a real studio
    //    with a real tier. It exists so the agency console can tell the early
    //    cohort apart and graduate them deliberately rather than losing track
    //    of who was let in on what terms.
    betaCohort: v.optional(v.boolean()),
    betaInviteCode: v.optional(v.string()),
    betaClaimedAt: v.optional(v.number()),
    // The free-licence commitment made to a beta tester, as a date. Recorded
    // separately from trialEndsAt so converting them onto a paid plan later
    // does not erase what they were promised.
    betaLicenseUntil: v.optional(v.number()),
    // When the year actually began. The clock starts on their FIRST SIGN-IN
    // AFTER SIGNING, not when the agency granted the licence - a studio that
    // takes three weeks to read the agreement should still get twelve months.
    // Undefined + betaCohort means "granted, not started": no countdown is
    // shown and the hard stop cannot fire.
    betaStartedAt: v.optional(v.number()),
    // Length of the granted licence in months. Held from the grant so the
    // clock, which starts later, knows how long to run for. Absent = 12.
    betaMonths: v.optional(v.number()),
    // When paid billing actually began. Early-adopter intro pricing is
    // measured from here, so the discount window tracks the first charge
    // rather than a date guessed from the trial.
    paidSince: v.optional(v.number()),
    betaWelcomeSentAt: v.optional(v.number()),
    // Which end-of-beta warnings have already gone out (30 / 7 / 1), so the
    // daily sweep never mails the same warning twice.
    betaWarningsSent: v.optional(v.array(v.number())),
    graduatedAt: v.optional(v.number()),
    // ── Pending deletion ──
    //    Set by step 2 of the deletion flow and cleared on cancel, timeout or
    //    completion. Holds nothing but the one-time token and its window, so
    //    a confirmation cannot be replayed or applied to a different studio.
    pendingDeletion: v.optional(
      v.object({
        token: v.string(),
        requestedAt: v.number(),
        expiresAt: v.number(),
        requestedBy: v.optional(v.string()),
      }),
    ),
    // Queue engineer payouts automatically when a session completes.
    // Off by default: a studio opts in, and nothing pays itself either way.
    autoPayouts: v.optional(v.boolean()),
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
    // No-Show Shield: the studio's cancellation policy. Cancelling inside
    // `cancellationWindowHours` of the start (or a no-show) forfeits the deposit
    // and/or assesses `cancellationFeePct` of the booking rate.
    cancellationWindowHours: v.optional(v.number()),
    cancellationFeePct: v.optional(v.number()), // 0-100
    // AI receptionist: opt-in auto-reply to inbound SMS booking inquiries.
    aiReceptionistEnabled: v.optional(v.boolean()),
    // Booking-page social proof: short client testimonials the studio curates.
    testimonials: v.optional(
      v.array(
        v.object({
          author: v.string(),
          role: v.optional(v.string()),
          quote: v.string(),
          rating: v.optional(v.number()),
        }),
      ),
    ),
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
    smsDigestLastSent: v.optional(v.string()),      // local YYYY-MM-DD the 8am owner digest last went out
    // ── Agency rebilling (sub-account pays its parent agency) ──
    // The agency assigns one of its agencyPlans; this is the per-account state.
    agencyPlanId: v.optional(v.id("agencyPlans")),
    billingStatus: v.optional(v.union(
      v.literal("trialing"),   // in a free/promo window, countdown running
      v.literal("active"),     // paying (card on file) or fully comped-then-converted
      v.literal("past_due"),   // trial lapsed without a card → app locks if plan requires one
      v.literal("comped"),     // free forever, agency-granted
      v.literal("canceled"),
    )),
    trialStartedAt: v.optional(v.number()),
    trialEndsAt: v.optional(v.number()),
    paymentMethodOnFile: v.optional(v.boolean()),
    priceCentsOverride: v.optional(v.number()),     // per-account custom price (overrides the plan)
    billingCustomerId: v.optional(v.string()),      // sub-account's Stripe customer (platform account)
    billingSubscriptionId: v.optional(v.string()),
    billingNote: v.optional(v.string()),            // comp reason / billing memo
  })
    .index("by_org", ["orgId"])
    .index("by_slug", ["slug"])
    .index("by_agency", ["agencyId"])
    .index("by_stripe_account", ["stripeAccountId"]),

  // ── Agency price book - the plans an agency sells to its sub-account studios.
  //    GoHighLevel "SaaS Mode": the agency sets the price/trial; orgs.agencyPlanId
  //    points one studio at one plan. A free promo plan = priceCents 0 + isPromo. ──
  agencyPlans: defineTable({
    agencyId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    priceCents: v.number(),                          // 0 allowed (free / promo)
    billingInterval: v.union(v.literal("month"), v.literal("year")),
    trialDays: v.number(),                           // 0 = no trial
    requireCardAfterTrial: v.boolean(),              // trial lapses → must add card or lock
    isPromo: v.boolean(),                            // "first adopter" plan
    promoEndsAt: v.optional(v.number()),             // offer closes to NEW assignments after this
    // Early-adopter intro pricing: introPriceCents for the first introMonths
    // billing periods, then priceCents. Both set or neither.
    introPriceCents: v.optional(v.number()),
    introMonths: v.optional(v.number()),
    featureCaps: v.optional(v.array(v.string())),    // feature keys disabled on assign
    isDefault: v.boolean(),                          // auto-assigned to new sub-accounts
    active: v.boolean(),
    stripePriceId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_agency", ["agencyId"])
    .index("by_agency_active", ["agencyId", "active"]),

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
      v.literal("flow"),
      v.literal("studio"),
      v.literal("pro"),
      v.literal("label"),
      v.literal("growth"),                // legacy, superseded by "label"
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
    // Agency-level settings
    supportEmail: v.optional(v.string()),   // shown to studios; billing/support contact
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
    // Profile fields - how this agency teammate appears across the console.
    title: v.optional(v.string()),         // role/job title, e.g. "Founder"
    phone: v.optional(v.string()),
    photoStorageId: v.optional(v.id("_storage")),
    clerkImageUrl: v.optional(v.string()), // cached Clerk avatar fallback
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
    // Rolling rate-limit window for the concierge LLM (caps paid AI calls per
    // portal token so one valid link can't drive unbounded cost).
    askWindowStart: v.optional(v.number()),
    askCount: v.optional(v.number()),
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

  // ── Pulse Agent - tenant-isolated AI ops layer. Spec "workspace" == orgId.
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

  // ── Studio Brain: a per-subaccount knowledge graph + history (Obsidian /
  //    Graphify style). Nodes are this studio's entities, edges the
  //    relationships between them, and the journal is an append-only timeline.
  //    Everything is derived from THIS org's data only and is by_org-indexed,
  //    so the Studio Manager reasons over one connected picture per subaccount
  //    and can never cross a tenant boundary. ──
  studioGraphNodes: defineTable({
    orgId: v.string(),
    kind: v.string(), // artist | song | session | room | gear | staff | invoice | deal
    refId: v.string(), // source document id, as a string
    label: v.string(),
    summary: v.optional(v.string()),
    attrs: v.optional(v.any()),
    degree: v.optional(v.number()), // connection count, for centrality
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_kind", ["orgId", "kind"])
    .index("by_org_ref", ["orgId", "refId"]),

  studioGraphEdges: defineTable({
    orgId: v.string(),
    fromRef: v.string(),
    toRef: v.string(),
    rel: v.string(), // booked | in_room | engineered_by | by | for_song | billed_to | rented_on | lead_for
    weight: v.number(),
    key: v.string(), // `${fromRef}|${rel}|${toRef}` - dedupe / upsert
    attrs: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_from", ["orgId", "fromRef"])
    .index("by_org_to", ["orgId", "toRef"])
    .index("by_org_key", ["orgId", "key"]),

  studioJournal: defineTable({
    orgId: v.string(),
    at: v.number(),
    kind: v.string(), // snapshot | milestone | risk | win | note
    title: v.string(),
    body: v.optional(v.string()),
    importance: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    entityRefs: v.optional(v.array(v.string())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_at", ["orgId", "at"]),

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

  // ── OAuth CSRF state nonces. The Google connect flow passes a random,
  //    single-use, short-lived nonce as the OAuth `state`, bound server-side to
  //    the initiating org, so the callback can't be forged to attach an
  //    attacker's Google account to a victim org. Consumed (deleted) on use. ──
  oauthStates: defineTable({
    nonce: v.string(),
    orgId: v.string(),
    expiresAt: v.number(),
  }).index("by_nonce", ["nonce"]),

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
    // Payroll: how this teammate is paid. "hourly" => payRateCents is cents/hour
    // (multiplied by clocked hours); "salary" => payRateCents is the ANNUAL
    // salary in cents (prorated per pay period). Absent = unpaid / not tracked.
    //    "commission" => commissionPct of the session rate.
    //    "points"     => pointsPerSession x the org's point value.
    payType: v.optional(v.union(
      v.literal("hourly"),
      v.literal("salary"),
      v.literal("commission"),
      v.literal("points"),
    )),
    payRateCents: v.optional(v.number()),
    // Engineer's share of a session's rate, 0-100. Used when payType is
    // "commission"; also the fallback split when an hourly engineer works a
    // session the studio pays out on rather than on the clock.
    commissionPct: v.optional(v.number()),
    // Points model: a fixed number of points per session, valued by the org's
    // pointValueCents. Studios that pay "a point a song" use this.
    pointsPerSession: v.optional(v.number()),
    // Booking-page engineer profile: a short bio + notable credits, shown to
    // clients choosing an engineer (proof-of-work that lifts conversion).
    bio: v.optional(v.string()),
    credits: v.optional(v.array(v.string())),
    // Listening links: the engineer's Spotify artist/profile page and any
    // playlists that showcase their work.
    spotifyUrl: v.optional(v.string()),
    playlistUrls: v.optional(v.array(v.string())),
  })
    .index("by_org", ["orgId"])
    .index("by_org_clerk", ["orgId", "clerkUserId"])
    // Cross-org lookup by Clerk user - resolveViewer's fallback for sessions
    // that carry no org claim (fresh sign-in before the org is activated).
    .index("by_clerk", ["clerkUserId"]),

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
    // Card on file (No-Show Shield): a Stripe customer + saved payment method on
    // the studio's connected account, so a no-show fee can be auto-charged.
    stripeCustomerId: v.optional(v.string()),
    defaultPaymentMethodId: v.optional(v.string()),
    // GDPR erasure: set when this client's personal data was erased (right to
    // be forgotten). Identifying fields are anonymized; financial/operational
    // records are retained under the accounting legitimate-interest basis.
    erasedAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["orgId"] }),

  // ── Visitors - the front-desk guest log. Each row is one visit (check-in,
  //    optional check-out). Contact details also upsert into `artists` as
  //    leads (source "visitor_qr"), so the Clients directory doubles as the
  //    outreach database; artistId links the visit back to that record. ──
  // Front-desk prep checklists - which steps are done per session. One row
  // holds every phase's steps (arrival: details/parking/room/welcome,
  // wrap-up: files/billing/gear/notes, refresh: reset/refresh/zero/stage).
  arrivalPrep: defineTable({
    orgId: v.string(),
    sessionId: v.id("sessions"),
    done: v.array(v.string()),
    // Who checked what, when - the accountability trail shown on the brief.
    attribution: v.optional(
      v.array(v.object({ step: v.string(), by: v.string(), at: v.number() })),
    ),
  }).index("by_org_session", ["orgId", "sessionId"]),

  // Web-push subscriptions for team devices (PWA/browser). One row per
  // device endpoint; pruned automatically when the push service says gone.
  pushSubscriptions: defineTable({
    orgId: v.string(),
    clerkUserId: v.string(),
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    userAgent: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_endpoint", ["endpoint"]),

  // Dedupe ledger for scheduled device alerts (T-10 arrival / wrap /
  // shift-change / studio-refresh) - one row per alert key, insert-if-absent.
  pushAlerts: defineTable({
    orgId: v.string(),
    key: v.string(),
    sentAt: v.number(),
  }).index("by_org_key", ["orgId", "key"]),

  visitors: defineTable({
    orgId: v.string(),
    name: v.string(),
    email: v.string(), // stored lowercased - the dedup key into artists
    phone: v.optional(v.string()),
    purpose: v.optional(v.string()), // reason for the visit
    hostName: v.optional(v.string()), // who they came to see
    artistId: v.optional(v.id("artists")),
    // E-check-in: when the visitor's email (or, failing that, an unambiguous
    // name match) lines up with a session booked around now, the visit links
    // to it and the session advances automatically (tentative -> confirmed,
    // confirmed -> in_progress) so the kiosk reflects the arrival live.
    sessionId: v.optional(v.id("sessions")),
    sessionMatchedBy: v.optional(v.string()), // "email" | "name"
    // Visitor terms of service - the QR self check-in requires acceptance;
    // the stamp is the audit record.
    termsAcceptedAt: v.optional(v.number()),
    checkInAt: v.number(),
    checkOutAt: v.optional(v.number()),
    source: v.string(), // "qr" | "front_desk"
  })
    .index("by_org", ["orgId"])
    .index("by_org_checkin", ["orgId", "checkInAt"])
    .index("by_org_email", ["orgId", "email"]),

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
    // Real cover art (uploaded, or pulled from a Spotify / Apple Music link
    // by the song importer). coverColor stays as the tonal fallback.
    coverArtId: v.optional(v.id("_storage")),
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
  // ── Bookable services - what the studio SELLS, over the rooms it sells it
  //    in. A service is a product (Podcast, $150/hr, 2 hour minimum); a room
  //    is the resource that product consumes. Several services can share one
  //    room, and that is the point: booking the podcast at 3pm has to take the
  //    green screen off the market at 3pm when they are the same four walls. ──
  bookableServices: defineTable({
    orgId: v.string(),
    name: v.string(),
    blurb: v.optional(v.string()),

    /* Hourly or flat. A photoshoot is "$150 for a two hour session", not "$75
       an hour" - quoting it hourly invites a one hour booking the studio does
       not sell. Flat services book `blockHours` and charge `priceCents` once. */
    pricingMode: v.union(v.literal("hourly"), v.literal("flat")),
    priceCents: v.number(),
    minimumHours: v.optional(v.number()),   // hourly only
    blockHours: v.optional(v.number()),     // flat only - the length of the block
    depositPct: v.optional(v.number()),     // falls back to the room's

    /** The room this consumes. The service is what the client picks; this is
     *  what the calendar books, so two services in one room cannot collide. */
    roomId: v.id("rooms"),

    /* What the session is filed as. One of the seven service types when it
       maps cleanly (recording), otherwise the booking lands as a custom
       category carrying this service's name - so a podcast reads "Podcast" on
       the calendar rather than being squeezed into "consultation". */
    sessionServiceType: v.optional(serviceType),

    /** Add-ons offered with THIS service. Podcast edits belong on a podcast
     *  booking and nowhere else; one shared list is how a client recording
     *  vocals gets offered a green screen film crew. */
    addOnFeeIds: v.optional(v.array(v.id("feeTemplates"))),

    heroImageUrl: v.optional(v.string()),
    heroImageId: v.optional(v.id("_storage")),
    order: v.number(),                      // display order on the booking page
    active: v.boolean(),                    // off = not sold, row kept
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_room", ["orgId", "roomId"]),

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
    /* How the room is paid for. "deposit" (the default) holds the slot with a
       percentage and leaves a balance; "full" takes the whole amount up front.
       A studio that has been burned by no-shows, or one whose sessions are
       short enough that chasing a balance costs more than the balance, sells
       paid-in-full - and then the checkout page must not offer a deposit it
       does not accept. */
    paymentMode: v.optional(v.union(v.literal("deposit"), v.literal("full"))),
    /* Whether the booking page lets a client choose their engineer. On by
       default, because it always was. A studio that assigns the room's
       engineer itself - or is the engineer - does not want a client picking a
       name off a list and then being told no. */
    offerEngineer: v.optional(v.boolean()),
    /* Show this room's gear list on the booking page. The studio-wide switch
       (orgs.showGearOnBooking) still wins when IT is off: a studio that
       publishes no gear anywhere means it, room by room. */
    showGear: v.optional(v.boolean()),
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
    /* Keep this piece off the public booking page while leaving it installed
       and inventoried. The room's list is a sales page, not an asset
       register: a studio lists the desk and the U47, not forty cables and the
       spare kettle. */
    hideOnBooking: v.optional(v.boolean()),
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
    // Rental add-on: the studio can offer this item as an a-la-carte add-on on
    // the public booking page for a per-session price. Availability is checked
    // against overlapping sessions so a single unit cannot be double-booked.
    rentable: v.optional(v.boolean()),
    rentalPriceCents: v.optional(v.number()),
    // ── Cable stock (Patch Manager) ──
    // Only meaningful on category "cable". Turns an undifferentiated line
    // item ("XLR Cable, qty 6") into real stock the patch canvas can spend:
    // a connection claims one run from this row, and the remaining count is
    // what the cable manager reports as free. Absent on every other category.
    cableSpec: v.optional(
      v.object({
        connectorA: connectorType,
        connectorB: connectorType,
        // A cable is plugs, so each end has a gender. An XLR mic cable is
        // female at the mic and male at the preamp.
        genderA: v.optional(connectorGender),
        genderB: v.optional(connectorGender),
        // Runs carried by one physical cable. 1 for an XLR, 8 for a DB25 fan.
        channels: v.number(),
        lengthFt: v.optional(v.number()),
        // Jacket colour, used for the edge tint on the canvas.
        color: v.optional(v.string()),
        signalLevel: v.optional(signalLevel),
        // Prefix for physical labels on this batch, e.g. "A" -> A-001.
        labelPrefix: v.optional(v.string()),
      }),
    ),
  })
    .index("by_org", ["orgId"])
    .index("by_org_room", ["orgId", "installedInRoomId"])
    .index("by_org_category", ["orgId", "category"]),

  // ── Asset documents - receipts / invoices / warranties attached to a
  //    hardware (equipment) or software item. Kept for tax, insurance and
  //    historical records. The file lives in Convex storage; this row is the
  //    metadata + the link to its parent asset. ──
  assetDocuments: defineTable({
    orgId: v.string(),
    kind: v.union(v.literal("equipment"), v.literal("software")),
    refId: v.string(), // equipment._id or softwareLicenses._id (as a string)
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(), // mime type
    sizeBytes: v.optional(v.number()),
    docType: v.optional(
      v.union(
        v.literal("invoice"),
        v.literal("receipt"),
        v.literal("warranty"),
        v.literal("other"),
      ),
    ),
    note: v.optional(v.string()),
    uploadedAt: v.number(),
    uploadedBy: v.optional(v.string()),
  })
    .index("by_ref", ["kind", "refId"])
    .index("by_org", ["orgId"]),

  // ── Sessions (bookings) ──
  sessions: defineTable({
    orgId: v.string(),
    title: v.string(),
    artistId: v.id("artists"),
    songId: v.optional(v.id("songs")),
    serviceType,
    // What the studio calls this one, when serviceType is "custom".
    customService: v.optional(v.string()),
    roomId: v.optional(v.id("rooms")),
    engineerId: v.optional(v.id("members")),
    // Public-booking engineer request lifecycle: pending until the engineer
    // confirms (or a manager overrides); declined clears the assignment.
    engineerRequestStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("confirmed"),
        v.literal("declined"),
        v.literal("overridden"),
      ),
    ),
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
    smsRemindersSent: v.optional(v.array(v.string())),
    // Which email reminders have gone out ("24h" / "2h") - sweep dedupe.
    emailRemindersSent: v.optional(v.array(v.string())), // which SMS reminders fired: "24h" | "2h"
    // Two-way Google Calendar sync: when the studio is connected, this is the
    // Google event id we created for this session so we can patch / delete it.
    googleCalendarEventId: v.optional(v.string()),
    // Premium gear add-ons rented a-la-carte for this session from the public
    // booking page. Each references an equipment item + the price charged; the
    // sum is folded into rateCents. Used to conflict-check single-unit gear so
    // one mic cannot be booked into two overlapping sessions.
    addOns: v.optional(
      v.array(
        v.object({
          equipmentId: v.id("equipment"),
          name: v.string(),
          priceCents: v.number(),
        }),
      ),
    ),
    /* Service add-ons chosen at booking - a podcast edit, a photographer, a
       film crew. Priced from feeTemplates on the server and copied here as
       names and amounts, so an invoice still reads correctly after the studio
       reprices or retires the template. */
    serviceAddOns: v.optional(
      v.array(
        v.object({
          feeId: v.id("feeTemplates"),
          label: v.string(),
          amountCents: v.number(),
        }),
      ),
    ),
    // Free-text request when a client wants gear that was unavailable or not
    // listed; the studio team is notified to follow up.
    gearRequestNote: v.optional(v.string()),
    // Stamped by the automation's stale-resolution pass so reports can tell
    // auto-archived rows ("expired_hold" | "auto_completed" | "auto_no_show")
    // from staff-set statuses.
    autoResolved: v.optional(v.string()),
    // Comped / discounted session cost tracking. `compType` marks the session;
    // `listValueCents` is what it would normally bill (so foregone revenue =
    // listValue - rateCents); `compReason` is why. Absent = a normal booking.
    compType: v.optional(v.union(v.literal("comped"), v.literal("discounted"))),
    listValueCents: v.optional(v.number()),
    compReason: v.optional(v.string()),
    // No-Show Shield outcomes on a cancelled / no-show session.
    cancellationFeeCents: v.optional(v.number()),
    depositForfeited: v.optional(v.boolean()),
    // SMS confirm flow: client replied NO to the pre-session confirm text.
    // Their deposit is held for rebooking until rebookHoldUntil (10 days);
    // after that staff/automation may forfeit it.
    clientDeclinedAt: v.optional(v.number()),
    rebookHoldUntil: v.optional(v.number()),
    // Set once the freed slot has been offered to the waitlist by SMS.
    waitlistBlastAt: v.optional(v.number()),
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
        // How the signature was captured: "typed" = legal name rendered in the
        // chosen script font (signatureFont), "drawn" = finger/stylus PNG data
        // URI stored in `signature`. Unset = legacy typed-name rows.
        signatureKind: v.optional(v.union(v.literal("typed"), v.literal("drawn"))),
        signatureFont: v.optional(v.string()),
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
    // How the invoice was settled. Manual recording requires one of the
    // manual methods; the online Stripe path stamps "card". "credit" means
    // studio credit was applied - not cash in - and auto-posts a P&L
    // adjustment expense. Unset = paid before this field existed.
    paymentMethod: v.optional(
      v.union(
        v.literal("venmo"),
        v.literal("cash"),
        v.literal("cashapp"),
        v.literal("zelle"),
        v.literal("credit"),
        v.literal("card"),
      ),
    ),
    overdueNotifiedAt: v.optional(v.number()),
    reminderStage: v.optional(v.number()), // dunning ladder step already sent (0/1/2/3)
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

  // ── Prepaid hour-block packages. The studio sells a block ("10 hours, 15%
  //    off"); a purchase creates a credit the client draws down on future
  //    bookings. Upfront cash + commitment. ──
  packageProducts: defineTable({
    orgId: v.string(),
    name: v.string(),
    hours: v.number(),
    priceCents: v.number(),
    description: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_org", ["orgId"]),

  packageCredits: defineTable({
    orgId: v.string(),
    artistId: v.id("artists"),
    productId: v.optional(v.id("packageProducts")),
    name: v.string(),
    hoursTotal: v.number(),
    hoursRemaining: v.number(),
    priceCents: v.number(),
    status: v.union(v.literal("active"), v.literal("depleted"), v.literal("expired")),
    purchasedAt: v.number(),
    stripeReference: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_artist", ["orgId", "artistId"]),

  // ── Reviews / testimonials collected after sessions. A post-session request
  //    links a token; the client rates + writes a note. Owner can hide any.
  //    Published reviews feed social proof on the booking page. ──
  reviews: defineTable({
    orgId: v.string(),
    artistId: v.optional(v.id("artists")),
    sessionId: v.optional(v.id("sessions")),
    rating: v.number(), // 1-5
    text: v.optional(v.string()),
    authorName: v.optional(v.string()),
    status: v.union(v.literal("published"), v.literal("hidden")),
    source: v.optional(v.string()), // "post_session", "manual", ...
    at: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_session", ["sessionId"]),

  // ── Recovery ledger - dollars Pulse actively saved/recovered for the studio
  //    (forfeited deposits, cancellation/no-show fees, waitlist backfills,
  //    reminder-driven collections). Powers the "Recovered by Pulse" ROI ticker
  //    that proves the subscription pays for itself. ──
  recoveryEvents: defineTable({
    orgId: v.string(),
    kind: v.union(
      v.literal("deposit_forfeited"),
      v.literal("cancellation_fee"),
      v.literal("no_show_fee"),
      v.literal("waitlist_fill"),
      v.literal("reminder_collected"),
    ),
    amountCents: v.number(),
    at: v.number(),
    sessionId: v.optional(v.id("sessions")),
    invoiceId: v.optional(v.id("invoices")),
    note: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_at", ["orgId", "at"]),

  // ── Expenses - money OUT. The other half of the books: rent, utilities,
  //    subscriptions, gear, repairs, contractor/engineer payouts, marketing,
  //    etc. Powers the P&L (revenue from payments minus expenses) and feeds a
  //    real margin into the profitability + manager surfaces. Tenant-scoped. ──
  expenses: defineTable({
    orgId: v.string(),
    category: v.union(
      v.literal("rent"),
      v.literal("utilities"),
      v.literal("software"),
      v.literal("gear"),
      v.literal("repairs"),
      v.literal("payroll"),
      v.literal("contractor"),
      v.literal("marketing"),
      v.literal("supplies"),
      v.literal("insurance"),
      v.literal("travel"),
      v.literal("fees"),
      // P&L adjustments - non-cash offsets like studio credit applied to an
      // invoice (auto-posted when an invoice is recorded paid by credit).
      v.literal("adjustment"),
      v.literal("other"),
    ),
    vendor: v.optional(v.string()),
    description: v.optional(v.string()),
    amountCents: v.number(),
    date: v.number(), // when the cost was incurred / paid (day-resolution)
    // "monthly"/"annual" mark a recurring fixed cost so reporting can annualize.
    recurring: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
    // If this is a payout to a staff member / contractor, link them.
    memberId: v.optional(v.id("members")),
    receiptId: v.optional(v.id("_storage")),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_date", ["orgId", "date"])
    .index("by_org_member", ["orgId", "memberId"]),

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
      // Operations Agent: profitability levers + category risk flags
      // (note_only, internal recommendations surfaced in the inbox).
      v.literal("profit_improvement"),
      v.literal("studio_risk"),
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

  // ── Beta access - early-release recipients for the feature preview.
  //
  //    Each recipient gets their own code (or a link carrying it), so the
  //    agency can see who opened what and who has signed. The gate is a real
  //    server check: the code is verified on the server and the full content
  //    is only ever returned to a signed session, never shipped to the
  //    browser and hidden with CSS. ──
  betaInvites: defineTable({
    agencyId: v.optional(v.string()),
    orgId: v.optional(v.string()),
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    // The access code. Unique, unguessable, one per recipient so opens and
    // signatures attribute to a person rather than to "somebody".
    code: v.string(),
    status: v.union(
      v.literal("created"),
      v.literal("sent"),
      v.literal("viewed"),
      v.literal("signed"),
      v.literal("claimed"),   // signed AND created their studio
      v.literal("revoked"),
      v.literal("expired"),
    ),
    // ── NDA signature ──
    ndaVersion: v.string(),
    signedName: v.optional(v.string()),
    signedTitle: v.optional(v.string()),
    signedCompany: v.optional(v.string()),
    signedAt: v.optional(v.number()),
    // A hash of the exact agreement text the person actually saw, so a later
    // edit to the terms cannot be passed off as what they signed.
    signedTermsHash: v.optional(v.string()),
    signedUserAgent: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    emailStatus: v.optional(v.string()),
    // Opened the page at all (code typed OR link followed).
    firstViewedAt: v.optional(v.number()),
    lastViewedAt: v.optional(v.number()),
    viewCount: v.number(),
    // Followed the magic link specifically, as opposed to typing the code.
    // Tracked separately because "the email worked" and "they found their way
    // in" are different things to know when a send goes quiet.
    clickedAt: v.optional(v.number()),
    clickCount: v.optional(v.number()),
    // The email was rendered in a mail client. Best-effort only: image
    // blocking means a missing open proves nothing, so the UI says so rather
    // than presenting silence as a rejection.
    emailOpenedAt: v.optional(v.number()),
    emailOpenCount: v.optional(v.number()),
    // Signed in to the studio they built. The real engagement signal - the
    // one that separates "curious" from "using it".
    lastLoginAt: v.optional(v.number()),
    firstLoginAt: v.optional(v.number()),
    loginCount: v.optional(v.number()),
    // The studio they created off the back of this invite. The whole funnel
    // exists to produce this field.
    claimedOrgId: v.optional(v.string()),
    claimedSlug: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    note: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_agency", ["agencyId"])
    .index("by_agency_status", ["agencyId", "status"])
    .index("by_email", ["email"])
    .index("by_claimed_org", ["claimedOrgId"]),

  // ── Agent rules - a deterministic standing rule, usually promoted from an
  //    insight the owner got tired of approving.
  //
  //    Distinct from agentAutomations on purpose: an automation is a PROMPT
  //    the agent runs on a schedule and reasons about; a rule is an if-this-
  //    then-that with no model in the loop. Once the owner has approved the
  //    same suggestion three times, they do not want it reasoned about again,
  //    they want it to just happen. ──
  agentRules: defineTable({
    orgId: v.string(),
    name: v.string(),
    trigger: v.union(
      v.literal("session.completed"),
      v.literal("session.no_show"),
      v.literal("session.upcoming"),
      v.literal("invoice.overdue"),
      v.literal("client.dormant"),
      v.literal("booking.created"),
    ),
    // Threshold the trigger reads, where it needs one: hours before a session,
    // days an invoice is overdue, days since a client was last seen.
    thresholdDays: v.optional(v.number()),
    thresholdHours: v.optional(v.number()),
    action: v.union(
      v.literal("notify_team"),
      v.literal("email_client"),
      v.literal("sms_client"),
      v.literal("flag_insight"),
    ),
    // Message body. Supports {client} and {studio}; substitution is done
    // server-side against real records, never by concatenating user input.
    template: v.string(),
    enabled: v.boolean(),
    // Provenance: which insight or approval this was promoted from, so the
    // owner can see why the rule exists months later.
    fromInsightId: v.optional(v.id("agentInsights")),
    fromApprovalId: v.optional(v.id("agentApprovals")),
    sourceNote: v.optional(v.string()),
    runCount: v.number(),
    lastRunAt: v.optional(v.number()),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_trigger", ["orgId", "trigger"])
    .index("by_org_enabled", ["orgId", "enabled"]),

  // ── Engineer payouts - what the studio owes a person for a session.
  //    Queued automatically when a session completes, from whichever basis
  //    that teammate is on (commission, points, or clocked hours). Never
  //    pays itself: a payout sits in "queued" until a human approves it. ──
  payouts: defineTable({
    orgId: v.string(),
    memberId: v.id("members"),
    sessionId: v.optional(v.id("sessions")),
    basis: v.union(
      v.literal("commission"),   // pct of the session rate
      v.literal("points"),       // points x point value
      v.literal("hourly"),       // clocked hours x rate
      v.literal("manual"),       // entered by a manager
    ),
    amountCents: v.number(),
    // How the number was reached, in words, so an engineer disputing a payout
    // can be shown the arithmetic rather than asked to trust it.
    explanation: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("approved"),
      v.literal("paid"),
      v.literal("void"),
    ),
    // Snapshots taken at queue time. A later raise must not rewrite what was
    // already earned.
    sessionRateCents: v.optional(v.number()),
    commissionPctSnapshot: v.optional(v.number()),
    pointsSnapshot: v.optional(v.number()),
    pointValueCentsSnapshot: v.optional(v.number()),
    hoursSnapshot: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.string()),
    expenseId: v.optional(v.id("expenses")),  // set when posted to the P&L
  })
    .index("by_org", ["orgId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_member", ["orgId", "memberId"])
    .index("by_session", ["sessionId"]),

  // ── Booking funnel - anonymous page-visit events on the public booking
  //    surface. No PII, no IP, no cookie: the client mints a random
  //    visitorKey per browser session and sends it with each step, which is
  //    enough to count people through the funnel and nothing more.
  //    A "booked" row is written server-side by createBooking when the
  //    visitor carried a key, so view -> booked -> paid joins in one table. ──
  bookingVisits: defineTable({
    orgId: v.string(),
    visitorKey: v.string(),          // random per browser session, client-minted
    step: v.union(
      v.literal("page"),             // landed on /book/<slug>
      v.literal("room"),             // opened a room
      v.literal("checkout"),         // reached the deposit step
      v.literal("booked"),           // server-written on a real booking
    ),
    day: v.string(),                 // "YYYY-MM-DD", for cheap range aggregation
    roomId: v.optional(v.id("rooms")),
    sessionId: v.optional(v.id("sessions")),  // set on "booked"
    amountCents: v.optional(v.number()),      // booking value, set on "booked"
    ref: v.optional(v.string()),     // ?ref= referral attribution
    code: v.optional(v.string()),    // ?code= promo attribution
    utmSource: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_org_day", ["orgId", "day"])
    .index("by_org_visitor", ["orgId", "visitorKey"])
    .index("by_org_step", ["orgId", "step"]),

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
    // 24h-before staff reminder sent marker (email sweep dedupe).
    reminderSentAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_member", ["orgId", "memberId"])
    .index("by_org_start", ["orgId", "startTime"])
    .index("by_session", ["sessionId"]),

  // ── Time clock - the actual hours a teammate worked. One row per clock-in;
  //    open while clockOutAt is undefined. Drives payroll (hours x rate) and
  //    the mobile clock-in/out widget. rateCentsSnapshot freezes the hourly
  //    rate at clock-in so a later raise doesn't rewrite past pay. ──
  timeEntries: defineTable({
    orgId: v.string(),
    memberId: v.id("members"),
    shiftId: v.optional(v.id("shifts")), // the scheduled shift this covers, if any
    clockInAt: v.number(),
    clockOutAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("completed")),
    rateCentsSnapshot: v.optional(v.number()), // cents/hour at clock-in
    source: v.union(v.literal("self"), v.literal("manual")), // self-service vs admin entry
    snoozedUntil: v.optional(v.number()), // end-of-shift "still working" snooze
    note: v.optional(v.string()),
    editedBy: v.optional(v.string()),
    // SMS timeclock checks. Overtime: at 8h the member is texted; YES marks
    // the OT approved, NO caps the entry at 8h, silence flags it for payroll
    // review. Interns: at 4h they must request permission via EXTEND, which a
    // manager APPROVEs or DENYs by text; timeout caps the entry at 4h.
    otPromptSentAt: v.optional(v.number()),
    otStatus: v.optional(
      v.union(v.literal("confirmed"), v.literal("declined"), v.literal("unconfirmed")),
    ),
    internPromptSentAt: v.optional(v.number()),
    internExtension: v.optional(
      v.union(
        v.literal("requested"),
        v.literal("approved"),
        v.literal("denied"),
        v.literal("timeout"),
      ),
    ),
    autoClosedReason: v.optional(v.string()), // e.g. "ot_declined" | "intern_timeout"
  })
    .index("by_org", ["orgId"])
    .index("by_org_member", ["orgId", "memberId"])
    .index("by_member_status", ["memberId", "status"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_in", ["orgId", "clockInAt"]),

  // ── Open SMS questions awaiting a reply. One row per outbound question; the
  //    inbound router matches a reply to the newest open prompt for that phone
  //    and applies the effect (confirm a session, approve overtime, ...). ──
  smsPrompts: defineTable({
    orgId: v.string(),
    phone: v.string(), // normalized E.164 of the person we asked
    kind: v.union(
      v.literal("booking_confirm"), // client: YES confirms / NO declines the session
      v.literal("rebook_offer"),    // client: REBOOK holds the deposit for rebooking
      v.literal("staff_confirm"),   // staff: YES confirms they'll work the session
      v.literal("overtime_confirm"),// staff: YES approves OT / NO caps at 8h
      v.literal("intern_checkin"),  // intern: EXTEND requests permission past 4h
      v.literal("intern_approval"), // manager: APPROVE/DENY the intern extension
      v.literal("waitlist_claim"),  // waitlisted client: CLAIM takes a freed slot
      v.literal("cover_offer"),     // engineer: YES takes an uncovered session
      v.literal("review_rating"),   // client: 1-5 rating after a completed session
    ),
    sessionId: v.optional(v.id("sessions")),
    entryId: v.optional(v.id("timeEntries")),
    memberId: v.optional(v.id("members")), // the member the prompt is ABOUT
    artistId: v.optional(v.id("artists")), // the client the prompt is ABOUT
    status: v.union(v.literal("open"), v.literal("answered"), v.literal("expired")),
    answer: v.optional(v.string()),
    sentAt: v.number(),
    expiresAt: v.number(),
    answeredAt: v.optional(v.number()),
  })
    .index("by_phone_status", ["phone", "status"])
    .index("by_entry", ["entryId"])
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

  /* ============================================================
     PATCH MANAGER
     Node-based documentation of what is physically plugged into
     what, at channel level. The graph is the map; `equipment` is
     still the asset register. A device on the canvas points back
     at the inventory row it represents, so the two never diverge.
     Nothing here controls hardware. It records.
     ============================================================ */

  // ── Patch space - a room or rig that gets patched. A studio can have
  //    several. Binds to a real room when one exists, so the canvas and
  //    the room's installed gear describe the same physical place. ──
  patchSpaces: defineTable({
    orgId: v.string(),
    name: v.string(),
    roomId: v.optional(v.id("rooms")), // unset -> a rig with no fixed room
    description: v.optional(v.string()),
    // Bumped on every graph mutation. Photo staleness in a later phase
    // compares against this instead of walking the audit log.
    revision: v.number(),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_room", ["orgId", "roomId"]),

  // ── Device profile - a reusable definition of a piece of gear and the
  //    ports it exposes. Global profiles are curated and shared by every
  //    studio; studio profiles are the escape hatch for gear the seed set
  //    will never cover. `catalogId` links a profile to its gearCatalog
  //    entry so the profile and the Add-equipment prefill agree. ──
  deviceProfiles: defineTable({
    // Unset on global profiles. Set on studio-authored ones.
    orgId: v.optional(v.string()),
    scope: v.union(v.literal("global"), v.literal("studio")),
    name: v.string(),
    manufacturer: v.string(),
    // Mirrors equipment.category so a profile and an inventory row can be
    // matched up. Stored loose rather than as the literal union because
    // the curated set only ever covers the gear categories.
    category: v.string(),
    rackUnits: v.optional(v.number()),
    catalogId: v.optional(v.string()), // gearCatalog slug, e.g. "neumann-u87-ai"
    portTemplate: v.array(portTemplateEntry),
    // Ribbon mics and similar. Drives the phantom power warning.
    phantomSensitive: v.optional(v.boolean()),
    // Patchbays only: how the rows behave out of the box.
    defaultNormalling: v.optional(normallingMode),
    sourceUrl: v.optional(v.string()), // provenance for future scraped entries
    /*
     * Where this profile's I/O came from, and whether a human has agreed
     * with it. A patch map is only worth trusting if you can tell a
     * hand-verified port list from a guess, so the provenance travels with
     * the ports rather than being inferred later.
     *   curated  - hand-written map in portTemplates.ts, trusted on sight
     *   ai       - looked up once and cached, needs a human nod
     *   category - a generic fallback by gear category, openly a guess
     *   manual   - someone edited the ports themselves, which settles it
     */
    specSource: v.optional(
      v.union(
        v.literal("curated"),
        v.literal("ai"),
        v.literal("category"),
        v.literal("manual"),
      ),
    ),
    /** Set once a human confirms the ports. Absent means unverified. */
    specVerifiedAt: v.optional(v.number()),
    specVerifiedBy: v.optional(v.string()),
    /** One line of what the lookup believed, shown when asking for the nod. */
    specNote: v.optional(v.string()),
    /** Which model answered, so a bad batch can be traced and re-run. */
    specModel: v.optional(v.string()),
    /** Set while a lookup is in flight, so two placements do not both ask. */
    specLookupAt: v.optional(v.number()),
    createdBy: v.optional(v.string()),
  })
    .index("by_scope", ["scope"])
    .index("by_org", ["orgId"])
    .index("by_catalog", ["catalogId"])
    .searchIndex("search_name", { searchField: "name" }),

  // ── Device instance - one unit placed on one canvas. `equipmentId` is the
  //    binding to real inventory: place a device and you are placing a gear
  //    asset the studio actually owns. `unitIndex` addresses one unit of a
  //    multi-quantity inventory row, which the equipment table cannot do on
  //    its own. Instances without an equipmentId are allowed so an engineer
  //    can sketch a rig before the gear is entered in inventory. ──
  deviceInstances: defineTable({
    orgId: v.string(),
    patchSpaceId: v.id("patchSpaces"),
    profileId: v.id("deviceProfiles"),
    equipmentId: v.optional(v.id("equipment")),
    unitIndex: v.optional(v.number()), // 0-based unit of a quantity > 1 row
    label: v.string(), // "Rack 2 - Neve 1073 #3"
    notes: v.optional(v.string()),
    position: v.object({ x: v.number(), y: v.number() }),
    /*
     * Card colour on the canvas. A key from DEVICE_COLORS, or a raw hex
     * someone typed. Unset means the default card, and most gear should
     * stay that way: colour only says anything while it is scarce. What it
     * is for is the thing the room already colour-codes in real life -
     * the monitor path, the two tracking rigs, the box that is on loan.
     */
    color: v.optional(v.string()),
    normalling: v.optional(normallingMode), // patchbays override the profile default
    /*
     * Two photos, because they answer two different questions.
     *
     * `photoId` is the device's face: what you look for when you are trying
     * to find this box among forty others. It is what the canvas card shows.
     *
     * `panelPhotoId` is its back: where the jacks actually are, which is what
     * you want open beside you while patching. Keeping them apart means the
     * card never shows a picture of cable spaghetti, and the patching
     * reference never gets overwritten by a nicer front shot.
     *
     * Both fall back to the inventory catalog photo when unset.
     */
    photoId: v.optional(v.id("_storage")),
    panelPhotoId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  })
    .index("by_patchSpace", ["patchSpaceId"])
    .index("by_org", ["orgId"])
    .index("by_equipment", ["equipmentId"]),

  // ── Annotation - a sticky note on the canvas. Not a device, not a cable:
  //    the thing an engineer writes on tape and leaves on the desk. Kept in
  //    its own table so it can never be mistaken for gear by the run list,
  //    the inventory counts or the connector checks. ──
  // ── Vocabulary gap - a connector or signal level a spec sheet used that
  //    the mating engine has never heard of. Recorded rather than dropped,
  //    because a word we cannot place is the only evidence that the
  //    vocabulary needs to grow. Nothing reads these at patch time; they are
  //    a review queue for promoting a term into CONNECTOR_DEFS. ──
  patchVocabGaps: defineTable({
    orgId: v.string(),
    kind: v.union(
      v.literal("connector"),
      v.literal("signalLevel"),
      v.literal("direction"),
    ),
    /** Lowercased, so "XLR Female" and "xlr female" are one row. */
    term: v.string(),
    /** Exactly as it was written the first time, for review. */
    rawTerm: v.string(),
    /** How many times this has turned up. */
    seen: v.number(),
    /** A device and port it appeared on, to make the term make sense. */
    exampleDevice: v.optional(v.string()),
    examplePort: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    /** Set once the term has been added to the vocabulary or dismissed. */
    resolvedAt: v.optional(v.number()),
    resolvedAs: v.optional(v.string()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_term", ["orgId", "kind", "term"]),

  patchAnnotations: defineTable({
    orgId: v.string(),
    patchSpaceId: v.id("patchSpaces"),
    text: v.string(),
    /** Sticky colour key, resolved to a hex by the canvas. */
    color: v.string(),
    position: v.object({ x: v.number(), y: v.number() }),
    size: v.optional(v.object({ width: v.number(), height: v.number() })),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
  })
    .index("by_patchSpace", ["patchSpaceId"])
    .index("by_org", ["orgId"]),

  // ── Group - a coloured section of canvas that sits UNDER the devices,
  //    the way a strip of tape across the desk marks off "monitor path"
  //    from "tracking path". Membership is geometric, not a field on the
  //    device: whatever sits inside the rectangle belongs to it. Drag a
  //    preamp in and it is in; drag it out and it is out. A stored member
  //    list would be a second source of truth about where gear is, and it
  //    would be wrong within a day of anyone rearranging the rig.
  //
  //    Carries no ports, spends no inventory, never reaches a run list.
  patchGroups: defineTable({
    orgId: v.string(),
    patchSpaceId: v.id("patchSpaces"),
    name: v.string(),
    /*
     * What kind of place this is: a console position, a vocal booth, a
     * machine room, the wall panel by the door. Stored loose rather than as
     * a literal union because studios name their own spaces and the list
     * will grow; the canvas resolves an unknown kind to a plain zone.
     *
     * This is what makes a section worth having over a coloured rectangle.
     * A run leaving a zone is a run leaving a ROOM, and that is the thing
     * that needs a tie line, a wall panel and a long cable rather than a
     * patch cord off the desk.
     */
    kind: v.string(),
    /*
     * The inventory room this zone stands for, when it stands for one.
     *
     * A studio big enough to need room-to-room patching already has its
     * rooms in the asset register, and two names for one room is how a
     * patch map and an asset register start disagreeing. Zones that are not
     * rooms - a console position, a rack, a wall panel - leave this unset.
     */
    roomId: v.optional(v.id("rooms")),
    /** Sticky colour key, resolved to a fill by the canvas. */
    color: v.string(),
    position: v.object({ x: v.number(), y: v.number() }),
    size: v.object({ width: v.number(), height: v.number() }),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
  })
    .index("by_patchSpace", ["patchSpaceId"])
    .index("by_org", ["orgId"]),

  // ── Port - one input or output on one device instance. Channel level
  //    throughout: a DB25 snake is eight rows here, never one. Ports are
  //    materialised from the profile's portTemplate at placement time so a
  //    later profile edit cannot silently rewrite a documented patch. ──
  ports: defineTable({
    orgId: v.string(),
    patchSpaceId: v.id("patchSpaces"),
    deviceInstanceId: v.id("deviceInstances"),
    label: v.string(),
    direction: portDirection,
    signalLevel: signalLevel,
    connector: connectorType,
    // Which half of the pair this jack is. Absent means unknown, which
    // the mating checks treat as "do not block".
    gender: v.optional(connectorGender),
    channelIndex: v.optional(v.number()),
    capabilities: v.array(portCapability),
    state: portState,
    // Patchbays: physical geometry, so normalling is derived not hand-wired.
    bayRow: v.optional(v.union(v.literal("top"), v.literal("bottom"))),
    bayColumn: v.optional(v.number()),
  })
    .index("by_device", ["deviceInstanceId"])
    .index("by_patchSpace", ["patchSpaceId"])
    .index("by_org", ["orgId"]),

  // ── Connection - a directed edge, output port to input port. Cable
  //    metadata points at a real `equipment` row of category "cable" so a
  //    patch spends stock the studio owns; `cableTag` records which
  //    physical labelled cable of that batch was used. Normalled edges are
  //    implied by patchbay geometry and carry no cable. ──
  connections: defineTable({
    orgId: v.string(),
    patchSpaceId: v.id("patchSpaces"),
    fromPortId: v.id("ports"),
    toPortId: v.id("ports"),
    isNormalled: v.boolean(),
    /*
     * A tie line: permanent copper in the wall between two panels, not a
     * cable anyone patches. It spends no stock, survives every repatch, and
     * is the reason a mic in the booth can reach a preamp in the control
     * room at all. Kept apart from ordinary runs because a run sheet that
     * tells an engineer to "patch" the building's own wiring is wrong.
     */
    isTieLine: v.optional(v.boolean()),
    // The cable stock row this run is drawn from.
    cableId: v.optional(v.id("equipment")),
    // Labelling. A cable is usually labelled in three places: once in the
    // middle with what it is, and once at each end with where the OTHER
    // end goes. The end labels are deliberately separate strings because
    // they say different things: the interface end reads "out to monitors"
    // while the monitor end reads "in from the interface".
    cableTag: v.optional(v.string()),
    cableLabelMode: v.optional(v.union(v.literal("single"), v.literal("perEnd"))),
    cableTagSource: v.optional(v.string()),
    cableTagTarget: v.optional(v.string()),
    // Result of the last connector check against the assigned cable.
    // "mismatch" means someone recorded it anyway, which is allowed but
    // has to be visible on the run list rather than silently fine.
    cableFit: v.optional(
      v.union(
        v.literal("exact"),
        v.literal("compatible"),
        v.literal("vague"),
        v.literal("mismatch"),
      ),
    ),
    // Overrides when the run does not match the stock row's spec.
    cableColor: v.optional(v.string()),
    cableLengthFt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_patchSpace", ["patchSpaceId"])
    .index("by_fromPort", ["fromPortId"])
    .index("by_toPort", ["toPortId"])
    .index("by_cable", ["cableId"])
    .index("by_org", ["orgId"]),

  // ── Patch audit - append-only. Every mutation that touches a device, a
  //    port or a connection writes one of these in the same transaction.
  //    This is the source of truth for what changed; snapshots in a later
  //    phase are named markers into this log. ──
  patchAudit: defineTable({
    orgId: v.string(),
    patchSpaceId: v.id("patchSpaces"),
    actor: v.string(), // human label from currentActor()
    at: v.number(),
    entityType: v.union(
      v.literal("patchSpace"),
      v.literal("device"),
      v.literal("port"),
      v.literal("connection"),
      v.literal("note"),
      v.literal("group"),
    ),
    entityId: v.string(),
    changeType: v.union(
      v.literal("create"),
      v.literal("update"),
      v.literal("delete"),
    ),
    // One line, already written for a human. "Patched Neve 1073 ch3 out to Pro Tools in 5".
    summary: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
  })
    .index("by_patchSpace_at", ["patchSpaceId", "at"])
    .index("by_org_at", ["orgId", "at"]),
});
