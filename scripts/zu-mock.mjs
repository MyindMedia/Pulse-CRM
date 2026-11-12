#!/usr/bin/env node
/* Zuops mock for the agency CRM (F-B13). Write flows can be verified end to end
   without touching the real Zuops account or any real person.

     node scripts/zu-mock.mjs --port 4777
     npx convex env set ZUOPS_CRM_MOCK_URL http://127.0.0.1:4777   (a LOCAL deployment only)

   - Binds 127.0.0.1 only. No dependencies. Every person in it is invented.
   - Answers in Zuops's envelope { success, data, error } with the shapes in
     specs/features/agency-crm-zuops/api-shapes.md.
   - Routes come from the operation registry (convex/crm/ops.generated.ts): a path
     that is not a Zuops operation is a 404; a known list with no seed data is empty;
     a known write with no handler answers { ok: true }.
   - In-memory state: stage moves, notes, sends (appended to the thread), bookings
     (book, reschedule, cancel), automation toggles, conversation archive and read.
   - Idempotency-Key: the same key with the same body replays the first answer and
     changes nothing; the same key with a different body is a 409.
   - Test hooks: a lead whose email starts with "optout" refuses sends with a 400;
     booking the seeded full slot is a 409 slot_full.
   - GET /__requests lists every request (method, path, idempotency key, body);
     DELETE /__requests clears the list. Neither is recorded. */

import http from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* ------------------------------- options ------------------------------- */

const argv = process.argv.slice(2);
const portArg = argv.indexOf("--port");
const PORT = portArg >= 0 ? Number(argv[portArg + 1]) : 4777;
if (!Number.isInteger(PORT) || PORT < 10 || PORT > 65535) {
  console.error("Usage: node scripts/zu-mock.mjs [--port 4777]");
  process.exit(2);
}
const HOST = "127.0.0.1";
const MAX_BODY = 1024 * 1024;

/* ------------------------------- registry ------------------------------ */

const registryFile = fileURLToPath(new URL("../convex/crm/ops.generated.ts", import.meta.url));
const OPS = [];
for (const line of readFileSync(registryFile, "utf8").split("\n")) {
  const m = line.match(/^ {2}"([a-z0-9_]+)": (\{.*\}),?$/);
  if (!m) continue;
  const op = JSON.parse(m[2]);
  const names = [];
  const re = new RegExp(
    "^" + op.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{([a-z_]+)\}/g, (_, n) => (names.push(n), "([^/]+)")) + "$",
  );
  OPS.push({ ...op, re, names, literal: (op.path.match(/\{/g) ?? []).length });
}
// Literal segments win over parameters (/v1/leads/export before /v1/leads/{lead_id}).
OPS.sort((a, b) => a.literal - b.literal);

function route(method, path) {
  let pathKnown = false;
  for (const op of OPS) {
    const m = op.re.exec(path);
    if (!m) continue;
    pathKnown = true;
    if (op.method !== method) continue;
    const params = {};
    op.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
    return { op, params };
  }
  return { op: null, pathKnown };
}

/* --------------------------------- data --------------------------------- */

