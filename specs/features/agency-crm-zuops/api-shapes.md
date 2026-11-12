# Zuops response shapes (types only, captured read-only 2026-11-11)

Every response is `{ success, data, error }`; below is `data`. Values are types; quoted values are real enum-like samples (`a|b` = several seen). `null` and `[]` mean the live account had no value, not that the field is always empty. `crm.call` returns this `data` as a JSON string in `json`.

## GET /v1/overview
```json
{ "workspace_id": "uuid", "window": { "from": "iso-datetime", "to": "iso-datetime", "days": "number" }, "stats": { "won": "number", "calls": { "total": "number", "inbound": "number", "ai_calls": "number", "answered": "number", "outbound": "number", "voicemails": "number", "talk_seconds": "number", "missed_inbound": "number", "ai_receptionist_calls": "number" }, "leads": "number", "closed": "number", "contacted": "number", "ai_replies": { "sms": "number", "email": "number", "leads": "number", "total": "number", "other_channels": "number" }, "prev_leads": "number", "appointments": "number", "booked_leads": "number", "new_unworked": "number", "prev_appointments": "number", "prev_booked_leads": "number", "auto_replied_leads": "number", "human_replied_leads": "number", "calendar_booked_leads": "number", "upcoming_appointments": "number", "median_response_minutes": "number", "median_response_minutes_auto": "null", "median_response_minutes_human": "number", "stage_reach": { "total": "number", "reached": { "new": "number", "contacted": "number" } } }
}
```

## GET /v1/health-score
```json
{ "workspace_id": "uuid", "name": "string", "score": "number", "grade": "\"Needs attention\"", "is_new": "boolean", "verdict": "string", "factors": [ { "key": "\"recency\"|\"volume\"|\"speed\"|\"coverage\"|\"booking\"", "label": "string", "weight": "number", "earned": "number", "applies": "boolean", "value": "string", "detail": "string", "hint": "string", "gain": "number" } ], "not_measured": "[]", "applied_weight": "number", "actions": [ { "key": "\"waiting\"|\"follow_ups\"|\"volume\"|\"coverage\"", "title": "string", "why": "string", "gain": "number", "path": "string", "cta": "string", "urgent": "boolean" } ], "inputs": { "last_activity_at": "iso-datetime", "leads_7d": "number", "bookings_7d": "number", "leads_30d": "number", "booked_30d": "number", "median_response_seconds": "number", "reply_base_30d": "number", "replied_30d": "number" }, "waiting": { "count": "number", "longest_since": "iso-datetime" }, "history": [ { "as_of": "iso-datetime", "score": "number", "grade": "\"Dormant\"|\"Needs attention\"|\"At risk\"" } ], "last_30_days": { "funnel": { "won": "number", "lost": "number", "leads": "number", "booked": "number", "showed": "number", "no_show": "number", "replied": "number", "still_new": "number" }, "speed": { "later": "number", "just_in": "number", "no_reply": "number", "within_1d": "number", "within_1h": "number", "within_1m": "number", "within_5m": "number", "auto_first": "number", "before_lead": "number", "human_first": "number", "no_logged_reply": "number", "median_auto_seconds": "null", "median_human_seconds": "number" }, "sources": [ { "leads": "number", "booked": "number", "channel": "\"webhook\"" } ], "upcoming_appointments": "number" }, "setup": { "webhooks": "number", "ai_texter": "boolean", "calendars": "number", "first_text": "boolean", "follow_ups": "boolean", "meta_pages": "number", "automations": "number", "smart_forms": "number", "phone_numbers": "number" }
}
```

## GET /v1/usage
```json
{ "workspace_id": "uuid", "window": { "from": "iso-datetime", "to": "iso-datetime", "days": "number" }, "total_credits": "number", "total_events": "number", "unpaid_events": "number", "by_tool": [ { "tool": "string", "label": "string", "events": "number", "credits": "number", "unpaid": "number" } ], "by_day": [ { "date": "string", "events": "number", "credits": "number" } ]
}
```

## GET /v1/messages/limits
```json
{ "limits": { "daily_unique_contact_cap": "number", "unique_contacts_used": "number", "unique_contacts_remaining": "number", "segments_used": "number", "segment_safety_cap": "number", "messages_sent_today": "number", "frozen": "boolean", "frozen_reason": "null", "resets_at": "iso-datetime" }
}
```

