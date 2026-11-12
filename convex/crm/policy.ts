/* What `crm.call` lets through (design D11, D12). Pure: no Convex imports.

   Every request is built from the generated registry (ops.generated.ts): the
   operation must exist, path values are checked and encoded, query and body keys
   must be fields the registry knows, and `workspace_id` never leaves Pulse.

   Confirmation is deny-by-default: EVERY write operation in the registry is
   classified below by hand, and a test fails when the registry gains a write the
   map does not name, when the map names an operation that is gone, or when an
   operation's method or path moved. An unclassified write is treated as reaching
   people. */

import { ZU_OPS, type ZuField, type ZuOp } from "./ops.generated";

export type SendKind = "reaches" | "changes_sending" | "spends" | "exposes" | "safe";
export type ConfirmKind = Exclude<SendKind, "safe"> | "delete";

/** Every non-GET operation: its "METHOD /path" (checked against the registry) and
 *  what it does when run with an EMPTY body. Kinds:
 *  - reaches: messages or publishes to real people (leads, customers, the public).
 *  - changes_sending: changes what Zuops sends automatically, or what the public sees live.
 *  - spends: uses credits or starts paid or AI work (unsure whether metered = spends).
 *  - exposes: sends lead data outside the account or changes who can access it.
 *  - safe: plain record edits. Every DELETE is confirmed by its method.
 *    Bookings are NOT safe (R3-B4 reverses D12): create, reschedule and cancel
 *    notify the lead unless the body says otherwise.
 *  Operations whose kind depends on the body are refined by BODY_RULES. */