const WS = "e56bf309-bede-486f-b4b5-1948248b3839";
const DAY = 86_400_000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
let seq = 1000;
const uuid = () => {
  seq += 1;
  return `0000beef-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};
const id = (n) => `0000beef-0000-4000-8000-${String(n).padStart(12, "0")}`;

const STAGES = [
  ["new", "New", "blue"],
  ["contacted", "Contacted", "amber"],
  ["booked", "Booked", "cyan"],
  ["won", "Won", "emerald"],
  ["lost", "Lost", "rose"],
].map(([key, label, color], i) => ({ id: id(10 + i), key, label, color, behavior: key, position: i, is_system: true, hidden: false }));

const TAGS = [
  { id: id(20), name: "VIP", color: "slate", created_at: iso(NOW - 40 * DAY) },
  { id: id(21), name: "Referral", color: "slate", created_at: iso(NOW - 30 * DAY) },
];

// Invented people only. Phones are 555-01xx test numbers, emails use .example.
const PEOPLE = [
  ["Maya Okafor", "maya@northline.example", "+12135550142", "contacted", "contacted", "sms", ["VIP"]],
  ["Jonah Reyes", "jonah@harborlane.example", "+12135550143", "new", "new", "api", []],
  ["Priya Natarajan", "priya@cedarloop.example", "+12135550144", "booked", "contacted", "instagram", ["Referral"]],
  ["Elena Brandt", "elena@quarryhill.example", "+12135550145", "won", "contacted", "api", ["VIP"]],
  ["Marcus Lee", "marcus@saltmarsh.example", "+12135550146", "lost", "contacted", "other", []],
  ["Tessa Moreau", "optout@quietbay.example", "+12135550147", "contacted", "contacted", "api", []],
  ["Dev Anand", "dev@ridgeview.example", "+12135550148", "booked", "contacted", "sms", []],
  ["Sofia Lindqvist", "sofia@fernway.example", "+12135550149", "new", "new", "api", []],
  ["Kai Nakamura", "", "", "new", "partial", "instagram", []],
  ["Ruth Abernathy", "", "", "new", "partial", "instagram", []],
];

const leads = new Map();
PEOPLE.forEach(([full_name, email, phone, stage, status, source, tags], i) => {
  const at = NOW - (i + 1) * 3 * 3_600_000;
  const lead = {
    id: id(100 + i), workspace_id: WS, full_name, email: email || null, phone: phone || null, source, status,
    stage_key: stage, stage, score: null, assigned_to: null, ad_name: null, campaign_name: null,
    deal_value_cents: stage === "won" ? 45_000 : null, deal_currency: "usd", deal_won_at: stage === "won" ? iso(at) : null,
    existing_customer: false, created_at: iso(at - 5 * DAY), updated_at: iso(at), last_activity_at: iso(at),
    chat_only: status === "partial", inquiry: "Asking about a first session", address: null, city: null, state: null, zip: null,
    custom_fields: {}, tags: [...tags], notes: [], ai_paused: false, unread: i < 2, unread_count: i < 2 ? 1 : 0,
    inbox_archived: false, email_opt_out: email.startsWith("optout"),
  };
  leads.set(lead.id, lead);
});
const leadList = () => [...leads.values()];

// Threads: five conversations.
const thread = new Map();
const addMsg = (leadId, direction, channel, body, at, extra = {}) => {
  const m = { id: uuid(), lead_id: leadId, workspace_id: WS, channel, direction, body, subject: null, from: null, to: null, media_urls: [], provider_message_id: `pm_${seq}`, delivery_status: direction === "outbound" ? "delivered" : null, automated: false, actor_label: direction === "outbound" ? "Pulse" : "Lead", created_at: iso(at), ...extra };
  if (!thread.has(leadId)) thread.set(leadId, []);
  thread.get(leadId).push(m);
  const lead = leads.get(leadId);
  if (lead) {
    lead.last_activity_at = m.created_at;
    if (direction === "inbound") lead.last_inbound_at = m.created_at;
    else lead.last_outbound_at = m.created_at;
  }
  return m;
};
addMsg(id(100), "inbound", "sms", "Hi, do you have anything Friday afternoon?", NOW - 5 * 3_600_000);
addMsg(id(100), "outbound", "sms", "We do. Would 4 PM work?", NOW - 4 * 3_600_000);
addMsg(id(101), "inbound", "email", "Interested in a trial class.", NOW - 3 * 3_600_000, { subject: "Trial class" });
addMsg(id(102), "inbound", "instagram", "Saw your post, how do I book?", NOW - 26 * 3_600_000);
addMsg(id(102), "outbound", "instagram", "Here is the link to pick a time.", NOW - 25 * 3_600_000);
addMsg(id(103), "outbound", "sms", "Thanks for joining us this week.", NOW - 50 * 3_600_000);
addMsg(id(108), "inbound", "instagram", "What are your prices?", NOW - 2 * 3_600_000);

const scheduled = [
  { id: id(200), lead_id: id(100), workspace_id: WS, channel: "sms", body: "Reminder: see you Friday at 4 PM.", subject: null, media_urls: [], status: "scheduled", scheduled_at: iso(NOW + DAY), created_at: iso(NOW - 3_600_000) },
];
const suggestions = [
  { id: id(210), lead_id: id(108), workspace_id: WS, channel: "instagram", body: "Our intro month is $99. Want me to hold a spot for you?", status: "pending", created_at: iso(NOW - 3_600_000) },
];

const CAL = id(300);
const day0 = new Date(NOW + DAY);
day0.setUTCHours(17, 0, 0, 0);
const SLOTS = [0, 1, 2, 24, 25, 26].map((h) => iso(day0.getTime() + h * 3_600_000));
const FULL_SLOT = SLOTS[1];
const calendar = {
  id: CAL, slug: "intro-session", name: "Intro session", title: "Intro session", description: "A 45 minute first visit.", timezone: "America/Los_Angeles",
  duration_minutes: 45, buffer_minutes: 15, slot_increment_minutes: 60, min_notice_minutes: 120, max_days_ahead: 30, max_per_day: null,
  weekly_hours: { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]], sat: [], sun: [] },
  date_overrides: [], assignment_mode: "single", host_user_id: id(400), meeting_type: "custom", meeting_location: "Studio floor", location_label: "Studio",
  scheduling_mode: "exact", is_active: true, booking_path: "/book/intro-session",
};

const bookings = new Map();
[[id(102), 0, "confirmed"], [id(106), 24, "confirmed"], [id(103), -48, "completed"], [id(104), -72, "cancelled"]].forEach(([leadId, h, status], i) => {
  const starts = day0.getTime() + h * 3_600_000;
  const b = { id: id(310 + i), workspace_id: WS, lead_id: leadId, calendar_id: CAL, appointment_number: 1 + i, title: "Intro session", starts_at: iso(starts), ends_at: iso(starts + 45 * 60_000), timezone: "America/Los_Angeles", lead_timezone: "America/Los_Angeles", location: "Studio floor", notes: "", meeting_type: "custom", meeting_location: "Studio floor", meeting_url: "", host_user_id: id(400), status, source: "api", notify_lead: true, is_arrival_window: false, service_details: null, created_at: iso(NOW - 3 * DAY), updated_at: iso(NOW - 3 * DAY), manage_url: `https://book.example/manage/${310 + i}` };
  bookings.set(b.id, b);
});

