# RD: Agency CRM on Zuops

Owner ask (2026-11-11): the agency portal becomes a full CRM whose data backbone is Zuops. "conversations, messaging, outreach emails, lead staging, all of it thats available in zuops needs to be in my app."

Spec: `openspec/changes/agency-crm-zuops/` (proposal, design, tasks). API reference: `https://api.usezu.com/llms.txt`.

## Users
Lawrence and admins of the Pulse agency. Nobody else: not agency staff, not studio owners, not other agencies.

## Requirements

1. **R1 Access.** `/agency/crm` opens only for an owner or admin of the Pulse platform agency. Every Convex function behind it enforces the same rule on the server.
2. **R2 One truth.** Everything shown comes from Zuops. Every change is made in Zuops first. If Zuops refuses a change, Pulse shows why and changes nothing.
3. **R3 Fresh.** A change made in the Zuops app shows in Pulse within one minute without a reload (within seconds once the webhook is registered). Each screen states when it last synced.
4. **R4 Leads.** Find, filter, create and edit leads, including custom fields, tags, notes, deal value and won or lost.
5. **R5 Pipeline.** See leads by stage and move them; manage stages.
6. **R6 Inbox.** Read every conversation, send a text or email, schedule one, manage scheduled ones, mark read, archive, pause the AI, act on AI suggested replies.
7. **R7 Calendar.** See appointments, open slots and calendars; book, move, cancel and record outcomes.
8. **R8 Campaigns, automations, forms, calls.** See each with its numbers; send or stop a campaign; switch an automation on or off; enroll or remove leads; read form submissions; read a call's summary and transcript.
9. **R9 Dashboard and settings.** The Zuops overview numbers, health score, usage and setup checklist; the account settings Zuops exposes.
10. **R10 Safe sending.** Nothing is sent unless a person presses Send. Bulk actions state how many people they reach and ask first. A retry never sends twice. Opted-out contacts cannot be messaged.
11. **R11 Safe environments.** Staging cannot write to Zuops.
12. **R12 Honest limits.** A control the current key cannot perform is visible but disabled, and says what it needs.
13. **R13 Secrets.** No key or signing secret reaches the browser, a log, or the repo.
14. **R14 Fit.** It looks and behaves like the rest of the agency console, works at 390 px, in Chromium, Firefox and WebKit, and with reduced motion.