export const CLASSIFIED: Readonly<Record<string, readonly [route: string, kind: SendKind]>> = {
  // AI Brain
  create_ai_lesson: ["POST /v1/ai-lessons", "changes_sending"],
  delete_ai_lesson: ["DELETE /v1/ai-lessons/{lesson_id}", "safe"],
  rate_ai_message: ["POST /v1/messages/{message_id}/rating", "safe"],
  update_ai_lesson: ["PATCH /v1/ai-lessons/{lesson_id}", "changes_sending"],
  // AI agent
  add_brain_photo: ["POST /v1/ai-brain/photos", "spends"],
  add_brain_prices: ["POST /v1/ai-brain/prices", "changes_sending"],
  add_knowledge_base: ["POST /v1/knowledge-base", "changes_sending"],
  answer_brain_waiting: ["POST /v1/ai-brain/waiting/answer", "changes_sending"],
  clear_nurture: ["DELETE /v1/nurture-sequence", "safe"],
  delete_brain_photo: ["DELETE /v1/ai-brain/photos/{photo_id}", "safe"],
  dismiss_brain_waiting: ["POST /v1/ai-brain/waiting/dismiss", "safe"],
  remove_brain_price: ["DELETE /v1/ai-brain/prices/{item_id}", "safe"],
  set_ai_receptionist: ["PUT /v1/ai-receptionist", "changes_sending"],
  set_ai_texting: ["PATCH /v1/ai-texting", "changes_sending"],
  set_brain_price_note: ["PUT /v1/ai-brain/prices/note", "changes_sending"],
  set_knowledge_base: ["PUT /v1/knowledge-base", "changes_sending"],
  set_nurture: ["PUT /v1/nurture-sequence", "changes_sending"],
  update_brain_photo: ["PATCH /v1/ai-brain/photos/{photo_id}", "changes_sending"],
  update_brain_price: ["PATCH /v1/ai-brain/prices/{item_id}", "changes_sending"],
  update_nurture: ["PATCH /v1/nurture-sequence", "changes_sending"],
  // Ads & Google
  apply_gbp_optimizer: ["POST /v1/google-business/optimizer/apply", "spends"],
  approve_gbp_post: ["POST /v1/google-business/posts/{post_id}/approve", "reaches"],
  create_gbp_embed: ["POST /v1/google-business/embeds", "safe"],
  create_gbp_post: ["POST /v1/google-business/posts", "safe"],
  create_rank_keyword: ["POST /v1/map-rankings/keywords", "spends"],
  delete_gbp_embed: ["DELETE /v1/google-business/embeds/{embed_id}", "safe"],
  delete_gbp_post: ["DELETE /v1/google-business/posts/{post_id}", "safe"],
  delete_rank_keyword: ["DELETE /v1/map-rankings/keywords/{keyword_id}", "safe"],
  draft_gbp_reply: ["POST /v1/google-business/reviews/{review_id}/draft", "spends"],
  make_gbp_connect_link: ["POST /v1/google-business/connect-link", "exposes"],
  mark_ai_visibility_step: ["PATCH /v1/ai-visibility/checks/{check_id}/advice", "safe"],
  publish_gbp_post: ["POST /v1/google-business/posts/{post_id}/publish", "reaches"],
  refresh_gbp_embed_facts: ["POST /v1/google-business/embeds/{embed_id}/facts", "spends"],
  reply_gbp_review: ["POST /v1/google-business/reviews/{review_id}/reply", "reaches"],
  scan_listings: ["POST /v1/listings/scan", "spends"],
  send_gbp_report_test: ["POST /v1/google-business/reports/test", "reaches"],
  set_ad_insights_cards: ["PUT /v1/ad-insights/cards", "safe"],
  set_ai_visibility_questions: ["PUT /v1/ai-visibility/questions", "safe"],
  set_gbp_report_settings: ["PUT /v1/google-business/reports/settings", "changes_sending"],
  setup_ai_visibility: ["POST /v1/ai-visibility/setup", "spends"],
  start_ai_visibility_check: ["POST /v1/ai-visibility/check", "spends"],
  start_listings: ["POST /v1/listings/start", "spends"],
  start_rank_scan: ["POST /v1/map-rankings/keywords/{keyword_id}/scan", "spends"],
  turn_off_gbp_connect_link: ["DELETE /v1/google-business/connect-link", "safe"],
  undo_gbp_optimizer_change: ["POST /v1/google-business/optimizer/changes/{change_id}/undo", "reaches"],
  unschedule_gbp_post: ["POST /v1/google-business/posts/{post_id}/unschedule", "safe"],
  update_ai_visibility_settings: ["PUT /v1/ai-visibility/settings", "spends"],
  update_gbp_embed: ["PATCH /v1/google-business/embeds/{embed_id}", "changes_sending"],
  update_gbp_post: ["PATCH /v1/google-business/posts/{post_id}", "changes_sending"],
  update_gbp_profile_settings: ["PATCH /v1/google-business/profiles/{profile_id}", "safe"],
  update_gbp_review: ["PATCH /v1/google-business/reviews/{review_id}", "safe"],
  update_rank_keyword: ["PATCH /v1/map-rankings/keywords/{keyword_id}", "spends"],
  write_ai_visibility_questions: ["POST /v1/ai-visibility/ideas", "spends"],
  write_gbp_embed_faq: ["POST /v1/google-business/embeds/{embed_id}/faq", "spends"],
  write_gbp_posts: ["POST /v1/google-business/posts/write", "spends"],
  // Bookings
  cancel_booking: ["POST /v1/bookings/{booking_id}/cancel", "reaches"],
  create_booking: ["POST /v1/bookings", "reaches"],
  reschedule_booking: ["POST /v1/bookings/{booking_id}/reschedule", "reaches"],
  set_appointment_emails: ["PUT /v1/appointment-emails", "changes_sending"],
  update_booking: ["PATCH /v1/bookings/{booking_id}", "safe"],
  // CRM automations
  create_automation: ["POST /v1/workspace-automations", "changes_sending"],
  create_automation_folder: ["POST /v1/workspace-automations/folders", "safe"],
  delete_automation: ["DELETE /v1/workspace-automations/{automation_id}", "safe"],
  delete_automation_folder: ["DELETE /v1/workspace-automations/folders/{folder_id}", "safe"],
  duplicate_automation: ["POST /v1/workspace-automations/{automation_id}/duplicate", "changes_sending"],
  enroll_automation: ["POST /v1/workspace-automations/{automation_id}/enroll", "reaches"],
  move_automations: ["POST /v1/workspace-automations/move", "safe"],
  rename_automation_folder: ["PATCH /v1/workspace-automations/folders/{folder_id}", "safe"],
  toggle_ws_automation: ["POST /v1/workspace-automations/{automation_id}/toggle", "reaches"],
  unenroll_automation: ["POST /v1/workspace-automations/{automation_id}/unenroll", "safe"],
  update_automation: ["PATCH /v1/workspace-automations/{automation_id}", "changes_sending"],
  // CRM leads
  /* Stage and tag changes (set_lead_stage, update_lead, merge_tags, update_tag, and
     create_deal / update_deal / update_pipeline_stage below) stay "safe" ON PURPOSE:
     moving a lead is the CRM's core action, and any automation that fires on a stage
     or tag is one the owner built to fire on exactly that move. Asking for a confirm
     on every drag would train people to click through confirms. Reviewed in round 3
     (R3-B4); do not re-raise without a new fact. */
  create_lead: ["POST /v1/leads", "safe"],
  create_lead_note: ["POST /v1/leads/{lead_id}/notes", "safe"],
  delete_lead: ["DELETE /v1/leads/{lead_id}", "safe"],
  delete_note: ["DELETE /v1/notes/{note_id}", "safe"],
  delete_tag: ["DELETE /v1/tags/{tag_id}", "safe"],
  merge_tags: ["POST /v1/tags/merge", "safe"],
  set_do_not_contact: ["POST /v1/leads/{lead_id}/do-not-contact", "safe"],
  set_lead_stage: ["POST /v1/leads/{lead_id}/stage", "safe"],
  update_lead: ["PATCH /v1/leads/{lead_id}", "safe"],
  update_note: ["PATCH /v1/notes/{note_id}", "safe"],
  update_tag: ["PATCH /v1/tags/{tag_id}", "safe"],
  // Calendars & hours
  copy_calendar_design: ["POST /v1/calendars/{calendar_id}/copy-design", "safe"],
  create_booking_menu: ["POST /v1/booking-menus", "changes_sending"],
  create_calendar: ["POST /v1/calendars", "changes_sending"],
  create_calendar_route: ["POST /v1/calendar-routes", "safe"],
  delete_booking_menu: ["DELETE /v1/booking-menus/{menu_id}", "safe"],
  delete_calendar_route: ["DELETE /v1/calendar-routes/{route_id}", "safe"],
  generate_calendar_design: ["POST /v1/calendars/{calendar_id}/design/generate", "spends"],
  generate_menu_design: ["POST /v1/booking-menus/{menu_id}/design/generate", "spends"],
  reorder_calendar_routes: ["POST /v1/calendar-routes/reorder", "safe"],
  set_availability: ["PUT /v1/availability", "changes_sending"],
  share_menu_schedule: ["POST /v1/booking-menus/{menu_id}/share-schedule", "safe"],
  update_booking_menu: ["PATCH /v1/booking-menus/{menu_id}", "safe"],
  update_calendar: ["PATCH /v1/calendars/{calendar_id}", "changes_sending"],
  update_calendar_route: ["PATCH /v1/calendar-routes/{route_id}", "safe"],
  // Calls
  pause_call_campaign: ["POST /v1/call-campaigns/{campaign_id}/pause", "safe"],
  // Contracts
  create_contract: ["POST /v1/contracts", "safe"],
  get_contract_link: ["POST /v1/contracts/{contract_id}/link", "safe"],
  send_contract: ["POST /v1/contracts/{contract_id}/send", "reaches"],
  void_contract: ["POST /v1/contracts/{contract_id}/void", "safe"],
  // Email marketing
  cancel_email_campaign: ["POST /v1/email-campaigns/{campaign_id}/cancel", "safe"],
  create_email_campaign: ["POST /v1/email-campaigns", "safe"],
  delete_email_campaign: ["DELETE /v1/email-campaigns/{campaign_id}", "safe"],
  duplicate_email_campaign: ["POST /v1/email-campaigns/{campaign_id}/duplicate", "safe"],
  send_email_campaign: ["POST /v1/email-campaigns/{campaign_id}/send", "reaches"],
  send_email_campaign_rest: ["POST /v1/email-campaigns/{campaign_id}/send-rest", "reaches"],
  update_email_campaign: ["PATCH /v1/email-campaigns/{campaign_id}", "safe"],
  // Inbox
  approve_reply_suggestion: ["POST /v1/reply-suggestions/{suggestion_id}/approve", "reaches"],
  archive_conversation: ["POST /v1/conversations/{lead_id}/archive", "safe"],
  dismiss_reply_suggestion: ["POST /v1/reply-suggestions/{suggestion_id}/dismiss", "safe"],
  // R3-B3: Zuops documents it as "Nothing is sent or saved ... Free"; the Inbox calls it without a confirm.
  lead_reply_ideas: ["POST /v1/leads/{lead_id}/reply-ideas", "safe"],
  mark_conversation_read: ["POST /v1/conversations/{lead_id}/read", "safe"],
  mark_conversation_unread: ["POST /v1/conversations/{lead_id}/unread", "safe"],
  set_lead_ai_pause: ["POST /v1/leads/{lead_id}/ai-pause", "changes_sending"],
  unarchive_conversation: ["POST /v1/conversations/{lead_id}/unarchive", "safe"],
  // Invoices & reviews
  convert_estimate: ["POST /v1/estimates/{estimate_id}/convert", "safe"],
  create_estimate: ["POST /v1/estimates", "safe"],
  create_estimate_template: ["POST /v1/estimate-templates", "safe"],
  create_review_link: ["POST /v1/leads/{lead_id}/review-link", "safe"],
  delete_estimate: ["DELETE /v1/estimates/{estimate_id}", "safe"],
  delete_estimate_template: ["DELETE /v1/estimate-templates/{template_id}", "safe"],
  send_estimate: ["POST /v1/estimates/{estimate_id}/send", "reaches"],
  set_stripe_payment_tracking: ["PATCH /v1/stripe/payment-tracking", "safe"],
  update_estimate: ["PATCH /v1/estimates/{estimate_id}", "safe"],
  update_estimate_template: ["PATCH /v1/estimate-templates/{template_id}", "safe"],
  update_review_funnel: ["PATCH /v1/review-funnels/{funnel_id}", "changes_sending"],
  // Lead sources & webhooks
  create_lead_source: ["POST /v1/lead-sources", "safe"],
  create_outbound_webhook: ["POST /v1/outbound-webhooks", "exposes"],
  delete_lead_source: ["DELETE /v1/lead-sources/{lead_source_id}", "safe"],
  delete_outbound_webhook: ["DELETE /v1/outbound-webhooks/{webhook_id}", "safe"],
  update_lead_source: ["PATCH /v1/lead-sources/{lead_source_id}", "safe"],
  update_outbound_webhook: ["PATCH /v1/outbound-webhooks/{webhook_id}", "exposes"],
  // Media
  add_media: ["POST /v1/media", "safe"],
  create_media_folder: ["POST /v1/media/folders", "safe"],
  delete_media_folder: ["DELETE /v1/media/folders/{folder_id}", "safe"],
  update_media: ["PATCH /v1/media/{media_id}", "safe"],
  update_media_folder: ["PATCH /v1/media/folders/{folder_id}", "safe"],
  // Members
  invite_member: ["POST /v1/members", "exposes"],
  remove_member: ["DELETE /v1/members/{member_id}", "safe"],
  update_member_role: ["PATCH /v1/members/{member_id}", "exposes"],
  // Messaging
  move_dm_leads: ["POST /v1/social/move-dm-leads", "safe"],
  react_to_message: ["POST /v1/messages/{message_id}/reaction", "reaches"],
  send_message: ["POST /v1/messages", "reaches"],
  send_scheduled_message_now: ["POST /v1/scheduled-messages/{scheduled_message_id}/send-now", "reaches"],
  set_automated_texts_from: ["PUT /v1/imessage/automated-texts", "changes_sending"],
  update_imessage_line: ["PATCH /v1/imessage/lines/{line_id}", "changes_sending"],
  update_scheduled_message: ["PATCH /v1/scheduled-messages/{scheduled_message_id}", "changes_sending"],
  update_social_settings: ["PATCH /v1/social/settings", "changes_sending"],
  // Offers
  create_offer: ["POST /v1/offers", "changes_sending"],
  delete_offer: ["DELETE /v1/offers/{offer_id}", "safe"],
  update_offer: ["PATCH /v1/offers/{offer_id}", "changes_sending"],
  // Pipeline & fields
  archive_custom_field: ["DELETE /v1/custom-fields/{field_id}", "safe"],
  create_custom_field: ["POST /v1/custom-fields", "safe"],
  create_deal: ["POST /v1/deals", "safe"],
  create_pipeline: ["POST /v1/pipelines", "safe"],
  create_pipeline_stage: ["POST /v1/pipelines/{pipeline_id}/stages", "safe"],
  create_stage: ["POST /v1/stages", "safe"],
  delete_deal: ["DELETE /v1/deals/{deal_id}", "safe"],
  delete_pipeline: ["DELETE /v1/pipelines/{pipeline_id}", "safe"],
  delete_pipeline_stage: ["DELETE /v1/pipeline-stages/{stage_id}", "safe"],
  delete_stage: ["DELETE /v1/stages/{stage_id}", "safe"],
  reorder_stages: ["POST /v1/stages/reorder", "safe"],
  update_custom_field: ["PATCH /v1/custom-fields/{field_id}", "safe"],
  update_deal: ["PATCH /v1/deals/{deal_id}", "safe"],
  update_pipeline: ["PATCH /v1/pipelines/{pipeline_id}", "safe"],
  update_pipeline_stage: ["PATCH /v1/pipeline-stages/{stage_id}", "safe"],
  update_stage: ["PATCH /v1/stages/{stage_id}", "safe"],
  // Proposals
  create_proposal: ["POST /v1/proposals", "safe"],
  duplicate_proposal: ["POST /v1/proposals/{proposal_id}/duplicate", "spends"],
  edit_proposal: ["POST /v1/proposals/{proposal_id}/edit", "spends"],
  get_proposal_link: ["POST /v1/proposals/{proposal_id}/link", "safe"],
  send_proposal: ["POST /v1/proposals/{proposal_id}/send", "reaches"],
  update_proposal: ["PATCH /v1/proposals/{proposal_id}", "safe"],
  // Reports
  create_report: ["POST /v1/reports", "changes_sending"],
  delete_report: ["DELETE /v1/reports/{report_id}", "safe"],
  delete_report_alert: ["DELETE /v1/reports/{report_id}/alerts/{alert_id}", "safe"],
  delete_report_schedule: ["DELETE /v1/reports/{report_id}/schedules/{schedule_id}", "safe"],
  save_report_alert: ["POST /v1/reports/{report_id}/alerts", "changes_sending"],
  save_report_schedule: ["POST /v1/reports/{report_id}/schedules", "changes_sending"],
  send_report: ["POST /v1/reports/{report_id}/send", "reaches"],
  share_report: ["PUT /v1/reports/{report_id}/share", "exposes"],
  update_report: ["PATCH /v1/reports/{report_id}", "safe"],
  // Reward games
  create_reward_game: ["POST /v1/reward-games", "safe"],
  delete_reward_game: ["DELETE /v1/reward-games/{game_id}", "safe"],
  redeem_reward_game_play: ["POST /v1/reward-games/plays/{play_id}/redeem", "reaches"],
  reward_game_audience: ["POST /v1/reward-games/{game_id}/audience", "safe"],
  send_reward_game: ["POST /v1/reward-games/{game_id}/send", "reaches"],
  try_reward_game: ["POST /v1/reward-games/{game_id}/try", "spends"],
  update_reward_game: ["PATCH /v1/reward-games/{game_id}", "safe"],
  // Routing & alerts
  create_alert_recipient: ["POST /v1/alert-recipients", "exposes"],
  delete_alert_recipient: ["DELETE /v1/alert-recipients/{recipient_id}", "safe"],
  set_lead_routing: ["PUT /v1/lead-routing", "safe"],
  update_alert_recipient: ["PATCH /v1/alert-recipients/{recipient_id}", "exposes"],
  // Setup
  set_business_profile: ["PATCH /v1/business-profile", "safe"],
  // Short links
  add_short_link_domain: ["POST /v1/short-links/domains", "safe"],
  bulk_create_short_links: ["POST /v1/short-links/bulk", "safe"],
  check_short_links: ["POST /v1/short-links/check", "safe"],
  create_short_link: ["POST /v1/short-links", "safe"],
  delete_short_link: ["DELETE /v1/short-links/{link_id}", "safe"],
  delete_short_link_domain: ["DELETE /v1/short-links/domains/{domain_id}", "safe"],
  update_short_link: ["PATCH /v1/short-links/{link_id}", "safe"],
  verify_short_link_domain: ["POST /v1/short-links/domains/{domain_id}/verify", "safe"],
  // Smart forms
  create_smart_form: ["POST /v1/smart-forms", "safe"],
  create_survey: ["POST /v1/surveys", "safe"],
  create_survey_link: ["POST /v1/surveys/{form_id}/links", "safe"],
  send_survey: ["POST /v1/surveys/{form_id}/send", "reaches"],
  update_smart_form: ["PATCH /v1/smart-forms/{form_id}", "safe"],
  update_survey_rules: ["PATCH /v1/surveys/{form_id}/rules", "changes_sending"],
  // Support
  add_support_message: ["POST /v1/support/tickets/{ticket_id}/messages", "reaches"],
  add_support_note: ["POST /v1/support/tickets/{ticket_id}/notes", "safe"],
  create_support_ticket: ["POST /v1/support/tickets", "reaches"],
  reply_support_ticket: ["POST /v1/support/tickets/{ticket_id}/reply", "reaches"],
  update_support_ticket: ["PATCH /v1/support/tickets/{ticket_id}", "safe"],
  // Team busy times
  delete_busy_block: ["DELETE /v1/busy-blocks/{external_id}", "safe"],
  put_busy_block: ["PUT /v1/busy-blocks/{external_id}", "safe"],
  sync_busy_blocks: ["POST /v1/busy-blocks/sync", "safe"],
  // Website Analytics
  ask_website_analytics: ["POST /v1/website-analytics/ask", "spends"],
  // Website widget
  update_website_widget: ["PATCH /v1/website-widgets/{widget_id}", "changes_sending"],
  // Workspaces
  configure_outreach: ["POST /v1/workspaces/{workspace_id}/outreach", "changes_sending"],
  update_workspace: ["PATCH /v1/workspaces/{workspace_id}", "safe"],
};

