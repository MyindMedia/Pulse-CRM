/* Zuops operationIds the Social panel calls (Instagram and Messenger, under
   Messaging in the Zuops reference). Each is an entry in convex/crm/ops.generated.ts
   (ZU_OPS); that registry is deliberately not imported here (eval P-04). */

export const SOCIAL_OP = {
  accounts: "list_social_accounts",
  settings: "get_social_settings",
  settingsUpdate: "update_social_settings",
  moveDmLeads: "move_dm_leads",
  comments: "list_social_comments",
  messages: "list_messages",
} as const;

export type SocialOpId = (typeof SOCIAL_OP)[keyof typeof SOCIAL_OP];
