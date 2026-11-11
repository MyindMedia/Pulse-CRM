# Eval: Agency CRM on Zuops
Status: draft            <!-- draft → in-review → approved → passing -->
Risk: high: "if it breaks, a stranger could read lead phone numbers and emails, or a lead could get a text nobody meant to send"
RD: ./rd.md · Mockup: ./mockup.html · Branch: feat/agency-crm-zu · Spec: openspec/changes/agency-crm-zuops/

## Must not break
- Agency console: `/agency`, `/agency/outreach` (all ten tabs), `/agency/email`, `/agency/signups`, nav at 834 px and 1280 px
- Zuops demo booking sync: `zuops-sync` cron, `POST /zuops/events`, `outreachBookings`, Outreach Meetings and Links
- Confirmation calls (`outreachCalls`), Zuops SMS provider (`lib/zuopsSms.ts`, `sms-zuops-inbound` cron)
- `npm run check` (tsc, eslint, vitest) with no new failures beyond the two known ones in `docs/ENVIRONMENTS.md`

## Checks

### Access and data exposure
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| A-01 | Signed-out caller gets nothing from any `crm*` query | convex-test: call every exported query with no identity → `null`; every mutation and action → FORBIDDEN | PENDING | |
| A-02 | Studio member gets nothing | convex-test with a studio identity → same as A-01 | PENDING | |
| A-03 | Agency staff (not owner or admin) gets nothing | convex-test with role `staff` → `null` / FORBIDDEN | PENDING | |
| A-04 | Owner of a different agency gets nothing | convex-test: second agency, owner identity → `null` / FORBIDDEN | PENDING | |
| A-05 | Pulse agency owner and admin get data | convex-test → rows returned | PENDING | |
| A-06 | No function accepts `agencyId` or `workspace_id` from the client | grep the args validators of every `crm*` export | PENDING | |
| A-07 | No key or secret in the client bundle | `next build`, then grep `.next/static` for `zu-`, `ZUOPS_CRM`, the webhook secret value | PENDING | |
| A-08 | Message bodies, transcripts and recording URLs are not written to any table | grep inserts and patches in `convex/crm*`; convex-test opens a thread then scans all `crm*` tables for the body text | PENDING | |
| A-09 | `/agency/crm` for a non-member renders Unauthorized, not data | browser as a studio user on local demo | PENDING | |

### Client and sync
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| S-01 | Client only calls `https://api.usezu.com/v1/...` | unit test collects every URL; path traversal and non-`/v1/` paths refused | PENDING | |
| S-02 | Each documented error (400, 401, 402, 403 scope_denied, 403 account_locked, 404, 409, 429 with Retry-After, 503, 5xx, timeout) maps to a clear reason and never throws raw | unit tests per status | PENDING | |
| S-03 | Reconcile fills leads, stages, conversations and appointments from Zuops | convex-test with mocked fetch fixtures → table counts and fields match | PENDING | |
| S-04 | Reconcile is idempotent and bounded | run twice → no duplicates; assert at most 6 requests per run | PENDING | |
| S-05 | A lead deleted or changed in Zuops is reflected | fixture changes between two runs → mirror row updated or removed | PENDING | |
| S-06 | Live read works against the real sub-account | dev deployment, read only: counts on the Dashboard equal `GET /v1/overview` and `GET /v1/leads` | PENDING | |
| S-07 | No unbounded `.collect()` and every list query uses an index | review the diff; list queries paginate | PENDING | |

### Webhook
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| W-01 | No secret set → 503 | `t.fetch("/zu/events")` | PENDING | |
| W-02 | Missing or wrong signature → 401, nothing scheduled | `t.fetch` with a bad `X-Webhook-Signature` | PENDING | |
| W-03 | Valid signature → 202 and the named record is re-read from Zuops | `t.fetch` signed with WebCrypto; assert the follow-up GET | PENDING | |
| W-04 | Replayed delivery id → 200 ignored, no second fetch | send the same `X-Webhook-Delivery` twice | PENDING | |
| W-05 | Body content is never written directly | signed body carries a fake name; mirror shows the name Zuops returns | PENDING | |
| W-06 | Body over 256 KB → 413 | `t.fetch` with a large body | PENDING | |
| W-07 | Existing `/zuops/events` still passes its own tests | `vitest run convex/outreachZuops.test.ts` | PENDING | |

### Writes and sending
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| X-01 | With `ZUOPS_CRM_WRITES` unset every write action refuses and makes no request | convex-test: each write → "read only", zero fetch calls | PENDING | |
| X-02 | Every write carries an `Idempotency-Key` and a retry reuses it | unit test on request headers; UI test: double click Send → one request | PENDING | |
| X-03 | A refused write leaves the mirror unchanged and shows the reason | mocked 409 and 400 → table unchanged, reason returned | PENDING | |
| X-04 | Send text and send email reach Zuops with the right lead and channel | mocked fetch asserts the body; email without a subject is refused before the call | PENDING | |
| X-05 | Opted-out lead, or one with no phone or email for the channel, cannot be messaged | composer disabled with reason; action refuses | PENDING | |
| X-06 | Campaign send, send rest, automation enable and enroll need a confirm that states the count | browser: dialog shows the number; cancel sends nothing | PENDING | |
| X-07 | No cron, webhook or scheduled function in Pulse calls a sending endpoint | grep `crons.ts` and `crm/webhook.ts` call graph for `/v1/messages`, `/send`, `/enroll` | PENDING | |
| X-08 | Admin-only controls are disabled without `ZUOPS_CRM_ADMIN_KEY` and say why | browser + convex-test: action refuses with "Needs a Full access key" | PENDING | |
| X-09 | Each send writes an audit row with actor, action and lead id, and no body | convex-test reads `outreachEvents` | PENDING | |
| X-10 | Live write round trip, owner present, production only after approval: add a note to one test lead, see it in Zuops and in Pulse | manual with Lawrence; never on staging | PENDING | |