/** A body value that turns something on: anything other than absent, null or false. */
const on = (v: unknown) => v !== undefined && v !== null && v !== false;

/** A pause `until` that keeps the AI paused: absent, or a parseable time in the future. */
const pauseUntilOk = (until: unknown) =>
  until === undefined || until === null || (typeof until === "string" && Date.parse(until) > Date.now());

/** Kinds that depend on the (already filtered) body. Escalation reads `on(...)`;
 *  a step down needs an exact value, so an odd value fails closed. */
export const BODY_RULES: Readonly<Record<string, (b: Record<string, unknown>) => SendKind>> = {
  create_lead: (b) => (on(b.run_intake) ? "reaches" : "safe"),
  create_gbp_post: (b) => (on(b.approve) ? "reaches" : "safe"),
  update_scheduled_message: (b) => (Object.keys(b).length === 1 && b.status === "cancelled" ? "safe" : "changes_sending"),
  // Pausing is safe; resuming (paused false, or an `until` that is not in the future) restarts the AI.
  set_lead_ai_pause: (b) => (b.paused === true && pauseUntilOk(b.until) ? "safe" : "changes_sending"),
  // R3-B4: notify_lead defaults to true (confirmation email and reminder texts).
  create_booking: (b) => (b.notify_lead === false ? "safe" : "reaches"),
  // Linking a lead (lead_id) starts its reminders.
  update_booking: (b) => (on(b.notify_lead) || b.status === "confirmed" || on(b.lead_id) ? "changes_sending" : "safe"),
  // `enabled` states the target; omitted, Zuops flips the current state (a blind toggle).
  toggle_ws_automation: (b) => (b.enabled === false ? "safe" : "reaches"),
  set_stripe_payment_tracking: (b) => (on(b.meta_event) ? "exposes" : "safe"),
  update_support_ticket: (b) => (b.handler === "assistant" ? "changes_sending" : "safe"),
  create_smart_form: (b) => (on(b.is_published) ? "changes_sending" : "safe"),
  // is_active defaults to true on create (a live menu), so only an explicit false is safe.
  create_booking_menu: (b) => (b.is_active === false ? "safe" : "changes_sending"),
  update_booking_menu: (b) => (on(b.is_active) ? "changes_sending" : "safe"),
  // A new url re-points links already sent to people.
  update_short_link: (b) => (b.url !== undefined ? "changes_sending" : "safe"),
  move_dm_leads: (b) => (on(b.apply) ? "changes_sending" : "safe"),
  apply_gbp_optimizer: (b) => (b.dry_run === true ? "safe" : "spends"),
  create_email_campaign: (b) => (on(b.brief) || on(b.pictures) ? "spends" : "safe"),
  update_email_campaign: (b) => (on(b.brief) || on(b.pictures) ? "spends" : "safe"),
  // R3-B1: with template_id, the AI rewrite runs unless rewrite is exactly false.
  create_proposal: (b) => (on(b.build) || (on(b.template_id) && b.rewrite !== false) ? "spends" : "safe"),
  update_report: (b) => (on(b.prompt) ? "changes_sending" : "safe"),
  update_reward_game: (b) => (b.status !== undefined && b.status !== null ? "changes_sending" : "safe"),
  update_smart_form: (b) => (on(b.is_published) ? "changes_sending" : "safe"),
};

