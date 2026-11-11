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
    deliveryId: v.string(),
    leadId: v.optional(v.string()),
    bookingId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    callId: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_agency_at", ["agencyId", "at"])
    .index("by_delivery", ["deliveryId"])
    .index("by_at", ["at"]),
};