### Screens
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Dashboard shows overview, health score, usage, limits and setup checklist | screenshot vs mockup, numbers match the API | PENDING | |
| U-02 | Leads: search, each filter, pagination, create, edit, tags, custom fields, note, deal, won and lost | browser walk-through on a dev deployment with fixtures | PENDING | |
| U-03 | Pipeline: drag moves a lead; a refusal snaps it back with the reason | browser, mocked 409 | PENDING | |
| U-04 | Inbox: list filters, thread loads, send, schedule, edit and cancel scheduled, mark read, archive, AI pause, suggested reply approve and dismiss | browser walk-through | PENDING | |
| U-05 | Calendar: appointments, slots, book, reschedule, cancel, outcome | browser walk-through | PENDING | |
| U-06 | Campaigns, Automations, Forms, Calls and Settings each list real data and their actions work | browser walk-through per tab | PENDING | |
| U-07 | Every tab has loading, empty, error, read-only and unauthorized states | screenshots of each state | PENDING | |
| U-08 | "Synced N seconds ago" and Refresh on every tab; Refresh is rate limited | browser; second click within 30 s refused | PENDING | |
| U-09 | Phone 390 px: no horizontal scroll; list then detail with Back; targets at least 44 px | screenshots at 390 px, overflow check | PENDING | |
| U-10 | Keyboard only: tabs, table rows, sheet, dialog, composer all reachable; focus visible; status never by color alone | manual pass + axe | PENDING | |
| U-11 | Reduced motion: no drag animation or transitions required to use it | emulate `prefers-reduced-motion` | PENDING | |
| U-12 | Cross-browser | `node tools/browser-check/check.mjs <staging url>/agency/crm` PASS table | PENDING | |

### Performance
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| P-01 | CRM tab code is not in the agency shell bundle | `next build` route sizes: `/agency` unchanged within 2 KB | PENDING | |
| P-02 | Leads list first page renders from the mirror with no Zuops call | network panel: zero action calls on open when fresh | PENDING | |
| P-03 | Reconcile uses at most 6 Zuops requests a minute | S-04 | PENDING | |

### Regression
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| R-01 | Outreach tab unchanged | `vitest run -c vitest.outreach.config.ts`; screenshot diff of Meetings | PENDING | |
| R-02 | Agency nav fits at 834 px with the new link | screenshot, overflow check | PENDING | |
| R-03 | `npm run check` | command output | PENDING | |
| R-04 | `/security-review` on the diff | report | PENDING | |
| R-05 | Pentest of staging `/agency/crm` and `/zu/events` | `/pentest` report URL | PENDING | |

## Liability layer
Tier: High (personal data of leads; messaging). The CRM is behind sign-in and adds no public page, tracker, cookie or form, so LL-01 to LL-14 are unchanged from the current site. Applies here: LL-16 data map (design.md, Data flow), LL-17 incident plan (existing), LL-18 security basics (A-01 to A-08, W-01 to W-06). Legal review needed: yes, because it is High tier and adds a way to send texts and emails to leads.

## Decisions made without asking
1. **Access is Pulse agency owner and admin only**, the same as the Email tab. Agency staff do not see it.
2. **Phase 1 and phase 2.** Phase 1 is leads, pipeline, inbox, calendar, campaigns, automations, forms, calls, dashboard and settings. Invoices, reviews, contracts, proposals, reports, short links, website widget, media, AI Brain and ads come in a second change.
3. **Sends are human only**, with a confirm step on anything bulk.
4. **Staging is read only against Zuops** (`ZUOPS_CRM_WRITES` unset), because staging and production would share your one real sub-account.
5. **Full phone and email are shown in the CRM** to owner and admin. The Outreach tab keeps hiding the phone.
6. **Message bodies, transcripts and recordings are fetched when opened and never stored in Convex.** Leads, stages, conversation summaries and appointments are mirrored.
7. **Automations can be switched and enrolled, not built**, in phase 1. Building steps stays in the Zuops app.
8. **The Outreach tab is not changed.** It stays the prospecting tool in front of the CRM.
9. **New env names** `ZUOPS_CRM_API_KEY`, `ZUOPS_CRM_ADMIN_KEY`, `ZUOPS_CRM_WEBHOOK_SECRET`, `ZUOPS_CRM_WRITES`, separate from the existing `ZUOPS_API_KEY` so the demo-booking sync is untouched.
10. **A new webhook route `/zu/events`** rather than widening `/zuops/events`.

## Needs from the owner
- A **Full access key** (Zuops → Settings → API), saved as field `API Full` on `op://Security/Zuops Pulse OS`. Unlocks webhooks (live updates), deletes, team invites, alert recipients.
- "approved" on this file and the mockup.