const BY_ROUTE = new Map(Object.values(ZU_OPS).map((op) => [`${op.method} ${op.path}`, op.id]));

/** The operation id of a (method, path) pair, or undefined when Zuops has no such route. */
export function opIdFor(method: string, path: string): string | undefined {
  return BY_ROUTE.get(`${method} ${path}`);
}

const idsOf = (kind: SendKind): ReadonlySet<string> =>
  new Set(Object.entries(CLASSIFIED).filter(([, [, k]]) => k === kind).map(([id]) => id));

/** Kept for callers of the earlier lists: derived from CLASSIFIED (empty-body kinds). */
export const REACHES: ReadonlySet<string> = idsOf("reaches");
export const CHANGES_SENDING: ReadonlySet<string> = idsOf("changes_sending");

export type Level = "read" | "write" | "admin";

export function level(op: ZuOp): Level {
  if (op.method === "GET") return "read";
  if (op.scope.endsWith(":admin")) return "admin";
  return "write";
}

const asBody = (body: unknown): Record<string, unknown> =>
  body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

/** The kind of this operation with this body, before the DELETE rule. Unclassified writes fail closed. */
export function sendKind(op: ZuOp, body?: unknown): SendKind {
  if (op.method === "GET") return "safe";
  const own = Object.prototype.hasOwnProperty.call(CLASSIFIED, op.id) ? CLASSIFIED[op.id] : undefined;
  if (!own || own[0] !== `${op.method} ${op.path}`) return "reaches";
  const rule = Object.prototype.hasOwnProperty.call(BODY_RULES, op.id) ? BODY_RULES[op.id] : undefined;
  return rule ? rule(asBody(body)) : own[1];
}

