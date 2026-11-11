## Why

Owner request, 2026-11-11: "build out the full agency crm so I can manage our back end but zuops will be the back bone of the data", then "conversations, messaging, outreach emails, lead staging, all of it thats available in zuops needs to be in my app".

Today Pulse reads three things from Zuops: demo bookings, the demo calendar, and the lead behind a booking (`convex/outreachZuops.ts`), plus an SMS send path (`convex/lib/zuopsSms.ts`). Everything else in the Pulse OS sub-account (22 leads, a 5-stage pipeline, 15 conversations, 14 automations, the smart form, email campaigns, calls) can only be worked in the Zuops app. The owner wants to run the agency back end from `/agency` without leaving Pulse.

## What Changes

A new agency tab, **CRM** (`/agency/crm`), that is a full working front end for the Zuops sub-account. Zuops stays the system of record. Pulse never holds a CRM fact that Zuops does not.

Phase 1 (this change):

- **Dashboard**: new leads, booked, appointments, speed to lead, stage reach, calls, each against the previous window (`GET /v1/overview`), the health score with its five factors (`GET /v1/health-score`), credits used (`GET /v1/usage`), today's contact limit (`GET /v1/messages/limits`) and the setup checklist (`GET /v1/setup-status`).
- **Leads**: list with search, status, stage, tag, assignee and source filters; create; edit every lead field including custom fields, tags and deal value; notes with mentions; timeline; mark won or lost; do not contact.
- **Pipeline**: a stage board (drag a lead to move it), add, rename, recolor, hide and reorder stages, extra pipelines and deals.
- **Inbox**: conversations with unread, archived and assigned filters; the full thread (texts, emails, DMs, calls, voicemails, notes); send a text or email; schedule a message; edit, cancel or send a scheduled message now; mark read or unread; archive; pause the AI on one lead; approve or dismiss AI suggested replies; reply ideas.
- **Calendar**: calendars and their settings, open slots, the appointment list, book for a lead, reschedule, cancel, record the outcome (completed, no show), change host, busy blocks, business hours.
- **Campaigns**: email campaigns with their results; edit a draft; send or schedule; stop; duplicate.
- **Automations**: list with run and error counts, on and off, who is inside one, enroll and unenroll leads, results per step.
- **Forms**: smart forms with views and submissions, the submission list, publish and edit.
- **Calls**: call log with outcome and summary, one call with transcript and recording, AI calling campaigns and pause.
- **Settings**: business profile, phone numbers and texting registration, team, tags, custom fields, lead sources, alert recipients, lead routing, AI texting, AI receptionist, knowledge base, follow-up sequence, appointment emails, outbound webhooks.

Phase 2 (planned, separate change, not built here): invoices, estimates and Stripe payments, reviews, contracts and proposals, reports, short links, website widget, media library, AI Brain photos and prices, ad insights and Google tools, reward games, surveys.

Plumbing:

- One shared, typed Zuops client (`convex/crm/zu.ts`) on the current host, `https://api.usezu.com`. The two existing clients (`convex/outreach/zuops.ts`, `convex/lib/zuopsSms.ts`) move onto it in a later task with their tests; nothing about their behavior changes in this change.
- A Convex mirror of the high-volume records (leads, stages, conversations, appointments) so the screens are reactive and paginated; everything else is read through a short-lived snapshot.
- A webhook receiver for all eleven Zuops events, HMAC verified, de-duplicated by delivery id, plus a one-minute reconcile as the safety net.
- Every write goes to Zuops first with an `Idempotency-Key`; the mirror is updated from what Zuops answers.

## Non-goals

- A second copy of the truth. No Pulse-only lead fields, stages or notes.
- Automated sending started by Pulse. A text or email leaves only when a person presses Send; bulk actions (campaign send, automation enroll) need a confirm step that states the recipient count.
- Building or editing automation steps (needs a Full access key and the Zuops builder covers it). Phase 1 lists, toggles and enrolls.
- Changing the Outreach tab. It stays the pre-lead prospecting tool; its Meetings and Links panels keep reading `outreachBookings`.
- Per-studio CRM. This is the Pulse agency's own back end, not a feature for sub-accounts.
- Phase 2 list above.

## Impact

- Convex: new `convex/crm/` (client, parsers, tables, webhook), `convex/crm.ts`, `convex/crmLeads.ts`, `convex/crmInbox.ts`, `convex/crmCalendar.ts`, `convex/crmAdmin.ts`, `convex/crmSync.ts`; five new tables; one new HTTP route `/zu/events`; one new cron. No change to existing tables.
- Web: `src/app/agency/crm/page.tsx`, `src/components/agency/crm/*`, one nav link in `src/app/agency/layout.tsx`.
- Env (Convex): `ZUOPS_CRM_API_KEY`, `ZUOPS_CRM_WEBHOOK_SECRET`, `ZUOPS_CRM_WRITES` (`on` enables writes; unset is read only), optional `ZUOPS_CRM_ADMIN_KEY`.
- Risk: High. Convex functions return lead personal data, and the Inbox sends real texts and emails that cost credits.