## GET /v1/leads
```json
{ "leads": [ { "id": "uuid", "workspace_id": "uuid", "full_name": "string", "email": "string", "phone": "string", "source": "\"instagram\"|\"api\"|\"other\"", "status": "\"partial\"|\"contacted\"|\"new\"", "stage_key": "null", "score": "null", "assigned_to": "null", "ad_name": "null", "campaign_name": "null", "meta_ad_id": "null", "meta_campaign_id": "null", "deal_value_cents": "null", "deal_currency": "string", "deal_parts_cents": "null", "deal_tip_cents": "null", "deal_sold_by": "null", "deal_won_at": "null", "deal_type": "null", "deal_plan_cents": "null", "deal_plan_interval": "null", "deal_plan_start_date": "null", "deal_plan_months": "null", "existing_customer": "boolean", "created_at": "iso-datetime", "updated_at": "iso-datetime", "last_activity_at": "iso-datetime", "deal_monthly_cents": "null", "deal_expected_total_cents": "null", "stage": "string", "chat_only": "boolean", "inquiry": "string", "address": "null", "city": "null", "state": "null", "zip": "null", "custom_fields": {}, "tags": [ "string" ] } ], "has_more": "boolean", "next_offset": "null"
}
```

## GET /v1/leads/{lead_id}
```json
{ "lead": { "id": "uuid", "workspace_id": "uuid", "source": "\"instagram\"", "status": "\"partial\"", "full_name": "string", "email": "null", "phone": "null", "meta_leadgen_id": "null", "meta_form_id": "null", "meta_page_id": "null", "meta_ad_id": "null", "meta_adset_id": "null", "meta_campaign_id": "null", "ad_name": "null", "campaign_name": "null", "raw_payload": { "social": { "origin": "string", "platform": "string", "username": "string", "account_id": "string", "channel_id": "uuid", "profile_pic_url": "string", "external_user_id": "string" } }, "score": "null", "assigned_to": "null", "notes": "null", "last_inbound_at": "iso-datetime", "last_outbound_at": "iso-datetime", "last_activity_at": "iso-datetime", "unread": "boolean", "created_at": "iso-datetime", "updated_at": "iso-datetime", "ai_reply_count": "number", "ai_paused": "boolean", "score_reasons": "null", "scored_at": "null", "ai_paused_until": "null", "assigned_phone_number_id": "null", "inbox_archived": "boolean", "unread_count": "number", "utm_source": "null", "utm_medium": "null", "utm_campaign": "null", "utm_term": "null", "utm_content": "null", "fbclid": "null", "gclid": "null", "ttclid": "null", "msclkid": "null", "landing_url": "null", "referrer_url": "null", "attribution_channel": "string", "phone_invalid": "boolean", "phone_invalid_reason": "null", "phone_invalid_at": "null", "lead_notified_at": "iso-datetime", "offer_playbook_id": "null", "stage_key": "null", "nurture_paused": "boolean", "phone_line_type": "null", "phone_carrier": "null", "phone_checked_at": "null", "ai_calling_paused": "boolean", "meta_qualified_event_sent": "boolean", "meta_qualified_event_sent_at": "null", "meta_qualified_event_error": "null", "deal_value_cents": "null", "deal_currency": "string", "deal_won_at": "null", "ai_pause_reason": "null", "ai_pause_question": "null", "email_opt_out": "boolean", "email_opt_out_at": "null", "email_opt_out_reason": "null", "email_invalid": "boolean", "email_invalid_at": "null", "email_invalid_reason": "null", "email_paused": "boolean", "email_sender_id": "null", "fsm_provider": "null", "fsm_external_id": "null", "fsm_external_status": "null", "fsm_synced_at": "null", "ai_calling_pause_reason": "null", "gbraid": "null", "wbraid": "null", "imessage_line_id": "null", "deal_parts_cents": "null", "deal_tip_cents": "null", "deal_sold_by": "null", "deal_type": "null", "deal_plan_cents": "null", "deal_plan_interval": "null", "deal_plan_start_date": "null", "deal_plan_months": "null", "existing_customer": "boolean", "deal_monthly_cents": "null", "deal_expected_total_cents": "null", "stage": "string", "chat_only": "boolean", "inquiry": "string", "address": "null", "city": "null", "state": "null", "zip": "null", "custom_fields": {}, "tags": "[]" }, "events": [ { "id": "uuid", "lead_id": "uuid", "workspace_id": "uuid", "event_type": "\"instagram_inbound\"|\"instagram_outbound\"|\"created\"", "actor_user_id": "null", "actor_label": "string", "body": "string", "metadata": { "mid": "string", "platform": "string", "channel_id": "uuid", "attachments": [ { "url": "string", "type": "\"ig_post\"" } ], "external_user_id": "string" }, "created_at": "iso-datetime" } ]
}
```