/** Why an operation needs a confirm, for the UI to word its dialog; null when it does not.
 *  Pass the body when there is one: some kinds depend on it (BODY_RULES). */
export function confirmKind(op: ZuOp, body?: unknown): ConfirmKind | null {
  if (op.method === "GET") return null;
  const kind = sendKind(op, body);
  if (kind !== "safe") return kind;
  return op.method === "DELETE" ? "delete" : null;
}

export function needsConfirm(op: ZuOp): boolean {
  return confirmKind(op) !== null;
}

export function needsConfirmFor(op: ZuOp, body?: unknown): boolean {
  return confirmKind(op, body) !== null;
}

export const CONFIRM_REASONS = {
  reaches: "Confirm before this runs: it reaches real people.",
  changes_sending: "Confirm before this runs: it changes what is sent automatically to real people.",
  spends: "Confirm before this runs: it uses credits or starts paid work.",
  exposes: "Confirm before this runs: it sends lead data outside the account or changes who can access it.",
  delete: "Confirm before this runs: it deletes something.",
  starts_intake: "Confirm before this runs: it starts the new-lead texts for this person.",
} as const;

/** The confirm reason for this operation with this body, or null when none is needed. */
export function confirmReason(op: ZuOp, body?: unknown): string | null {
  const kind = confirmKind(op, body);
  if (!kind) return null;
  if (op.id === "create_lead" && kind === "reaches") return CONFIRM_REASONS.starts_intake;
  return CONFIRM_REASONS[kind];
}

