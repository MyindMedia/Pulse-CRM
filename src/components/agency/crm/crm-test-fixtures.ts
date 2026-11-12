/* Invented people and studios for the CRM UI tests. Not real leads. */
import type { HealthScore, Lead, Overview, SetupStatus, Stage } from "./zu-types";

export const STAGES: Stage[] = [
  { id: "s1", key: "new", label: "New", color: "blue", behavior: "new", position: 0, is_system: true, hidden: false },
  { id: "s2", key: "contacted", label: "Contacted", color: "amber", behavior: "contacted", position: 1, is_system: true, hidden: false },
  { id: "s3", key: "booked", label: "Booked", color: "cyan", behavior: "booked", position: 2, is_system: true, hidden: false },
  { id: "s4", key: "won", label: "Won", color: "emerald", behavior: "won", position: 3, is_system: true, hidden: false },
  { id: "s5", key: "lost", label: "Lost", color: "rose", behavior: "lost", position: 4, is_system: true, hidden: true },
];

export const MAYA: Lead = {
  id: "lead-maya",
  full_name: "Maya Okafor",
  email: "maya@northline.example",
  phone: "+12135550142",
  source: "smart_form",
  status: "booked",
  stage: "booked",
  stage_key: null,
  inquiry: "Northline Sound, demo",
  tags: ["Demo booked"],
  custom_fields: {},
  deal_value_cents: 118800,
  deal_currency: "USD",
  existing_customer: false,
  created_at: "2026-11-01T17:00:00Z",
  last_activity_at: "2026-11-10T23:12:00Z",
};

export const DEV: Lead = {
  id: "lead-dev",
  full_name: "Dev Raman",
  email: "dev@cedarroom.example",
  phone: "+13235550177",
  source: "instagram",
  status: "contacted",
  stage: "contacted",
  inquiry: "Cedar Room Audio",
  tags: [],
  deal_value_cents: null,
  deal_currency: "USD",
  existing_customer: false,
  created_at: "2026-11-02T17:00:00Z",
  last_activity_at: "2026-11-09T16:40:00Z",
};

export const OVERVIEW: Overview = {
  window: { from: "2026-10-12T00:00:00Z", to: "2026-11-11T00:00:00Z", days: 30 },
  stats: {
    leads: 10, prev_leads: 2, new_unworked: 6, appointments: 1, prev_appointments: 0, booked_leads: 1, prev_booked_leads: 1,
    won: 0, median_response_minutes: 0.08, upcoming_appointments: 2,
    stage_reach: { total: 10, reached: { new: 10, contacted: 4, booked: 1 } },
  },
};

export const HEALTH: HealthScore = {
  score: 58,
  grade: "Needs attention",
  verdict: "Leads are answered fast, but few book.",
  factors: [
    { key: "speed", label: "Speed to lead", weight: 25, earned: 25, applies: true, value: "5 s median" },
    { key: "booking", label: "Booking rate", weight: 25, earned: 6, applies: true, hint: "Offer a time in the first text." },
    { key: "coverage", label: "Coverage", weight: 15, earned: 0, applies: false },
  ],
  actions: [{ key: "waiting", title: "Reply to 2 waiting leads", why: "They wrote and nobody answered.", gain: 8, urgent: true }],
};

export const SETUP: SetupStatus = {
  findings: [
    { severity: "low", title: "Missed-call text-back is off.", fix: "PATCH /v1/ai-texting with missed_call_text: true" },
    { severity: "medium", title: "The AI agent has no FAQ or business description.", fix: { call: "POST /v1/knowledge-base", tool: "add_knowledge_base" } },
    { severity: "low", title: "No client user has been invited.", fix: { call: "POST /v1/members", scope: "members:admin" } },
    { severity: "low", title: "No website widget is enabled.", app_only: true },
  ],
};