const automations = new Map(
  [["Booking confirmation", "appointment.booked", true], ["New lead welcome", "lead.created", true], ["Win-back after 30 days", "lead.status_changed", false]].map(([name, trigger_type, enabled], i) => [
    id(500 + i),
    { id: id(500 + i), name, description: `${name} flow`, enabled, trigger_type, folder_id: null, run_count: 12 - i * 4, error_count: 0, last_run_at: iso(NOW - (i + 1) * DAY), created_at: iso(NOW - 60 * DAY) },
  ]),
);

const smartForms = [
  { id: id(600), name: "Intro offer", slug: "intro-offer", is_published: true, layout_mode: "steps", headline: "Claim your intro week", booking_enabled: true, qualifier_enabled: false, calendar_id: CAL, views_count: 240, submissions_count: 2, created_at: iso(NOW - 20 * DAY), service_area: null, calendar_routing: false },
];
const submissions = [
  { id: id(610), lead_id: id(102), booking_id: id(310), first_name: "Priya", last_name: "Natarajan", phone: "+12135550144", email: "priya@cedarloop.example", notes: "", custom_fields: { raw_answers: {}, custom_answers: [] }, status: "complete", created_at: iso(NOW - 2 * DAY) },
  { id: id(611), lead_id: id(106), booking_id: id(311), first_name: "Dev", last_name: "Anand", phone: "+12135550148", email: "dev@ridgeview.example", notes: "", custom_fields: { raw_answers: {}, custom_answers: [] }, status: "complete", created_at: iso(NOW - DAY) },
];

const campaigns = [
  { id: id(700), name: "November open house", status: "draft", subject: "Come see the studio", audience: "stages", stages: ["new", "contacted"], tags: [], not_booked: true, recipient_count: 5, created_at: iso(NOW - DAY), sent_at: null },
  { id: id(701), name: "October recap", status: "sent", subject: "What we did in October", audience: "all", stages: [], tags: [], not_booked: false, recipient_count: 8, created_at: iso(NOW - 12 * DAY), sent_at: iso(NOW - 11 * DAY) },
];

const calls = [
  { id: id(800), lead_id: id(100), direction: "inbound", status: "completed", duration_seconds: 184, ai: false, summary: "Asked about Friday times.", created_at: iso(NOW - 6 * 3_600_000) },
  { id: id(801), lead_id: id(101), direction: "outbound", status: "voicemail", duration_seconds: 31, ai: true, summary: "Left a voicemail.", created_at: iso(NOW - 30 * 3_600_000) },
];

const LIMITS = { daily_unique_contact_cap: 300, unique_contacts_used: 13, unique_contacts_remaining: 287, segments_used: 21, segment_safety_cap: 2000, messages_sent_today: 13, frozen: false, frozen_reason: null, resets_at: iso(NOW + 8 * 3_600_000) };

/* ------------------------------- answers ------------------------------- */

const conversationOf = (lead) => {
  const msgs = thread.get(lead.id) ?? [];
  const last = msgs[msgs.length - 1];
  return {
    lead_id: lead.id, workspace_id: WS, name: lead.full_name, phone: lead.phone, email: lead.email, status: lead.status, stage_key: lead.stage_key,
    assigned_to: null, unread: lead.unread, unread_count: lead.unread_count, archived: lead.inbox_archived,
    ai: { paused: lead.ai_paused, paused_until: null, pause_reason: null, handoff_question: null }, channel: last?.channel ?? "sms",
    last_message: last ? { id: last.id, channel: last.channel, direction: last.direction, body: last.body, subject: last.subject, sent_by: last.actor_label, created_at: last.created_at } : null,
    last_inbound_at: lead.last_inbound_at ?? null, last_outbound_at: lead.last_outbound_at ?? null, last_activity_at: lead.last_activity_at,
  };
};
const publicLead = (l) => {
  const { notes, ...rest } = l;
  return { ...rest, notes: notes.length ? notes[notes.length - 1].body : null };
};
const asEvent = (m) => ({ id: m.id, event_type: `${m.channel}_${m.direction}`, actor_label: m.actor_label, body: m.body, metadata: { platform: m.channel }, created_at: m.created_at });

const ok = (data, status = 200) => ({ status, payload: { success: true, data, error: null } });
const fail = (status, error, details) => ({ status, payload: { success: false, data: null, error, ...(details ? { details } : {}) } });
const notFound = () => fail(404, "Not found");