export type GateResult = { ok: true } | { ok: false; code: "read_only" | "needs_admin_key" | "needs_confirm"; reason: string };

export const GATE_REASONS = {
  read_only: "This deployment is read only against Zuops.",
  needs_admin_key: "Needs a Full access key.",
} as const;

export function gate(op: ZuOp, flags: { writesOn: boolean; adminKey: boolean }, confirm: boolean, body?: unknown): GateResult {
  const lv = level(op);
  if (lv === "read") return { ok: true };
  if (!flags.writesOn) return { ok: false, code: "read_only", reason: GATE_REASONS.read_only };
  if (lv === "admin" && !flags.adminKey) return { ok: false, code: "needs_admin_key", reason: GATE_REASONS.needs_admin_key };
  const why = confirmReason(op, body);
  if (why && confirm !== true) return { ok: false, code: "needs_confirm", reason: why };
  return { ok: true };
}

const PATH_VALUE = /^[A-Za-z0-9_.:@-]{1,128}$/;
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function buildPath(op: ZuOp, values: Record<string, string> | undefined): { ok: true; path: string } | { ok: false; reason: string } {
  const vals = values ?? {};
  for (const k of Object.keys(vals)) {
    if (!op.pathParams.includes(k)) return { ok: false, reason: `"${k}" is not part of this address.` };
  }
  let path = op.path;
  for (const name of op.pathParams) {
    const v = own(vals, name) ? vals[name] : undefined;
    if (typeof v !== "string" || v === "") return { ok: false, reason: `Missing "${name}".` };
    if (!PATH_VALUE.test(v) || v === "." || v === "..") return { ok: false, reason: `"${name}" has characters that are not allowed.` };
    path = path.replace(`{${name}}`, encodeURIComponent(v));
  }
  return { ok: true, path };
}