## GET /v1/leads/{lead_id}/timeline
```json
{ "lead_id": "uuid", "events": [ { "id": "uuid", "event_type": "\"instagram_inbound\"|\"instagram_outbound\"|\"created\"", "actor_label": "string", "body": "string", "metadata": { "mid": "string", "platform": "string", "channel_id": "uuid", "attachments": [ { "url": "string", "type": "\"ig_post\"" } ], "external_user_id": "string" }, "created_at": "iso-datetime" } ]
}
```

## GET /v1/stages
```json
{ "stages": [ { "id": "uuid", "key": "\"new\"|\"contacted\"|\"booked\"|\"won\"|\"lost\"", "label": "string", "color": "\"blue\"|\"amber\"|\"cyan\"|\"emerald\"|\"rose\"", "behavior": "\"new\"|\"contacted\"|\"booked\"|\"won\"|\"lost\"", "position": "number", "is_system": "boolean", "hidden": "boolean" } ]
}
```

## GET /v1/tags
```json
{ "tags": [ { "id": "uuid", "name": "string", "color": "\"slate\"", "lead_count": "number", "created_at": "iso-datetime" } ]
}
```

## GET /v1/custom-fields
```json
{ "custom_fields": [ { "id": "uuid", "workspace_id": "uuid", "field_key": "string", "label": "string", "field_type": "\"text\"|\"boolean\"", "options": "null", "required": "boolean", "sort_order": "number", "helper_text": "string", "placeholder": "null", "default_value": "null", "validation": {}, "show_in_list": "boolean", "group_name": "null", "archived_at": "null" } ]
}
```

## GET /v1/conversations
```json
{ "conversations": [ { "lead_id": "uuid", "workspace_id": "uuid", "name": "string", "phone": "string", "email": "string", "status": "\"partial\"|\"contacted\"", "stage_key": "null", "assigned_to": "null", "unread": "boolean", "unread_count": "number", "archived": "boolean", "ai": { "paused": "boolean", "paused_until": "null", "pause_reason": "null", "handoff_question": "null" }, "channel": "\"instagram\"|\"sms\"", "last_message": { "id": "uuid", "channel": "\"instagram\"", "direction": "\"inbound\"", "body": "string", "subject": "null", "sent_by": "string", "created_at": "iso-datetime" }, "last_inbound_at": "iso-datetime", "last_outbound_at": "iso-datetime", "last_activity_at": "iso-datetime" } ], "has_more": "boolean", "next_cursor": "null", "counts": { "open": "number", "unread": "number", "archived": "number" }
}
```

## GET /v1/leads/{lead_id}/conversation
```json
{ "lead": { "id": "uuid", "workspace_id": "uuid", "full_name": "string", "email": "null", "phone": "null", "last_inbound_at": "iso-datetime", "last_outbound_at": "iso-datetime" }, "messages": [ { "id": "uuid", "event_type": "\"instagram_inbound\"|\"instagram_outbound\"", "actor_label": "string", "body": "string", "metadata": { "mid": "string", "platform": "string", "channel_id": "uuid", "attachments": [ { "url": "string", "type": "\"ig_post\"" } ], "external_user_id": "string" }, "created_at": "iso-datetime" } ]
}
```

