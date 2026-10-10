import { defineTable } from "convex/server";
import { v } from "convex/values";
import { callTables } from "./callTables";

/* Outreach tab tables. Every row is owned by an agency (agencyId = the Clerk
   org id carried by the agency viewer). The client never supplies agencyId:
   server functions derive it from the authenticated viewer. */

export const commStatusV = v.union(
  v.literal("draft"),
  v.literal("approved"),
  v.literal("submitting"),
  v.literal("accepted"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("rejected"),
  v.literal("suppressed"),
  v.literal("unknown"),
);


export const prospectStatusV = v.union(
  v.literal("needs_website"),
  v.literal("ready_to_scrape"),
  v.literal("scraping"),
  v.literal("scraped"),
  v.literal("no_contact"),
  v.literal("blocked"),
  v.literal("unreachable"),
  v.literal("queued"),
  v.literal("suppressed"),
  /* The studio answered (detected in stored inbound mail, or marked by a person).
     Stops the follow-up sequence; MaxB can still reply in the thread. */
  v.literal("replied"),
);

/* Why a follow-up sequence stopped. Every reason is final: nothing restarts a stopped sequence. */
export const sequenceStopV = v.union(
  v.literal("replied"),
  v.literal("demo_booked"),
  v.literal("bounced"),
  v.literal("complained"),
  v.literal("opted_out"),
  v.literal("suppressed"),
  v.literal("manual"),
);

/* Per-prospect copy for MaxB follow-up steps 1 to 3 (from the outreach CSV). Plain text. */
export const followupOverridesV = v.object({
  step1: v.optional(v.string()),
  step2: v.optional(v.string()),
  step3: v.optional(v.string()),
});

export const prospectContactsV = v.object({
  emails: v.array(v.object({ address: v.string(), generic: v.boolean(), rank: v.number(), sourceUrl: v.string() })),
  phones: v.array(v.object({ number: v.string(), sourceUrl: v.string() })),
  socials: v.array(v.object({ platform: v.string(), url: v.string() })),
  booking: v.array(v.string()),
  pages: v.array(v.string()),
  scrapedAt: v.number(),
});

export const outreachTables = {
  ...callTables,
  /* One row per agency. Provider mapping (GHL location/calendar, senders,
     booking URL) is written only by operator-run internal mutations, never by
     the browser, so an agency cannot claim another tenant's provider account. */
  outreachSettings: defineTable({
    agencyId: v.string(),
    paused: v.boolean(),
    mode: v.union(v.literal("test_only"), v.literal("live")),
    ghlLocationId: v.optional(v.string()),
    ghlCalendarId: v.optional(v.string()),
    /* The Zuops workspace and calendar behind studiopulse.tech/demo. Set only by an
       operator mutation; every Zuops call is pinned to this workspace id. */
    zuopsWorkspaceId: v.optional(v.string()),
    zuopsCalendarId: v.optional(v.string()),
    bookingUrl: v.optional(v.string()),
    bookingDurationMin: v.optional(v.number()),
    timezone: v.optional(v.string()),
    senders: v.array(
      v.object({
        label: v.string(),
        address: v.string(),
        verified: v.boolean(),
        verifiedAt: v.optional(v.number()),
      }),
    ),
    verifiedAt: v.optional(v.number()),
    postalAddress: v.optional(v.string()),
    testConfirmedAt: v.optional(v.number()),
    testConfirmedNote: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_agency", ["agencyId"]),

  outreachTemplates: defineTable({
    agencyId: v.string(),
    key: v.string(),
    name: v.string(),
    subject: v.string(),
    bookingUrl: v.string(),
    contentHash: v.string(),
    signatureKey: v.optional(v.string()),
    source: v.string(),
    approval: v.union(
      v.literal("draft"),
      v.literal("awaiting_review"),
      v.literal("approved"),
      v.literal("superseded"),
    ),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_agency", ["agencyId"]),

  outreachCommunications: defineTable({
    agencyId: v.string(),
    channel: v.literal("email"),
    templateKey: v.optional(v.string()),
    recipient: v.string(),
    sender: v.string(),
    subject: v.string(),
    isTest: v.boolean(),
    status: commStatusV,
    providerId: v.optional(v.string()),
    /* The Message-ID header Pulse set on the send; follow-ups thread to it. */
    messageId: v.optional(v.string()),
    idempotencyKey: v.string(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_agency", ["agencyId", "createdAt"])
    .index("by_agency_key", ["agencyId", "idempotencyKey"]),

  outreachEvents: defineTable({
    agencyId: v.string(),
    at: v.number(),
    actor: v.string(),
    action: v.string(),
    resource: v.optional(v.string()),
    result: v.union(v.literal("ok"), v.literal("denied"), v.literal("unknown")),
    detail: v.optional(v.string()),
  }).index("by_agency", ["agencyId", "at"]),
  /* A studio to pitch. Contact data is what the studio itself published on its
     own website: published, not verified. */
  outreachProspects: defineTable({
    agencyId: v.string(),
    dedupeKey: v.string(),
    handle: v.optional(v.string()),
    name: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    source: v.union(v.literal("paste"), v.literal("shortcut"), v.literal("instaloader"), v.literal("maps"), v.literal("instagram_search")),
    status: prospectStatusV,
    note: v.optional(v.string()),
    contacts: v.optional(prospectContactsV),
    /* What the studio says about itself (Instagram bio, Maps category). Used to
       write a true, specific opener; never shown as a contact. */
    bio: v.optional(v.string()),
    category: v.optional(v.string()),
    followers: v.optional(v.number()),
    /* Start of the demo this studio booked through Zuops (matched by email), if any. */
    bookedAt: v.optional(v.number()),
    /* When the studio replied (or a person marked it replied). */
    repliedAt: v.optional(v.number()),
    /* An owner or admin confirmed who handles studio operations behind a generic
       inbox. Clears the generic-inbox hold on this prospect's drafts; never approves. */
    routingConfirmed: v.optional(v.boolean()),
    routingConfirmedBy: v.optional(v.string()),
    routingConfirmedAt: v.optional(v.number()),
    /* Step-0 defaults from the outreach CSV: the opening line (and where it came
       from), subject and middle paragraphs. Prefill the Prepare block; a draft
       copies them, so the draft's own copy is what approval binds to. */
    hook: v.optional(v.string()),
    hookSourceUrl: v.optional(v.string()),
    subjectDefault: v.optional(v.string()),
    bodyDefault: v.optional(v.string()),
    followups: v.optional(followupOverridesV),
    /* Draft text for the DMs tab (from the CSV's ig_dm). */
    igDmDraft: v.optional(v.string()),
    fitScore: v.optional(v.number()),
    priority: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_agency", ["agencyId", "createdAt"])
    .index("by_agency_key", ["agencyId", "dedupeKey"]),

  outreachSuppressions: defineTable({
    agencyId: v.string(),
    email: v.string(),
    reason: v.string(),
    at: v.number(),
  }).index("by_agency_email", ["agencyId", "email"]),
  /* A prepared email for one prospect. Approval binds to contentHash; any
     change to copy, signature, sender, recipient, booking link or address
     invalidates it. Sending is not part of this table's job. */
  outreachDrafts: defineTable({
    agencyId: v.string(),
    prospectId: v.id("outreachProspects"),
    studio: v.string(),
    recipient: v.string(),
    persona: v.union(v.literal("maxb"), v.literal("lawrence")),
    templateKey: v.string(),
    signatureMode: v.union(v.literal("image"), v.literal("animated"), v.literal("original"), v.literal("static")),
    observation: v.optional(v.string()),
    /* Optional per-draft copy. Replaces only the middle paragraphs (body) or the
       subject; never the greeting, opening line, offer, CTA, footer or opt-out. */
    subjectOverride: v.optional(v.string()),
    bodyOverride: v.optional(v.string()),
    /* 0 = Lawrence's first email, 1-3 = MaxB follow-ups. Unset for a MaxB reply. */
    sequenceStep: v.optional(v.number()),
    /* Threading: the step-0 subject this replies to, and the Message-ID it threads under. */
    threadSubject: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.string()),
    subject: v.string(),
    html: v.string(),
    text: v.string(),
    contentHash: v.string(),
    blockers: v.array(v.string()),
    status: v.union(
      v.literal("draft"),
      v.literal("hold"),
      v.literal("approved"),
      v.literal("sending"),
      v.literal("sent"),
      v.literal("cancelled"),
      v.literal("superseded"),
    ),
    holdReason: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedHash: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_agency", ["agencyId", "createdAt"])
    .index("by_prospect", ["prospectId"]),
  /* One follow-up sequence per prospect, started when Lawrence's first email is
     accepted by the provider. The cron only ever creates drafts from it: every
     follow-up still needs Approve this email and a person's Send now. */
  outreachSequences: defineTable({
    agencyId: v.string(),
    prospectId: v.id("outreachProspects"),
    recipient: v.string(),
    /* The last step that was sent: 0 (Lawrence) to 3 (MaxB, day 14). */
    step: v.number(),
    status: v.union(v.literal("active"), v.literal("stopped"), v.literal("done")),
    /* When step 0 was accepted. Steps 1-3 are due 3, 7 and 14 days after it. */
    startedAt: v.number(),
    lastSentAt: v.number(),
    nextDueAt: v.optional(v.number()),
    /* The open draft for the next step, once the cron has created it. */
    pendingDraftId: v.optional(v.id("outreachDrafts")),
    stoppedReason: v.optional(sequenceStopV),
    stoppedAt: v.optional(v.number()),
    stoppedBy: v.optional(v.string()),
    /* Thread ids: the Message-ID set on step 0 and the provider's id for it. */
    threadMessageId: v.string(),
    threadProviderId: v.optional(v.string()),
    threadSubject: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_prospect", ["prospectId"])
    .index("by_agency_recipient", ["agencyId", "recipient"])
    .index("by_status_due", ["status", "nextDueAt"]),

  /* The latest read-only snapshot of the agency's mapped GHL calendar. */
  outreachCalendar: defineTable({
    agencyId: v.string(),
    fetchedAt: v.number(),
    ok: v.boolean(),
    error: v.optional(v.string()),
    calendar: v.optional(v.object({
      id: v.string(), name: v.string(), active: v.boolean(), durationMin: v.union(v.number(), v.null()),
      widgetSlug: v.union(v.string(), v.null()), formId: v.union(v.string(), v.null()), autoConfirm: v.boolean(),
    })),
    slots: v.array(v.object({ date: v.string(), count: v.number(), first: v.union(v.string(), v.null()) })),
    appointments: v.array(v.object({
      id: v.string(), title: v.string(), start: v.number(), end: v.number(), status: v.string(), contactName: v.union(v.string(), v.null()),
    })),
  }).index("by_agency", ["agencyId"]),

  /* One discovery request (a Google Maps or Instagram search through treg).
     The results land as outreachProspects; this row is the receipt. */
  outreachDiscoveries: defineTable({
    agencyId: v.string(),
    kind: v.union(v.literal("maps"), v.literal("instagram")),
    query: v.string(),
    location: v.optional(v.string()),
    limit: v.number(),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
    found: v.number(),
    added: v.number(),
    duplicates: v.number(),
    error: v.optional(v.string()),
    requestedBy: v.string(),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index("by_agency", ["agencyId", "createdAt"]),
  /* A prepared Instagram DM for one prospect. Pulse never sends it: a person
     approves it, sends it from Instagram, then marks it sent. Approval binds to
     contentHash and expires in 24 hours. */
  outreachDms: defineTable({
    agencyId: v.string(),
    prospectId: v.id("outreachProspects"),
    handle: v.string(),
    studio: v.string(),
    text: v.string(),
    observation: v.optional(v.string()),
    contentHash: v.string(),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("sent"), v.literal("cancelled")),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedHash: v.optional(v.string()),
    sentBy: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_agency", ["agencyId", "createdAt"])
    .index("by_prospect", ["prospectId"]),
  /* A demo booked on the Zuops calendar, mirrored read-only. Pulse keeps the name,
     email, the three consent answers and, for the confirmation call only, the phone. */
  outreachBookings: defineTable({
    agencyId: v.string(),
    zuopsBookingId: v.string(),
    zuopsLeadId: v.optional(v.string()),
    title: v.string(),
    startsAt: v.number(),
    endsAt: v.number(),
    timezone: v.optional(v.string()),
    status: v.union(v.literal("confirmed"), v.literal("cancelled"), v.literal("completed"), v.literal("no_show"), v.literal("other")),
    location: v.optional(v.string()),
    meetingUrl: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    consent: v.optional(v.object({ sms: v.optional(v.boolean()), call: v.optional(v.boolean()), email: v.optional(v.boolean()) })),
    emailOptOut: v.optional(v.boolean()),
    /* The lead's phone (E.164 when it parses). Kept only so the confirmation call can
       dial it: never logged, never returned to the browser unmasked. */
    phone: v.optional(v.string()),
    /* True once the Zuops lead has been read for this row (so phone and consent are current). */
    phoneSynced: v.optional(v.boolean()),
    /* The Zuops lead is marked do-not-disturb. No confirmation call while set. */
    dnd: v.optional(v.boolean()),
    prospectId: v.optional(v.id("outreachProspects")),
    syncedAt: v.number(),
  })
    .index("by_agency_start", ["agencyId", "startsAt"])
    .index("by_agency_booking", ["agencyId", "zuopsBookingId"]),
  /* The latest read of the mapped Zuops calendar and the sync's own health. */
  outreachZuopsSnapshot: defineTable({
    agencyId: v.string(),
    fetchedAt: v.number(),
    ok: v.boolean(),
    error: v.optional(v.string()),
    bookings: v.optional(v.number()),
    calendar: v.optional(v.object({
      id: v.string(), name: v.string(), title: v.optional(v.string()), slug: v.optional(v.string()),
      durationMin: v.number(), bufferMin: v.number(), minNoticeMin: v.number(), maxDaysAhead: v.number(),
      timezone: v.optional(v.string()), active: v.boolean(), hours: v.record(v.string(), v.array(v.string())),
      locationLabel: v.optional(v.string()),
    })),
  }).index("by_agency", ["agencyId"]),
};