export const BODY_MAX_BYTES = 64 * 1024;

const isPlainObject = (x: unknown): x is Record<string, unknown> => {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
};

const OPEN_KEY = /^[A-Za-z0-9_]{1,64}$/;

/* F-B12, R3-B5: secrets never travel back to the browser. Keys are compared in
   snake_case, so camelCase names (apiKey, accessToken, signingSecret) match too. */
const SECRET_KEY =
  /(^|_)(secret|token|password|api_key|key_prefix|signing_secret|webhook_secret|auth_token|access_token|refresh_token|authorization|private_key|client_secret|client_key|secret_key|credentials|pin)$/;
const SIGNING_SECRET = /^(signing_|webhook_)?secret$/;
const KEY_SELF_SECRET = /^(key|prefix|key_prefix)$/;
const URL_SECRET_PARAM = /([?&](?:token|key|secret|sig|signature|access_token)=)[^&#]*/gi;

const snake = (k: string) => k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

/** A string or number value, hidden; anything else (objects, arrays, booleans, null) is left to the walk. */
const hideLeaf = (v: unknown) => (typeof v === "string" || typeof v === "number" ? "hidden" : v);

/** A copy of a Zuops answer with secret VALUES replaced by "hidden", at any depth.
 *  An object or array is never replaced wholesale: under a secret-looking key the
 *  walk goes on and hides every string and number inside it. key_self keeps its
 *  `key` object (name, access_level, scopes, limits) and hides only `key`, `prefix`
 *  and `key_prefix` strings. URL strings lose the values of token, key, secret,
 *  sig, signature and access_token query parameters. The one exemption is the
 *  signing secret in the answer of create_outbound_webhook: Zuops shows it once,
 *  and the UI must show it to the owner then. */
export function redactSecrets(opId: string, data: unknown): unknown {
  const keySelf = opId === "key_self";
  const keepSigning = opId === "create_outbound_webhook";
  const walk = (x: unknown, secret: boolean): unknown => {
    if (Array.isArray(x)) return x.map((v) => walk(v, secret));
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
        const name = snake(k);
        const isSecret =
          secret || (SECRET_KEY.test(name) && !(keepSigning && SIGNING_SECRET.test(name))) || (keySelf && KEY_SELF_SECRET.test(name) && typeof v === "string");
        out[k] = v && typeof v === "object" ? walk(v, isSecret) : isSecret ? hideLeaf(v) : walk(v, false);
      }
      return out;
    }
    if (secret) return hideLeaf(x);
    if (typeof x === "string" && /^https?:\/\//i.test(x)) return x.replace(URL_SECRET_PARAM, "$1hidden");
    return x;
  };
  return walk(data, false);
}

