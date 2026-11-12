/* Zuops operationIds the Inbox calls. Each is an entry in convex/crm/ops.generated.ts
   (ZU_OPS); that registry is deliberately not imported here (eval P-04).
   `send`, `sendScheduledNow` and `approveSuggestion` reach real people: the server
   refuses them without a confirm grant from ConfirmDialog (design D12). */

export const INBOX_OP = {
  conversations: "list_conversations",
  thread: "lead_conversation",
  markRead: "mark_conversation_read",
  markUnread: "mark_conversation_unread",
  archive: "archive_conversation",
  unarchive: "unarchive_conversation",
  aiPause: "set_lead_ai_pause",

  send: "send_message",
  limits: "message_limits",
  phoneNumbers: "list_phone_numbers",

  scheduled: "list_scheduled_messages",
  scheduledUpdate: "update_scheduled_message",
  sendScheduledNow: "send_scheduled_message_now",

  suggestions: "list_reply_suggestions",
  approveSuggestion: "approve_reply_suggestion",
  dismissSuggestion: "dismiss_reply_suggestion",
  replyIdeas: "lead_reply_ideas",

  lead: "get_lead",
} as const;

export type InboxOpId = (typeof INBOX_OP)[keyof typeof INBOX_OP];
