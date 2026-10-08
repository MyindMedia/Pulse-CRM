import { defineTable } from "convex/server";
import { v } from "convex/values";

/* Agency Email tab (shared inbox for studiopulse.tech). Every row carries the
   agencyId of the mail-owning agency; server functions derive it, the client
   never supplies it. Bytes of attachments live in R2 (mediaFiles), never here. */

export const mailboxKindV = v.union(v.literal("shared"), v.literal("personal"));

export const mailAttachmentV = v.object({
  resendId: v.optional(v.string()),
  filename: v.string(),
  contentType: v.string(),
  size: v.optional(v.number()),
  contentId: v.optional(v.string()),
  inline: v.boolean(),
  /** mediaFiles id once the bytes are in R2. */
  fileRef: v.optional(v.id("mediaFiles")),
  status: v.union(v.literal("pending"), v.literal("stored"), v.literal("skipped"), v.literal("failed")),
  note: v.optional(v.string()),
});

export const mailTables = {
  mailboxes: defineTable({
    agencyId: v.string(),
    /** Full address, lowercase, unique across the deployment. */
    address: v.string(),
    localPart: v.string(),
    displayName: v.string(),
    /** Name in the From header. Defaults to displayName. */
    fromName: v.string(),
    kind: mailboxKindV,
    /** Personal mailboxes sign with an existing outreach signature. */
    signature: v.optional(v.union(v.literal("lawrence"), v.literal("roverto"))),
    active: v.boolean(),
    createdAt: v.number(),
    createdBy: v.string(),
  })
    .index("by_address", ["address"])
    .index("by_agency", ["agencyId"]),

  mailThreads: defineTable({
    agencyId: v.string(),
    /** Unset = Unrouted (sent to an address of ours that has no mailbox). */
    mailboxId: v.optional(v.id("mailboxes")),
    subject: v.string(),
    normalizedSubject: v.string(),
    /** Lowercased external addresses on the thread. */
    participants: v.array(v.string()),
    /** Our addresses the first message was sent to (shown in Unrouted). */
    originalRecipients: v.optional(v.array(v.string())),
    lastMessageAt: v.number(),
    lastSnippet: v.string(),
    lastFrom: v.string(),
    messageCount: v.number(),
    unreadCount: v.number(),
    status: v.union(v.literal("open"), v.literal("archived")),
    createdAt: v.number(),
  })
    .index("by_agency_mailbox_last", ["agencyId", "mailboxId", "lastMessageAt"])
    .index("by_mailbox_subject", ["mailboxId", "normalizedSubject"]),

  mailMessages: defineTable({
    agencyId: v.string(),
    threadId: v.id("mailThreads"),
    mailboxId: v.optional(v.id("mailboxes")),
    direction: v.union(v.literal("in"), v.literal("out")),
    from: v.string(),
    fromAddress: v.string(),
    to: v.array(v.string()),
    cc: v.array(v.string()),
    replyTo: v.optional(v.array(v.string())),
    receivedFor: v.optional(v.array(v.string())),
    subject: v.string(),
    text: v.optional(v.string()),
    /** Stored as received (data URIs stripped); sanitized when rendered. */
    html: v.optional(v.string()),
    htmlTruncated: v.optional(v.boolean()),
    snippet: v.string(),
    messageId: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    resendEmailId: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    read: v.boolean(),
    /** Inbound: "pending" while the full body is still being fetched from Resend. */
    bodyStatus: v.optional(v.union(v.literal("ok"), v.literal("pending"), v.literal("failed"))),
    hydrateAttempts: v.optional(v.number()),
    authentication: v.optional(v.object({ spf: v.optional(v.string()), dkim: v.optional(v.string()), dmarc: v.optional(v.string()) })),
    attachments: v.array(mailAttachmentV),
    /** Outbound only. Never auto-retried: "unknown" is checked by a person. */
    sendStatus: v.optional(v.union(v.literal("sending"), v.literal("accepted"), v.literal("rejected"), v.literal("unknown"))),
    sendError: v.optional(v.string()),
    /** Resend id of a message we sent. */
    providerId: v.optional(v.string()),
    sentBy: v.optional(v.string()),
  })
    .index("by_thread", ["threadId", "createdAt"])
    .index("by_resend_id", ["resendEmailId"])
    .index("by_agency_message_id", ["agencyId", "messageId"]),
};