/** A copy without any `workspace_id` key at any depth. */
function withoutWorkspace(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(withoutWorkspace);
  if (x && typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (k !== "workspace_id") out[k] = withoutWorkspace(v);
    return out;
  }
  return x;
}

/** Keep only fields the registry knows for this operation.
 *
 *  Missing `required` fields are NOT refused here on purpose: Zuops answers 400
 *  with a sentence that names the field and the rule (for example "subject is
 *  required for email"), which is a better reason than a generic one from Pulse,
 *  and our copy of the rules could drift from theirs. Unknown keys ARE refused,
 *  so nothing outside the documented surface is ever sent.
 *
 *  `open` is for a body the spec does not list but Zuops documents in prose
 *  (`openBody` in the registry: field-less PATCH and PUT, and every DELETE). Any
 *  plain-object keys of a simple shape are accepted and the 64 KB cap still
 *  applies. Queries are always strict. In every body `workspace_id` is removed at
 *  every depth. */
export function pickFields(
  fields: ZuField[],
  input: unknown,
  kind: "query" | "body",
  open = false,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (!isPlainObject(input)) return { ok: false, reason: kind === "query" ? "The filters must be a set of named values." : "The request body must be a set of named fields." };
  const isOpen = open && kind === "body";
  const known = new Set(fields.map((f) => f.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "workspace_id") continue; // the key is locked to one sub-account; never sent
    if (isOpen) {
      if (!OPEN_KEY.test(k)) return { ok: false, reason: `"${k.slice(0, 64)}" is not a field name Zuops uses.` };
    } else if (!known.has(k)) {
      return { ok: false, reason: `"${k}" is not a field this Zuops function accepts.` };
    }
    if (v === undefined) continue;
    if (kind === "query") {
      const okType = typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v));
      if (!okType) return { ok: false, reason: `"${k}" must be text, a number or true/false.` };
    }
    out[k] = withoutWorkspace(v); // F-B9: workspace_id never leaves Pulse, at any depth
  }
  if (kind === "body") {
    let size: number;
    try {
      size = new TextEncoder().encode(JSON.stringify(out)).length;
    } catch {
      return { ok: false, reason: "The request body could not be read." };
    }
    if (size > BODY_MAX_BYTES) return { ok: false, reason: "The request is too large (over 64 KB)." };
  }
  return { ok: true, value: out };
}
