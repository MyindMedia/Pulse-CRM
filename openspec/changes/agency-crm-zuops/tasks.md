## 0. Gate
- [x] 0.1 Read the API reference (`https://api.usezu.com/llms.txt`) and probe the live sub-account read only
- [x] 0.2 Proposal, design, requirements, eval and mockup written
- [x] 0.3 Owner approves `specs/features/agency-crm-zuops/eval.md` and the mockup (Status: approved)

## 1. Slice A: backbone
- [x] 1.1 `convex/crm/zu.ts`: client, error mapping, injectable fetch; unit tests for every status in the reference
- [x] 1.2 (superseded by the pass-through design: no parsers; registry in `convex/crm/ops.generated.ts`) `convex/crm/parse.ts`: lead, stage, conversation, appointment parsers; tests from recorded fixtures with invented people
- [x] 1.3 `convex/crm/tables.ts`: `crmLeads`, `crmStages`, `crmConversations`, `crmAppointments`, `crmSnapshots`, `crmDeliveries`, `crmSync`; spread into `schema.ts`
- [x] 1.4 `convex/crm/access.ts`: `crmAccess`, `requireCrm`, `requireCrmWrite`; tests for signed out, studio member, staff, other agency, owner
- [x] 1.5 (superseded: no reconcile; `crmPulses` signal instead) `convex/crmSync.ts`: reconcile action, cursors, upserts; `crons.ts` entry `crm-zu-reconcile`
- [x] 1.6 `convex/crm/webhook.ts` and route `/zu/events`: signature, size cap, delivery de-dupe, targeted re-read; tests for bad signature, replay, unknown event, oversized body
- [x] 1.7 `convex/crm.ts`: `access`, `status`, `refresh`, `snapshot`

## 2. Slice B: leads and pipeline
- [x] 2.1 `convex/crmLeads.ts`: `list` (paginated, indexed filters), `get`, `timeline` (action), `create`, `update`, `addNote`, `setStage`, `setTags`, `setDeal`
- [x] 2.2 Stage admin: add, rename, recolor, hide, reorder; pipelines and deals
- [x] 2.3 UI: Leads table with filters, lead Sheet (details, custom fields, tags, deal, notes, timeline), New lead dialog
- [x] 2.4 UI: Pipeline board with drag to move, optimistic with rollback on refusal

## 3. Slice C: inbox and messaging
- [x] 3.1 `convex/crmInbox.ts`: `conversations`, `thread` (action), `send`, `schedule`, `scheduled`, `editScheduled`, `sendNow`, `markRead`, `archive`, `aiPause`, `suggestions`, `decideSuggestion`, `replyIdeas`, `limits`
- [x] 3.2 UI: three-pane inbox, composer (channel, sender, variables, schedule), scheduled bubbles, contact limit meter, suggested reply cards
- [x] 3.3 Send audit rows in `outreachEvents`

## 4. Slice D: calendar
- [x] 4.1 `convex/crmCalendar.ts`: `calendars`, `availability` (action), `appointments`, `book`, `reschedule`, `cancel`, `setOutcome`, `busyBlocks`, `hours`
- [x] 4.2 UI: agenda and week views, Book dialog (lead, calendar, slot), appointment Sheet

## 5. Slice E: the rest
- [x] 5.1 Dashboard: overview, health score, usage, limits, setup checklist
- [x] 5.2 Campaigns: list, results, edit draft, send or schedule with confirm, stop, duplicate
- [x] 5.3 Automations: list, toggle with confirm, enrollments, enroll and unenroll with confirm, results
- [x] 5.4 Forms: list, submissions, publish
- [x] 5.5 Calls: log, one call (transcript, recording), AI campaigns and pause
- [x] 5.6 Settings: profile, numbers, team, tags, custom fields, lead sources, alerts, routing, AI texting, receptionist, knowledge base, follow-ups, appointment emails, webhooks

## 6. Proof
- [ ] 6.1 `npm run check` clean
- [ ] 6.2 Every eval check PASS with evidence
- [ ] 6.3 `/security-review` on the diff; pentest (`/pentest`) against staging
- [ ] 6.4 Browser check: Chromium, Firefox, WebKit, phone widths
- [ ] 6.5 PR into `develop`; staging verified read only; owner tests
- [ ] 6.6 Owner says ship: `ZUOPS_CRM_API_KEY`, `ZUOPS_CRM_WRITES=on` on production, register the webhook, promote

## 7. Follow-ups (not this change)
- [ ] 7.1 Move `convex/outreach/zuops.ts` and `convex/lib/zuopsSms.ts` onto the shared client and the `api.usezu.com` host
- [ ] 7.2 "Send to CRM" on an Outreach prospect
- [ ] 7.3 Phase 2 surfaces (invoices, reviews, contracts, proposals, reports, short links, widget, media, AI Brain, ads)
