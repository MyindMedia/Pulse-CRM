import { defineTable } from "convex/server";
import { v } from "convex/values";

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

export const outreachTables = {
  /* One row per agency. Provider mapping (GHL location/calendar, senders,
     booking URL) is written only by operator-run internal mutations, never by
     the browser, so an agency cannot claim another tenant's provider account. */
  outreachSettings: defineTable({
    agencyId: v.string(),
    paused: v.boolean(),
    mode: v.union(v.literal("test_only"), v.literal("live")),
    ghlLocationId: v.optional(v.string()),
    ghlCalendarId: v.optional(v.string()),
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
};