function overview() {
  const by = (k) => leadList().filter((l) => l.stage_key === k).length;
  return {
    workspace_id: WS, window: { from: iso(NOW - 30 * DAY), to: iso(NOW), days: 30 },
    stats: { won: by("won"), leads: leads.size, closed: by("won") + by("lost"), contacted: by("contacted"), appointments: bookings.size, booked_leads: by("booked"), new_unworked: by("new"), prev_leads: 6, prev_appointments: 3, prev_booked_leads: 1, upcoming_appointments: [...bookings.values()].filter((b) => b.status === "confirmed").length, median_response_minutes: 7, median_response_minutes_auto: null, median_response_minutes_human: 7, auto_replied_leads: 2, human_replied_leads: 5, calendar_booked_leads: 2, calls: { total: calls.length, inbound: 1, outbound: 1, ai_calls: 1, answered: 1, voicemails: 1, talk_seconds: 215, missed_inbound: 0, ai_receptionist_calls: 0 }, ai_replies: { sms: 3, email: 1, leads: 3, total: 4, other_channels: 0 }, stage_reach: { total: leads.size, reached: { new: leads.size, contacted: 7 } } },
  };
}
function healthScore() {
  return {
    workspace_id: WS, name: "Northline Studio (mock)", score: 62, grade: "Needs attention", is_new: false, verdict: "Replies are quick; follow-ups are thin.",
    factors: [
      { key: "speed", label: "Reply speed", weight: 30, earned: 26, applies: true, value: "7 min", detail: "Median first reply", hint: "Keep it under 5 minutes", gain: 4 },
      { key: "booking", label: "Booking rate", weight: 25, earned: 12, applies: true, value: "20%", detail: "Leads that booked", hint: "Offer a time in the first text", gain: 13 },
    ],
    not_measured: [], applied_weight: 55,
    actions: [{ key: "waiting", title: "2 leads are waiting", why: "They wrote and nobody answered.", gain: 6, path: "/inbox", cta: "Open inbox", urgent: true }],
    inputs: { last_activity_at: iso(NOW - 2 * 3_600_000), leads_7d: 4, bookings_7d: 2, leads_30d: leads.size, booked_30d: 2, median_response_seconds: 420, reply_base_30d: 8, replied_30d: 7 },
    waiting: { count: 2, longest_since: iso(NOW - 5 * 3_600_000) },
    history: [{ as_of: iso(NOW - 7 * DAY), score: 55, grade: "Needs attention" }],
    setup: { webhooks: 1, ai_texter: true, calendars: 1, first_text: true, follow_ups: false, meta_pages: 1, automations: automations.size, smart_forms: smartForms.length, phone_numbers: 1 },
  };
}

