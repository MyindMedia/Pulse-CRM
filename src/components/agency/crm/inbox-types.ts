/* Inbox response shapes (the `data` part of the Zuops envelope), from
   specs/features/agency-crm-zuops/api-shapes.md and the examples in the Zuops
   OpenAPI spec. Everything is optional or nullable: a screen must never crash on
   a field the live account left empty. */

import type { Iso, MessageLimits } from "./zu-types";

export type Channel = "sms" | "email" | "instagram" | "messenger";

export type ConversationAi = {
  paused?: boolean | null;
  paused_until?: Iso | null;
  pause_reason?: string | null;
  handoff_question?: string | null;
};

export type LastMessage = {
  id?: string;
  channel?: string | null;
  direction?: "inbound" | "outbound" | string | null;
  body?: string | null;
  subject?: string | null;
  sent_by?: string | null;
  created_at?: Iso | null;
};

export type Conversation = {
  lead_id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  stage_key?: string | null;
  assigned_to?: string | null;
  unread?: boolean | null;
  unread_count?: number | null;
  archived?: boolean | null;
  ai?: ConversationAi | null;
  channel?: string | null;
  last_message?: LastMessage | null;
  last_inbound_at?: Iso | null;
  last_outbound_at?: Iso | null;
  last_activity_at?: Iso | null;
};

export type ConversationCounts = { open?: number | null; unread?: number | null; archived?: number | null };

export type ConversationsResponse = {
  conversations?: Conversation[];
  has_more?: boolean;
  next_cursor?: string | null;
  counts?: ConversationCounts | null;
};

export type ThreadEvent = {
  id: string;
  event_type?: string | null;
  actor_label?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: Iso | null;
};

export type ThreadLead = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  last_inbound_at?: Iso | null;
  last_outbound_at?: Iso | null;
};

export type ThreadResponse = { lead?: ThreadLead | null; messages?: ThreadEvent[] };

export type ScheduledMessage = {
  id: string;
  lead_id?: string | null;
  channel?: string | null;
  body?: string | null;
  subject?: string | null;
  scheduled_at?: Iso | null;
  status?: "pending" | "sending" | "failed" | "sent" | "cancelled" | string | null;
  last_error?: string | null;
  lead?: { id?: string; full_name?: string | null; phone?: string | null; email?: string | null } | null;
};

export type ScheduledResponse = { scheduled_messages?: ScheduledMessage[]; has_more?: boolean; next_cursor?: string | null };

export type SuggestionPlan = {
  starts_at?: Iso | null;
  ends_at?: Iso | null;
  title?: string | null;
  timezone?: string | null;
};

export type ReplySuggestion = {
  id: string;
  lead_id?: string | null;
  channel?: string | null;
  body?: string | null;
  status?: string | null;
  error?: string | null;
  inbound_at?: Iso | null;
  created_at?: Iso | null;
  books?: SuggestionPlan | null;
  cancels?: SuggestionPlan | null;
  lead?: { id?: string; full_name?: string | null; phone?: string | null; email?: string | null } | null;
};

export type SuggestionsResponse = { reply_mode?: string | null; suggestions?: ReplySuggestion[]; has_more?: boolean };

export type ReplyIdea = { label?: string | null; text?: string | null };
export type ReplyIdeasResponse = { kind?: string | null; replies?: ReplyIdea[]; subject?: string | null; channel?: string | null };

export type PhoneNumber = {
  id: string;
  phone_number?: string | null;
  friendly_name?: string | null;
  is_default?: boolean | null;
  texting_ready?: boolean | null;
  released_at?: Iso | null;
};
export type PhoneNumbersResponse = { phone_numbers?: PhoneNumber[] };

export type InboxLimits = Pick<MessageLimits, "daily_unique_contact_cap" | "unique_contacts_remaining" | "frozen" | "frozen_reason" | "resets_at">;
