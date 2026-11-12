import { defineTable } from "convex/server";
import { v } from "convex/values";

/* Agency CRM tables (design addendum, "Tables"). Zuops is the record and is read
   live, so the only thing the CRM keeps is a pulse per webhook delivery: the event
   name and ids, never a name, phone, email or message body. Pruned daily to 7 days.
   Audit rows go to the existing outreachEvents. */

export const crmTables = {
  crmPulses: defineTable({
    agencyId: v.string(),
    event: v.string(),
    /** What the event is about, for crm.signal. Optional only so a row from before it existed still validates. */
    kind: v.optional(v.union(v.literal("lead"), v.literal("booking"), v.literal("message"), v.literal("call"), v.literal("deal"))),
    /** SHA-256 hex of the raw signed body: the de-duplication key (F-B2). */
    deliveryId: v.string(),
    /** Zuops's X-Webhook-Delivery header, kept for tracing only; never trusted for de-duplication. */
    deliveryHeader: v.optional(v.string()),
    leadId: v.optional(v.string()),
    bookingId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    callId: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_agency_at", ["agencyId", "at"])
    .index("by_agency_kind_at", ["agencyId", "kind", "at"])
    .index("by_delivery", ["deliveryId"])
    .index("by_at", ["at"]),
};
