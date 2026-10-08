import { defineTable } from "convex/server";
import { v } from "convex/values";

/* Confirmation calls: the automated Bland AI call that confirms a booked demo.
   Every row is owned by an agency. See openspec/changes/confirmation-calls. */

export const callStatusV = v.union(
  v.literal("queued"),
  v.literal("dry_run"),
  v.literal("dialing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("skipped"),
  v.literal("cancelled"),
);

export const callTables = {
  /* One row per agency. Defaults are applied in code (callPolicy.DEFAULT_SETTINGS)
     when the row is missing, and a missing row means the feature is OFF. */
  outreachCallSettings: defineTable({
    agencyId: v.string(),
    enabled: v.boolean(),
    mode: v.union(v.literal("dry_run"), v.literal("live")),
    delayMinutes: v.number(),
    windowStart: v.string(),
    windowEnd: v.string(),
    windowDays: v.array(v.number()),
    timezone: v.string(),
    dailyCap: v.number(),
    maxDurationMinutes: v.number(),
    killSwitch: v.boolean(),
    allowTestBookings: v.boolean(),
    fromNumber: v.optional(v.string()),
    voice: v.optional(v.string()),
    enabledAt: v.optional(v.number()),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_agency", ["agencyId"]),

  /* One row per booking, ever. The phone is E.164 and never leaves the server
     unmasked. */
  outreachCalls: defineTable({
    agencyId: v.string(),
    bookingId: v.id("outreachBookings"),
    phone: v.optional(v.string()),
    status: callStatusV,
    skipReason: v.optional(v.string()),
    scheduledFor: v.number(),
    blandCallId: v.optional(v.string()),
    attempts: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    dialedAt: v.optional(v.number()),
    answeredBy: v.optional(v.string()),
    result: v.optional(v.object({
      summary: v.optional(v.string()),
      disposition: v.optional(v.string()),
      callLengthMin: v.optional(v.number()),
      optOut: v.optional(v.boolean()),
      error: v.optional(v.string()),
    })),
    dryRun: v.optional(v.object({ body: v.any(), reasons: v.array(v.string()) })),
  })
    .index("by_agency_booking", ["agencyId", "bookingId"])
    .index("by_agency_status", ["agencyId", "status"])
    .index("by_agency_dialed", ["agencyId", "dialedAt"])
    .index("by_agency_created", ["agencyId", "createdAt"])
    .index("by_bland_call", ["blandCallId"]),

  /* The do-not-call list. A phone or an email match blocks the call. */
  outreachCallOptOuts: defineTable({
    agencyId: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    reason: v.string(),
    at: v.number(),
    callId: v.optional(v.id("outreachCalls")),
  })
    .index("by_agency_phone", ["agencyId", "phone"])
    .index("by_agency_email", ["agencyId", "email"]),
};