## GET /v1/messages
```json
{ "messages": [ { "id": "uuid", "lead_id": "uuid", "workspace_id": "uuid", "channel": "\"instagram\"", "direction": "\"inbound\"|\"outbound\"", "body": "string", "subject": "null", "from": "null", "to": "null", "media_urls": [ "string" ], "provider_message_id": "string", "delivery_status": "null", "automated": "boolean", "actor_label": "string", "social": { "account_id": "uuid", "sent_by": "null" }, "created_at": "iso-datetime", "lead": { "id": "uuid", "full_name": "string", "email": "null", "phone": "null" } } ], "next_cursor": "string", "has_more": "boolean", "limits": { "daily_unique_contact_cap": "number", "unique_contacts_used": "number", "unique_contacts_remaining": "number", "segments_used": "number", "segment_safety_cap": "number", "messages_sent_today": "number", "frozen": "boolean", "frozen_reason": "null", "resets_at": "iso-datetime" }
}
```

## GET /v1/scheduled-messages
```json
{ "scheduled_messages": "[]", "has_more": "boolean", "next_cursor": "null"
}
```

## GET /v1/reply-suggestions
```json
{ "reply_mode": "string", "suggestions": "[]", "has_more": "boolean", "next_cursor": "null"
}
```

## GET /v1/calendars
```json
{ "calendars": [ { "id": "uuid", "slug": "string", "name": "string", "title": "string", "description": "string", "timezone": "string", "duration_minutes": "number", "buffer_minutes": "number", "slot_increment_minutes": "number", "min_notice_minutes": "number", "max_days_ahead": "number", "max_per_day": "null", "weekly_hours": { "fri": [ [ "string" ] ], "mon": [ [ "string" ] ], "sat": "[]", "sun": "[]", "thu": [ [ "string" ] ], "tue": [ [ "string" ] ], "wed": [ [ "string" ] ] }, "date_overrides": "[]", "assignment_mode": "\"single\"", "host_user_id": "uuid", "meeting_type": "\"custom\"", "meeting_location": "string", "location_label": "string", "scheduling_mode": "\"exact\"", "arrival_window_minutes": "number", "slots_per_window": "number", "appointment_texts": {}, "is_active": "boolean", "duration_days": "null", "schedule_group": "null", "image_url": "string", "currency": "string", "payment_gateway": "null", "payment_hold_minutes": "number", "payment_label": "null", "pricing": "null", "design": "null", "fields": { "full_name": { "enabled": "boolean", "required": "boolean" }, "first_name": { "enabled": "boolean", "required": "boolean" }, "last_name": { "enabled": "boolean", "required": "boolean" }, "email": { "enabled": "boolean", "required": "boolean" }, "phone": { "enabled": "boolean", "required": "boolean" }, "address": { "enabled": "boolean", "required": "boolean", "autocomplete": "boolean" }, "state": { "enabled": "boolean", "required": "boolean" }, "notes": { "enabled": "boolean", "required": "boolean" } }, "questions": [ { "key": "\"pulse_studio_name\"|\"pulse_role_and_locations\"|\"pulse_workflow_brief\"|\"pulse_sms_marketing_consent\"|\"pulse_email_marketing_consent\"|\"pulse_automated_call_consent\"", "label": "string", "field_type": "\"text\"", "options": "[]", "required": "boolean", "enabled": "boolean", "save_to_crm": "boolean", "placeholder": "null", "helper_text": "null", "option_style": "string" } ], "summary": { "price_from_cents": "null", "price_to_cents": "null", "length_label": "string", "has_options": "boolean", "takes_payment": "boolean" }, "booking_path": "string" } ]
}
```

## GET /v1/calendars/{calendar_id}/availability
```json
{ "calendar": { "id": "uuid", "name": "string", "timezone": "string", "duration_minutes": "number", "duration_days": "null", "booking_window_days": "number" }, "from": "iso-datetime", "to": "iso-datetime", "from_date": "string", "to_date": "string", "slots": [ "iso-datetime" ], "days": [ { "date": "string", "label": "string", "slots": [ "iso-datetime" ] } ], "quote": "null"
}
```

## GET /v1/bookings
```json
{ "bookings": [ { "id": "uuid", "workspace_id": "uuid", "lead_id": "uuid", "calendar_id": "uuid", "appointment_number": "number", "title": "string", "starts_at": "iso-datetime", "ends_at": "iso-datetime", "timezone": "string", "lead_timezone": "string", "location": "string", "notes": "string", "meeting_type": "\"custom\"", "meeting_location": "string", "meeting_url": "string", "host_user_id": "uuid", "status": "\"cancelled\"|\"no_show\"", "source": "\"api\"|\"smart_form\"", "notify_lead": "boolean", "is_arrival_window": "boolean", "service_details": "null", "created_at": "iso-datetime", "updated_at": "iso-datetime", "manage_url": "string" } ]
}
```

