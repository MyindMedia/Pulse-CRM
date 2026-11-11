/* Response shapes from the Zuops API (the `data` part of its envelope), as captured
   in specs/features/agency-crm-zuops/api-shapes.md. Everything is optional or
   nullable: a field the live account left empty may be filled for another lead,
   and a field missing today must never crash a screen. */

export type Iso = string;

export type StageColor =
  | "blue" | "amber" | "violet" | "cyan" | "emerald" | "rose" | "teal" | "orange" | "pink" | "indigo" | "lime" | "slate";
export type StageBehavior = "new" | "contacted" | "booked" | "won" | "lost";

export type Stage = {
  id: string;
  key: string;
  label: string;
  color?: StageColor | string | null;
  behavior?: StageBehavior | string | null;
  position?: number | null;
  is_system?: boolean | null;
  hidden?: boolean | null;
};
export type StagesResponse = { stages?: Stage[] };

export type Tag = { id: string; name: string; color?: string | null; lead_count?: number | null; created_at?: Iso | null };
export type TagsResponse = { tags?: Tag[] };

export type CustomFieldType =
  | "text" | "textarea" | "number" | "money" | "rating" | "boolean" | "date" | "datetime" | "select" | "multiselect"
  | "email" | "phone" | "url" | string;

export type CustomField = {
  id: string;
  field_key: string;
  label: string;
  field_type?: CustomFieldType | null;
  options?: Array<string | { value?: string; label?: string }> | null;
  required?: boolean | null;
  sort_order?: number | null;
  helper_text?: string | null;
  placeholder?: string | null;
  default_value?: unknown;
  show_in_list?: boolean | null;
  group_name?: string | null;
  archived_at?: Iso | null;
};
export type CustomFieldsResponse = { custom_fields?: CustomField[] };

export type Lead = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: string | null;
  stage?: string | null;
  stage_key?: string | null;
  score?: number | null;
  assigned_to?: string | null;
  notes?: string | null;
  inquiry?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  tags?: string[] | null;
  custom_fields?: Record<string, unknown> | null;
  existing_customer?: boolean | null;
  chat_only?: boolean | null;
  deal_value_cents?: number | null;
  deal_currency?: string | null;
  deal_won_at?: Iso | null;
  email_opt_out?: boolean | null;
  email_invalid?: boolean | null;
  phone_invalid?: boolean | null;
  ai_paused?: boolean | null;
  unread?: boolean | null;
  campaign_name?: string | null;
  ad_name?: string | null;
  attribution_channel?: string | null;
  created_at?: Iso | null;
  updated_at?: Iso | null;
  last_activity_at?: Iso | null;
  last_inbound_at?: Iso | null;
  last_outbound_at?: Iso | null;
};
export type LeadsResponse = { leads?: Lead[]; has_more?: boolean; next_offset?: number | null };
export type LeadResponse = { lead?: Lead; events?: TimelineEvent[] };

export type TimelineEvent = {
  id: string;
  event_type?: string | null;
  actor_label?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at?: Iso | null;
};
export type TimelineResponse = { lead_id?: string; events?: TimelineEvent[] };

export type Overview = {
  window?: { from?: Iso; to?: Iso; days?: number } | null;
  stats?: {
    won?: number;
    leads?: number;
    prev_leads?: number;
    closed?: number;
    contacted?: number;
    appointments?: number;
    prev_appointments?: number;
    booked_leads?: number;
    prev_booked_leads?: number;
    new_unworked?: number;
    upcoming_appointments?: number;
    median_response_minutes?: number | null;
    median_response_minutes_auto?: number | null;
    median_response_minutes_human?: number | null;
    calls?: { total?: number; answered?: number; missed_inbound?: number } | null;
    ai_replies?: { total?: number } | null;
    stage_reach?: { total?: number; reached?: Record<string, number> } | null;
  } | null;
};

export type HealthFactor = {
  key: string;
  label?: string | null;
  weight?: number | null;
  earned?: number | null;
  applies?: boolean | null;
  value?: string | null;
  detail?: string | null;
  hint?: string | null;
  gain?: number | null;
};
export type HealthAction = {
  key: string;
  title?: string | null;
  why?: string | null;
  gain?: number | null;
  path?: string | null;
  cta?: string | null;
  urgent?: boolean | null;
};
export type HealthScore = {
  score?: number | null;
  grade?: string | null;
  is_new?: boolean | null;
  verdict?: string | null;
  factors?: HealthFactor[] | null;
  actions?: HealthAction[] | null;
  waiting?: { count?: number; longest_since?: Iso | null } | null;
};

export type Usage = {
  window?: { from?: Iso; to?: Iso; days?: number } | null;
  total_credits?: number | null;
  total_events?: number | null;
  unpaid_events?: number | null;
  by_tool?: Array<{ tool: string; label?: string | null; events?: number | null; credits?: number | null; unpaid?: number | null }> | null;
};

export type MessageLimits = {
  daily_unique_contact_cap?: number | null;
  unique_contacts_used?: number | null;
  unique_contacts_remaining?: number | null;
  segments_used?: number | null;
  segment_safety_cap?: number | null;
  messages_sent_today?: number | null;
  frozen?: boolean | null;
  frozen_reason?: string | null;
  resets_at?: Iso | null;
};
export type LimitsResponse = { limits?: MessageLimits | null };

/* GET /v1/setup-status was not captured in api-shapes.md. llms.txt says it returns
   the configuration plus "a severity-ranked list of findings", each naming the API
   call and MCP tool that fixes it, or saying it can only be done in the app. The
   finding fields are read defensively by `setupFindings` in crm-dashboard.tsx. */
export type SetupFinding = Record<string, unknown>;
export type SetupStatus = { findings?: SetupFinding[] | null; issues?: SetupFinding[] | null } & Record<string, unknown>;

export type Member = { id: string; user_id?: string; role?: string; email?: string | null; full_name?: string | null };
export type MembersResponse = { members?: Member[] };