function listLeads(q) {
  let rows = leadList();
  const search = String(q.get("search") ?? q.get("q") ?? "").toLowerCase();
  if (search) rows = rows.filter((l) => [l.full_name, l.email, l.phone].some((v) => v && v.toLowerCase().includes(search)));
  const stage = q.get("stage_key") ?? q.get("stage");
  if (stage) rows = rows.filter((l) => l.stage_key === stage);
  const status = q.get("status");
  if (status) rows = rows.filter((l) => l.status === status);
  const limit = Math.max(1, Math.min(200, Number(q.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(q.get("offset") ?? 0) || 0);
  const page = rows.slice(offset, offset + limit);
  const more = offset + limit < rows.length;
  return { leads: page.map(publicLead), has_more: more, next_offset: more ? offset + limit : null };
}

/* GET handlers by operation id. Returning undefined means "no seed": an empty list. */
const READS = {
  get_overview: () => ok(overview()),
  get_health_score: () => ok(healthScore()),
  get_usage: () => ok({ workspace_id: WS, window: { from: iso(NOW - 30 * DAY), to: iso(NOW), days: 30 }, total_credits: 412, total_events: 96, unpaid_events: 0, by_tool: [{ tool: "sms", label: "Texts", events: 80, credits: 160, unpaid: 0 }, { tool: "ai_reply", label: "AI replies", events: 16, credits: 252, unpaid: 0 }], by_day: [{ date: iso(NOW).slice(0, 10), events: 9, credits: 31 }] }),
  message_limits: () => ok({ limits: LIMITS }),
  setup_status: () => ok({ workspace_id: WS, steps: [{ key: "phone_number", label: "Get a phone number", done: true }, { key: "calendar", label: "Create a calendar", done: true }, { key: "first_text", label: "Write the first text", done: true }, { key: "follow_ups", label: "Turn on follow-ups", done: false }], complete: false }),
  list_leads: ({ q }) => ok(listLeads(q)),
  get_lead: ({ p }) => {
    const l = leads.get(p.lead_id);
    return l ? ok({ lead: publicLead(l), events: (thread.get(l.id) ?? []).map(asEvent) }) : fail(404, "Lead not found");
  },
  lead_timeline: ({ p }) => {
    const l = leads.get(p.lead_id);
    if (!l) return fail(404, "Lead not found");
    const notes = l.notes.map((n) => ({ id: n.id, event_type: "note", actor_label: n.actor_label, body: n.body, metadata: {}, created_at: n.created_at }));
    return ok({ lead_id: l.id, events: [...(thread.get(l.id) ?? []).map(asEvent), ...notes].sort((a, b) => a.created_at.localeCompare(b.created_at)) });
  },
  list_stages: () => ok({ stages: STAGES }),
  list_tags: () => ok({ tags: TAGS.map((t) => ({ ...t, lead_count: leadList().filter((l) => l.tags.includes(t.name)).length })) }),
  list_custom_fields: () => ok({ custom_fields: [{ id: id(30), workspace_id: WS, field_key: "goal", label: "Goal", field_type: "text", options: null, required: false, sort_order: 0, helper_text: "What they want out of it", placeholder: null, default_value: null, validation: {}, show_in_list: true, group_name: null, archived_at: null }] }),
  list_conversations: ({ q }) => {
    const archived = q.get("archived") === "true";
    const all = leadList().filter((l) => thread.has(l.id));
    const rows = all.filter((l) => l.inbox_archived === archived).map(conversationOf);
    return ok({ conversations: rows, has_more: false, next_cursor: null, counts: { open: all.filter((l) => !l.inbox_archived).length, unread: all.filter((l) => l.unread).length, archived: all.filter((l) => l.inbox_archived).length } });
  },
  lead_conversation: ({ p }) => {
    const l = leads.get(p.lead_id);
    if (!l) return fail(404, "Lead not found");
    return ok({ lead: { id: l.id, workspace_id: WS, full_name: l.full_name, email: l.email, phone: l.phone, last_inbound_at: l.last_inbound_at ?? null, last_outbound_at: l.last_outbound_at ?? null }, messages: (thread.get(l.id) ?? []).map(asEvent) });
  },
  list_messages: ({ q }) => {
    const leadId = q.get("lead_id");
    const all = [...thread.values()].flat().filter((m) => !leadId || m.lead_id === leadId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return ok({ messages: all.map((m) => { const l = leads.get(m.lead_id); return { ...m, lead: { id: l.id, full_name: l.full_name, email: l.email, phone: l.phone } }; }), next_cursor: null, has_more: false, limits: LIMITS });
  },
  list_scheduled_messages: () => ok({ scheduled_messages: scheduled.filter((s) => s.status === "scheduled"), has_more: false, next_cursor: null }),
  list_reply_suggestions: () => ok({ reply_mode: "suggest", suggestions: suggestions.filter((s) => s.status === "pending"), has_more: false, next_cursor: null }),
  list_calendars: () => ok({ calendars: [calendar] }),
  calendar_availability: ({ p }) => {
    if (p.calendar_id !== CAL) return fail(404, "Calendar not found");
    const taken = new Set([...bookings.values()].filter((b) => b.status !== "cancelled").map((b) => b.starts_at));
    const free = SLOTS.filter((s) => !taken.has(s) && s !== FULL_SLOT);
    const days = [...new Set(free.map((s) => s.slice(0, 10)))].map((d) => ({ date: d, label: d, slots: free.filter((s) => s.startsWith(d)) }));
    return ok({ calendar: { id: CAL, name: calendar.name, timezone: calendar.timezone, duration_minutes: 45, duration_days: null, booking_window_days: 30 }, from: iso(NOW), to: iso(NOW + 7 * DAY), from_date: iso(NOW).slice(0, 10), to_date: iso(NOW + 7 * DAY).slice(0, 10), slots: free, days, quote: null });
  },
  list_bookings: ({ q }) => {
    const status = q.get("status");
    return ok({ bookings: [...bookings.values()].filter((b) => !status || b.status === status) });
  },
  get_availability: () => ok({ availability: { workspace_id: WS, timezone: calendar.timezone, weekly_hours: calendar.weekly_hours, slot_minutes: 60, buffer_minutes: 15, default_calendar_id: CAL, scheduling_mode: "exact", arrival_window_minutes: 0, date_overrides: [] }, configured: true }),
  list_social_accounts: () => ok({ workspace_id: WS, accounts: [{ id: id(900), platform: "instagram", name: "Northline Studio", page_name: "Northline Studio", username: "northline.studio", enabled: true, ai_replies: true, status: "connected", live: true, last_error: null, last_event_at: iso(NOW - 2 * 3_600_000), connected_at: iso(NOW - 90 * DAY) }] }),
  list_social_comments: () => ok({ workspace_id: WS, comments: [{ id: id(910), account_id: id(900), platform: "instagram", author: "kai.n", text: "How much is the intro month?", reply: "Sent you a DM with the details.", status: "sent", created_at: iso(NOW - 3 * 3_600_000) }], counts: { all: 1, sent: 1, failed: 0, skipped: 0 }, has_more: false, next_offset: null }),
  get_social_settings: () => ok({ workspace_id: WS, lead_mode: "qualified", dm_leads_to_move: 2 }),
  list_email_campaigns: () => ok({ campaigns, has_more: false }),
  get_email_campaign: ({ p }) => { const c = campaigns.find((x) => x.id === p.campaign_id); return c ? ok({ campaign: c }) : fail(404, "Campaign not found"); },
  list_ws_automations: () => ok({ automations: [...automations.values()] }),
  get_automation: ({ p }) => {
    const a = automations.get(p.automation_id);
    return a ? ok({ automation: { id: a.id, name: a.name, enabled: a.enabled, trigger: { type: a.trigger_type.replace(".", "_") }, starts_when: a.description, steps: [{ ref: "s1", action: "send_text", message: "Thanks, see you soon." }], stats: { runs: a.run_count, errors: a.error_count, in_progress: 0 }, page: `/automations/${a.id}` } }) : fail(404, "Automation not found");
  },
  list_smart_forms: () => ok({ smart_forms: smartForms }),
  list_form_submissions: ({ p }) => (p.form_id === smartForms[0].id ? ok({ submissions }) : fail(404, "Form not found")),
  list_calls: () => ok({ calls, has_more: false, next_cursor: null }),
  get_call: ({ p }) => { const c = calls.find((x) => x.id === p.call_id); return c ? ok({ call: c }) : fail(404, "Call not found"); },
  list_members: () => ok({ members: [{ id: id(400), user_id: id(401), role: "owner", invited_email: null, created_at: iso(NOW - 200 * DAY), email: "owner@northline.example", full_name: "Avery Quinn" }], pending_invites: [] }),
  list_phone_numbers: () => ok({ phone_numbers: [{ id: id(950), workspace_id: WS, phone_number: "+12135550100", friendly_name: "Main line", is_default: true, capabilities: { sms: true, voice: true }, sms_registration_status: "approved", cnam_display_name: null, cnam_status: "none", shaken_status: "A", voice_forward_enabled: false, assigned_user_id: null, tech_can_answer: false, tech_can_use: false, created_at: iso(NOW - 120 * DAY), released_at: null, texting_ready: true }] }),
};

/* Writes by operation id: (ctx) => answer. Each one runs once per idempotency key. */
const lead404 = () => fail(404, "Lead not found");
const WRITES = {
  create_lead: ({ b }) => {
    const l = { id: uuid(), workspace_id: WS, full_name: b.full_name ?? "New lead", email: b.email ?? null, phone: b.phone ?? null, source: b.source ?? "api", status: b.status ?? "new", stage_key: b.stage_key ?? "new", stage: b.stage_key ?? "new", deal_currency: "usd", existing_customer: false, created_at: iso(Date.now()), updated_at: iso(Date.now()), last_activity_at: iso(Date.now()), chat_only: false, inquiry: b.inquiry ?? "", custom_fields: b.custom_fields ?? {}, tags: b.tags ?? [], notes: [], ai_paused: false, unread: false, unread_count: 0, inbox_archived: false, email_opt_out: String(b.email ?? "").startsWith("optout") };
    leads.set(l.id, l);
    return ok({ lead: publicLead(l) }, 201);
  },
  update_lead: ({ p, b }) => {
    const l = leads.get(p.lead_id);
    if (!l) return lead404();
    if (b.stage_key !== undefined && !STAGES.some((s) => s.key === b.stage_key)) return fail(400, "stage_key must be one of new, contacted, booked, won, lost");
    for (const [k, v] of Object.entries(b)) if (!["add_tags", "remove_tags", "notes"].includes(k)) l[k] = v;
    if (b.stage_key) l.stage = b.stage_key;
    if (Array.isArray(b.add_tags)) l.tags = [...new Set([...l.tags, ...b.add_tags])];
    if (Array.isArray(b.remove_tags)) l.tags = l.tags.filter((t) => !b.remove_tags.includes(t));
    l.updated_at = iso(Date.now());
    return ok({ lead: publicLead(l) });
  },
  set_lead_stage: ({ p, b }) => {
    const l = leads.get(p.lead_id);
    if (!l) return lead404();
    if (!STAGES.some((s) => s.key === b.stage_key)) return fail(400, "stage_key must be one of new, contacted, booked, won, lost");
    l.stage_key = l.stage = b.stage_key;
    l.updated_at = iso(Date.now());
    return ok({ lead: publicLead(l) });
  },
  delete_lead: ({ p }) => (leads.delete(p.lead_id) ? ok({ deleted: true }) : lead404()),
  create_lead_note: ({ p, b }) => {
    const l = leads.get(p.lead_id);
    if (!l) return lead404();
    if (!b.body) return fail(400, "body is required");
    const n = { id: uuid(), lead_id: l.id, body: b.body, actor_label: b.actor_label ?? "Pulse", created_at: iso(Date.now()) };
    l.notes.push(n);
    return ok({ note: n }, 201);
  },
  set_lead_ai_pause: ({ p, b }) => {
    const l = leads.get(p.lead_id);
    if (!l) return lead404();
    l.ai_paused = b.paused === true;
    return ok({ lead_id: l.id, ai_paused: l.ai_paused, ai_paused_until: b.until ?? null });
  },
  send_message: ({ b }) => {
    if (!b.channel || !["sms", "email", "instagram", "messenger"].includes(b.channel)) return fail(400, "channel must be one of sms, email, instagram, messenger");
    if (!b.body) return fail(400, "body is required");
    if (!b.lead_id) return fail(400, "lead_id is required in the mock");
    const l = leads.get(b.lead_id);
    if (!l) return lead404();
    if (b.channel === "email" && !b.subject) return fail(400, "subject is required for email");
    if (l.email_opt_out) return fail(400, "This contact opted out");
    if ((b.channel === "sms" && !l.phone) || (b.channel === "email" && !l.email)) return fail(400, `This lead has no ${b.channel === "sms" ? "phone number" : "email address"}`);
    if (b.send_at) {
      const s = { id: uuid(), lead_id: l.id, workspace_id: WS, channel: b.channel, body: b.body, subject: b.subject ?? null, media_urls: b.media_urls ?? [], status: "scheduled", scheduled_at: b.send_at, created_at: iso(Date.now()) };
      scheduled.push(s);
      return ok({ scheduled_message: s, limits: LIMITS }, 201);
    }
    const m = addMsg(l.id, "outbound", b.channel, b.body, Date.now(), { subject: b.subject ?? null, actor_label: b.actor_label ?? "Pulse" });
    LIMITS.messages_sent_today += 1;
    return ok({ message_id: m.id, message: m, limits: LIMITS }, 201);
  },
  update_scheduled_message: ({ p, b }) => {
    const s = scheduled.find((x) => x.id === p.scheduled_message_id);
    if (!s) return fail(404, "Scheduled message not found");
    Object.assign(s, b);
    return ok({ scheduled_message: s });
  },
  send_scheduled_message_now: ({ p }) => {
    const s = scheduled.find((x) => x.id === p.scheduled_message_id && x.status === "scheduled");
    if (!s) return fail(404, "Scheduled message not found");
    s.status = "sent";
    const m = addMsg(s.lead_id, "outbound", s.channel, s.body, Date.now());
    return ok({ message_id: m.id });
  },
  approve_reply_suggestion: ({ p, b }) => {
    const s = suggestions.find((x) => x.id === p.suggestion_id && x.status === "pending");
    if (!s) return fail(404, "Suggestion not found");
    s.status = "approved";
    const m = addMsg(s.lead_id, "outbound", s.channel, b.body ?? s.body, Date.now());
    return ok({ message_id: m.id });
  },
  dismiss_reply_suggestion: ({ p }) => {
    const s = suggestions.find((x) => x.id === p.suggestion_id && x.status === "pending");
    if (!s) return fail(404, "Suggestion not found");
    s.status = "dismissed";
    return ok({ dismissed: true });
  },
  create_booking: ({ b }) => {
    if (!b.starts_at) return fail(400, "starts_at is required");
    const starts = Date.parse(b.starts_at);
    if (Number.isNaN(starts)) return fail(400, "starts_at must be an ISO 8601 date and time");
    const at = iso(starts);
    const taken = [...bookings.values()].some((x) => x.status !== "cancelled" && x.starts_at === at);
    if (at === FULL_SLOT || (taken && !b.force)) return fail(409, "slot_full", { code: "slot_full" });
    if (b.lead_id && !leads.has(b.lead_id)) return lead404();
    const minutes = Number(b.duration_minutes) || 45;
    const bk = { id: uuid(), workspace_id: WS, lead_id: b.lead_id ?? null, calendar_id: b.calendar_id ?? CAL, appointment_number: bookings.size + 1, title: "Intro session", starts_at: at, ends_at: iso(starts + minutes * 60_000), timezone: b.timezone ?? calendar.timezone, lead_timezone: calendar.timezone, location: b.location ?? "Studio floor", notes: b.notes ?? "", meeting_type: "custom", meeting_location: "Studio floor", meeting_url: "", host_user_id: id(400), status: "confirmed", source: "api", notify_lead: b.notify_lead === true, is_arrival_window: false, service_details: null, created_at: iso(Date.now()), updated_at: iso(Date.now()), manage_url: "https://book.example/manage/new" };
    bookings.set(bk.id, bk);
    if (bk.lead_id) { const l = leads.get(bk.lead_id); l.stage_key = l.stage = "booked"; }
    return ok({ booking: bk }, 201);
  },
  reschedule_booking: ({ p, b }) => {
    const bk = bookings.get(p.booking_id);
    if (!bk) return fail(404, "Booking not found");
    if (bk.status === "cancelled") return fail(409, "This booking was cancelled");
    const starts = Date.parse(b.starts_at ?? "");
    if (Number.isNaN(starts)) return fail(400, "starts_at must be an ISO 8601 date and time");
    const at = iso(starts);
    if (at === FULL_SLOT || [...bookings.values()].some((x) => x.id !== bk.id && x.status !== "cancelled" && x.starts_at === at)) return fail(409, "slot_full", { code: "slot_full" });
    const minutes = Number(b.duration_minutes) || 45;
    Object.assign(bk, { starts_at: at, ends_at: iso(starts + minutes * 60_000), updated_at: iso(Date.now()) });
    return ok({ booking: bk });
  },
  cancel_booking: ({ p, b }) => {
    const bk = bookings.get(p.booking_id);
    if (!bk) return fail(404, "Booking not found");
    Object.assign(bk, { status: "cancelled", cancel_reason: b.reason ?? null, updated_at: iso(Date.now()) });
    return ok({ booking: bk });
  },
  update_booking: ({ p, b }) => {
    const bk = bookings.get(p.booking_id);
    if (!bk) return fail(404, "Booking not found");
    Object.assign(bk, b, { updated_at: iso(Date.now()) });
    return ok({ booking: bk });
  },
  toggle_ws_automation: ({ p, b }) => {
    const a = automations.get(p.automation_id);
    if (!a) return fail(404, "Automation not found");
    a.enabled = typeof b.enabled === "boolean" ? b.enabled : !a.enabled;
    return ok({ automation: a });
  },
  archive_conversation: ({ p }) => convo(p.lead_id, (l) => (l.inbox_archived = true)),
  unarchive_conversation: ({ p }) => convo(p.lead_id, (l) => (l.inbox_archived = false)),
  mark_conversation_read: ({ p }) => convo(p.lead_id, (l) => { l.unread = false; l.unread_count = 0; }),
  mark_conversation_unread: ({ p }) => convo(p.lead_id, (l) => { l.unread = true; l.unread_count = Math.max(1, l.unread_count); }),
};
function convo(leadId, change) {
  const l = leads.get(leadId);
  if (!l) return lead404();
  change(l);
  return ok({ conversation: conversationOf(l) });
}

/* Empty answer for a known list with no seed: { <last segment>: [], has_more: false }. */
function emptyList(op) {
  const segs = op.path.split("/").filter((s) => s && !s.startsWith("{") && s !== "v1");
  const key = (segs[segs.length - 1] ?? "items").replace(/-/g, "_");
  return ok({ [key]: [], has_more: false });
}

/* ------------------------------- server -------------------------------- */

const requests = [];
const idem = new Map(); // key -> { hash, answer }
const stableHash = (method, path, body) => createHash("sha256").update(`${method} ${path}\n${JSON.stringify(body ?? null)}`).digest("hex");

function send(res, { status, payload }) {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "X-Contacts-Limit": String(LIMITS.daily_unique_contact_cap),
    "X-Contacts-Used": String(LIMITS.unique_contacts_used),
    "X-Contacts-Remaining": String(LIMITS.unique_contacts_remaining),
    "X-RateLimit-Remaining": "119",
  });
  res.end(text);
}

function handle(method, url, headers, body) {
  if (url.pathname === "/__requests") {
    if (method === "GET") return ok({ requests });
    if (method === "DELETE") { requests.length = 0; return ok({ cleared: true }); }
    return fail(405, "Use GET or DELETE");
  }
  const key = headers["idempotency-key"];
  requests.push({ method, path: url.pathname + url.search, idempotencyKey: key ?? null, body: body ?? null, at: iso(Date.now()) });

  if (!/^Bearer \S+$/.test(headers.authorization ?? "")) return fail(401, "Missing or invalid API key");
  const { op, params, pathKnown } = route(method, url.pathname);
  if (!op) return pathKnown ? fail(405, "Method not allowed") : notFound();

  if (method === "GET") {
    const h = READS[op.id];
    return h ? h({ p: params, q: url.searchParams }) : op.names.length && op.path.endsWith("}") ? notFound() : emptyList(op);
  }

  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  if (key) {
    const hash = stableHash(method, url.pathname, body);
    const prior = idem.get(key);
    if (prior) return prior.hash === hash ? prior.answer : fail(409, "idempotency_key_reused", { code: "idempotency_key_reused" });
    const answer = (WRITES[op.id] ?? (() => ok({ ok: true })))({ p: params, b, q: url.searchParams });
    idem.set(key, { hash, answer });
    return answer;
  }
  return (WRITES[op.id] ?? (() => ok({ ok: true })))({ p: params, b, q: url.searchParams });
}

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, fail(413, "Request body too large")); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", () => {
    if (res.writableEnded) return;
    let body;
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw) {
      try { body = JSON.parse(raw); } catch { return send(res, fail(400, "Body is not valid JSON")); }
    }
    try {
      send(res, handle(req.method ?? "GET", new URL(req.url ?? "/", `http://${HOST}:${PORT}`), req.headers, body));
    } catch (e) {
      send(res, fail(500, `Mock error: ${e instanceof Error ? e.message : String(e)}`));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`zu-mock on http://${HOST}:${PORT} (${OPS.length} operations, ${leads.size} invented leads). GET /__requests to inspect.`);
});