## GET /v1/busy-blocks
```json
{ "busy_blocks": "[]", "has_more": "boolean", "window": { "from": "iso-datetime", "to": "iso-datetime" }
}
```

## GET /v1/availability
```json
{ "availability": { "workspace_id": "uuid", "timezone": "string", "weekly_hours": { "fri": [ [ "string" ] ], "mon": [ [ "string" ] ], "sat": "[]", "sun": "[]", "thu": [ [ "string" ] ], "tue": [ [ "string" ] ], "wed": [ [ "string" ] ] }, "slot_minutes": "number", "buffer_minutes": "number", "default_calendar_id": "uuid", "scheduling_mode": "\"exact\"", "arrival_window_minutes": "number", "date_overrides": "[]" }, "configured": "boolean"
}
```

## GET /v1/social/accounts
```json
{ "workspace_id": "uuid", "accounts": [ { "id": "uuid", "platform": "string", "name": "string", "page_name": "string", "username": "string", "enabled": "boolean", "ai_replies": "boolean", "status": "\"connected\"", "live": "boolean", "last_error": "null", "last_event_at": "iso-datetime", "connected_at": "iso-datetime" } ]
}
```

## GET /v1/social/comments
```json
{ "workspace_id": "uuid", "comments": "[]", "counts": { "all": "number", "sent": "number", "failed": "number", "skipped": "number" }, "has_more": "boolean", "next_offset": "null"
}
```

## GET /v1/social/settings
```json
{ "workspace_id": "uuid", "lead_mode": "\"qualified\"", "dm_leads_to_move": "number"
}
```

## GET /v1/email-campaigns
```json
{ "campaigns": "[]", "has_more": "boolean"
}
```

## GET /v1/workspace-automations
```json
{ "automations": [ { "id": "uuid", "name": "string", "description": "string", "enabled": "boolean", "trigger_type": "\"appointment.booked\"|\"lead.tag_added\"|\"lead.status_changed\"|\"lead.created\"|\"appointment.cancelled\"|\"message.inbound\"", "folder_id": "null", "run_count": "number", "error_count": "number", "last_run_at": "iso-datetime", "created_at": "iso-datetime" } ]
}
```

## GET /v1/workspace-automations/{automation_id}
```json
{ "automation": { "id": "uuid", "name": "string", "enabled": "boolean", "trigger": { "type": "\"appointment_booked\"", "calendar_ids": [ "uuid" ] }, "starts_when": "string", "steps": [ { "ref": "string", "action": "string", "message": "string" } ], "stats": { "runs": "number", "errors": "number", "in_progress": "number" }, "page": "string" }
}
```

## GET /v1/smart-forms
```json
{ "smart_forms": [ { "id": "uuid", "name": "string", "slug": "string", "is_published": "boolean", "layout_mode": "string", "headline": "string", "booking_enabled": "boolean", "qualifier_enabled": "boolean", "calendar_id": "uuid", "views_count": "number", "submissions_count": "number", "created_at": "iso-datetime", "service_area": "null", "calendar_routing": "boolean" } ]
}
```

## GET /v1/smart-forms/{form_id}/submissions
```json
{ "submissions": [ { "id": "uuid", "lead_id": "uuid", "booking_id": "uuid", "first_name": "string", "last_name": "string", "phone": "string", "email": "string", "notes": "string", "custom_fields": { "raw_answers": {}, "custom_answers": [ { "key": "\"pulse_studio_name\"|\"pulse_sms_marketing_consent\"|\"pulse_automated_call_consent\"|\"pulse_email_marketing_consent\"|\"pulse_role_and_locations\"|\"pulse_workflow_brief\"", "value": "string", "question": "string", "field_type": "\"text\"|\"boolean\"", "disqualifies": "boolean" } ], "pulse_studio_name": "string", "qualifier_answers": "[]", "pulse_workflow_brief": "string", "pulse_role_and_locations": "string", "pulse_sms_marketing_consent": "boolean", "pulse_automated_call_consent": "boolean", "pulse_email_marketing_consent": "boolean" }, "status": "\"complete\"", "created_at": "iso-datetime" } ]
}
```

## GET /v1/calls
```json
{ "calls": "[]", "has_more": "boolean", "next_cursor": "null"
}
```

## GET /v1/members
```json
{ "members": [ { "id": "uuid", "user_id": "uuid", "role": "\"owner\"", "invited_email": "null", "created_at": "iso-datetime", "email": "string", "full_name": "string" } ], "pending_invites": [ { "id": "uuid", "email": "string", "role": "\"client_admin\"", "expires_at": "iso-datetime", "accepted_at": "null", "created_at": "iso-datetime" } ]
}
```

## GET /v1/phone-numbers
```json
{ "phone_numbers": [ { "id": "uuid", "workspace_id": "uuid", "phone_number": "string", "friendly_name": "string", "is_default": "boolean", "capabilities": {}, "sms_registration_status": "string", "cnam_display_name": "null", "cnam_status": "string", "shaken_status": "string", "voice_forward_enabled": "boolean", "assigned_user_id": "null", "tech_can_answer": "boolean", "tech_can_use": "boolean", "created_at": "iso-datetime", "released_at": "null", "texting_ready": "boolean" } ]
}
```

## GET /v1/ai-texting
```json
{ "configured": "boolean", "ai_texting": { "ai_replies": "boolean", "agent_name": "string", "reply_mode": "string", "goal": "string", "business_context": "null", "booking_link": "null", "max_replies": "number", "reply_delay_minutes": "number", "ai_can_cancel": "boolean", "handoff_when_unsure": "boolean", "pause_ai_on_handoff": "boolean", "handoff_resume_days": "number", "greet_new_leads": "boolean", "first_message": "string", "smart_first_text": "boolean", "smart_first_text_goal": "null", "greet_delay_minutes": "number", "form_greet_delay_minutes": "number", "missed_call_text": "boolean", "missed_call_message": "null", "confirmation_text": "boolean", "confirmation_message": "string", "confirmation_email": "boolean", "confirmation_email_language": "string", "reminder_24h": "boolean", "reminder_24h_message": "string", "reminder_1h": "boolean", "reminder_1h_message": "string", "reminder_5m": "boolean", "reminder_5m_message": "string", "email_greeting": "boolean", "email_greeting_subject": "string", "email_greeting_body": "string", "send_window": "string", "send_window_start": "string", "send_window_end": "string", "ai_answers_email": "boolean", "prompt_characters": "number", "prompt_preview": "string" }, "has_phone_number": "boolean"
}
```

## GET /v1/business-profile
```json
{ "business_profile": { "id": "uuid", "name": "string", "industry": "string", "timezone": "string", "address_line1": "string", "address_line2": "string", "city": "string", "state": "string", "postal_code": "string", "country": "null", "business_phone": "string", "business_email": "string" }
}
```

## GET /v1/lead-sources
```json
{ "lead_sources": "[]", "how_to_use": "string"
}
```

## GET /v1/alert-recipients
```json
{ "alert_recipients": [ { "id": "uuid", "workspace_id": "uuid", "channel": "\"sms\"|\"email\"", "destination": "string", "label": "string", "active": "boolean", "notify_leads": "boolean", "notify_calls": "boolean", "lead_sources": "[]", "created_at": "iso-datetime" } ]
}
```

## GET /v1/outbound-webhooks
```json
{ "outbound_webhooks": [ { "id": "uuid", "workspace_id": "uuid", "name": "string", "target_url": "string", "enabled": "boolean", "events": [ "string" ], "auth_type": "\"none\"", "auth_header_name": "null", "preset": "\"custom\"", "last_status": "number", "created_at": "iso-datetime" } ], "events": [ "string" ]
}
```

## GET /v1/deals
Answered 403 on this account: `More pipelines is off for this account. An owner or admin turns it on in Settings > Features.` {'code': 'feature_off', 'feature': 'pipelines'}

## GET /v1/pipelines
Answered 403 on this account: `More pipelines is off for this account. An owner or admin turns it on in Settings > Features.` {'code': 'feature_off', 'feature': 'pipelines'}
