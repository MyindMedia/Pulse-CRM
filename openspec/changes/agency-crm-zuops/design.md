## Context

Verified against the live sub-account on 2026-11-11 with read-only GETs:

- Host `https://api.usezu.com`, paths `/v1/...`, envelope `{ success, data, error }`. The key in 1Password (`op://Security/Zuops Pulse OS/API`) answers 200 here.
- The key is now locked to one sub-account, Pulse OS (`e56bf309-bede-486f-b4b5-1948248b3839`). `GET /v1/workspaces` returns only it. The older note that the key also sees another workspace no longer holds on this host.
- Key access level is `write` (Read and write). It cannot call anything scoped `:admin`: outbound webhooks, lead delete, stage and pipeline delete, team invites, alert recipients, automation build or edit.
- Rate limit 600 per minute on this key.
- Live counts: 22 leads, 5 stages (new, contacted, booked, won, lost), 1 calendar, 15 conversations, 14 automations (3 on), 1 smart form, 3 tags, 1 member, 0 calls, 1 outbound webhook (disabled, pointed at the retired Bland receiver).
- Webhook signature header in the current reference is `X-Webhook-Signature: sha256=<hex>`, with `X-Webhook-Event` and `X-Webhook-Delivery`. The existing receiver reads `x-zuops-signature` and `x-zuops-event`.

## Decisions

### D1. Who can open it
The Pulse platform agency only, owner or admin, the same rule as the Email tab. `crmAccess(ctx)` = `agencyScope(ctx)` and `canManage` and `agencyId === platformAgencyId(ctx)`. Queries return `null` for anyone else and the UI shows the Unauthorized state. `agencyId` is never a client argument.

### D2. Zuops is the record, Convex is a mirror
- Mirrored (indexed, paginated, reactive): `crmLeads`, `crmStages`, `crmConversations`, `crmAppointments`.
- Snapshot (one row per resource, the JSON kept as a string so a large payload never hits the 1,024-field return limit): overview, health score, usage, limits, setup status, calendars, automations, forms, campaigns, calls, tags, members, custom fields, phone numbers, settings blocks. Refreshed on open when older than 60 seconds and after any write that touches it.
- Read on demand, never stored: a lead's thread and timeline (message bodies), one call's transcript and recording URL, form submissions. They are fetched by an action when the pane opens and live only in the browser session.
- A write is: action checks access and the write switch, calls Zuops with an `Idempotency-Key`, then upserts the mirror from the response. If Zuops refuses, nothing in Convex changes and the reason is shown.

### D3. Staying in sync
1. Webhook `POST /zu/events`: 503 when no secret is set, 413 over 256 KB, HMAC over the raw body compared in constant time (accepts `X-Webhook-Signature` and the older `X-Zuops-Signature`), de-duplicated on `X-Webhook-Delivery` (`crmDeliveries`, 7 day retention). The body is used only to pick what to re-read: the lead, conversation or appointment id. The record is then fetched from Zuops with our key, so a forged or replayed body cannot plant data.
2. Reconcile cron, every minute: leads updated since the last cursor, conversations first page, appointments in a 30 day back and 90 day forward window, messages by `cursor`. At most 6 GETs per run, well under the 600 per minute limit. It is the only sync path until the webhook is registered.
3. A manual Refresh button, rate limited to once per 30 seconds per agency.

### D4. One client
`convex/crm/zu.ts`: `zu(method, path, { query, body, idempotencyKey, admin }, fetchImpl)`. Path must start `/v1/` and contain no `..`. 20 second timeout. Returns `{ ok: true, data, headers }` or `{ ok: false, status, code, reason, retryAfter }`, mapping 400, 401, 402, 403 (`scope_denied`, `account_locked`), 404, 409, 429 and 5xx to short human reasons. The key never leaves the server; the browser only learns `keyConfigured`, `writesOn`, `adminKey`, `webhookConfigured`.

### D5. Keys and switches
- `ZUOPS_CRM_API_KEY`: the Read and write key.
- `ZUOPS_CRM_ADMIN_KEY` (optional): a Full access key. Without it every admin-only control renders disabled with "Needs a Full access key".
- `ZUOPS_CRM_WEBHOOK_SECRET`: the signing secret shown once when the webhook is created.
- `ZUOPS_CRM_WRITES=on`: only then do write actions run. Staging leaves it unset, because staging would otherwise write to the one real sub-account.

### D6. Sending
- Human only. No cron, webhook or automation in Pulse sends a message.
- The composer shows the channel, the sender number or address, the remaining daily contact slots, and refuses up front when the lead has opted out or has no phone or email for the channel (Zuops also refuses with 400).
- Campaign send, send rest, automation enable and automation enroll open a confirm dialog that states the recipient count and that it reaches real people.
- Every send is logged in `outreachEvents` (actor, action, lead id, channel; never the body).

### D7. Personal data
- Lead phone and email are shown in full to owner and admin in the CRM, because the job is to call and text them. This differs from `outreachBookings`, which never returns the phone; that rule stays for the Outreach tab.
- Message bodies, transcripts and recordings are not stored in Convex (D2).
- Logs and events carry ids only.

### D8. Outreach tab and the existing sync
Unchanged. `outreachBookings`, the confirmation calls and the `zuops-sync` cron keep running. The CRM Calendar is the full booking surface; the Outreach Meetings panel stays as the demo-only view. A later task adds "Send to CRM" on a prospect (creates a Zuops lead).

### D9. UI
Ten Radix tabs under `/agency/crm`, the Outreach pattern. Existing primitives only (`ui/tabs`, `ui/table`, `ui/sheet`, `ui/dialog`, `ui/field`, `ui/badge`, `ui/feedback`, `ui/stat-tile`), the Email tab's three-pane layout for Inbox, the studio pipeline's dnd-kit board for Pipeline, existing `charts.tsx` for the dashboard. Hardware UI (`.pulse-hw`) applies through the agency layout. Status is always a word and an icon, never color alone. Phone width: list first, detail full width with Back.

## Data flow (compliance record, not legal advice)

| Data | From | Through | Stored | Seen by |
|---|---|---|---|---|
| Lead name, email, phone, address, tags, deal value | Zuops | Convex action or webhook-triggered fetch | `crmLeads` | Pulse agency owner, admin |
| Conversation summary (last message preview, unread) | Zuops | same | `crmConversations` | same |
| Message bodies, call transcripts, recordings | Zuops | Convex action, on open | not stored | same |
| Appointments | Zuops | same | `crmAppointments` | same |
| Outbound text or email typed by a person | browser | Convex action | not stored | Zuops sends it |

No AI model is in this path. Consent and opt-out are enforced by Zuops at send time and checked again in the composer. Texting consent (TCPA) and CAN-SPAM remain the sender's responsibility: Pulse adds no new sending capability that Zuops does not already gate.

## Risks

- Staging and production share one Zuops sub-account. Mitigation: D5 write switch, staging read only.
- Webhook cannot be registered with the current key. Mitigation: reconcile cron is sufficient at this volume; queue the Full access key.
- Double sends on retry. Mitigation: `Idempotency-Key` per logical send, generated in the browser when the composer opens, reused on retry.
- Mirror drift. Mitigation: every screen shows "synced N seconds ago" and a Refresh; the cron re-reads on a cursor.

## Addendum 2026-11-11: every Zuops function, pass-through instead of a mirror

Owner after approval: "every single function that can be used in my pulse crm that exists in zuops should be configured", social media included. The Zuops OpenAPI spec lists 352 operations in 32 areas. This addendum replaces D2 and D3 and extends D4.

### D2 (replaces). Pass-through, nothing stored
Every screen reads Zuops live through one Convex action. Convex stores no lead data: no mirror tables, no snapshots. Reasons: 352 operations cannot each have a mirror; a mirror is a second copy that drifts; and holding no personal data is the smaller risk. Cost: a screen load is one to three API calls (about 300 to 600 ms each) instead of a reactive query. The browser keeps a 30 second in-memory cache and refetches on a signal, after its own writes, on focus, and every 60 seconds while visible.

### D3 (replaces). Signal instead of sync
`POST /zu/events` verifies the HMAC, de-duplicates on the delivery id, and inserts one `crmPulses` row: event name, lead id, booking id, message id, time. No names, no bodies. `crm.signal` returns the newest pulse time per kind; open screens subscribe to it and refetch what changed. Without a registered webhook the 60 second refresh covers it. There is no reconcile cron and no cursor.

### D11. Operation registry
`scripts/zu-ops.mjs` reads `https://api.usezu.com/openapi.json` and `llms.txt` (for scopes) and writes `convex/crm/ops.generated.ts`: for each operation its id, method, path, area, summary, scope, path parameters, query fields and body fields (name, type, required, enum, short description). `--check` fails when the live spec and the file differ, so a new Zuops function shows up as a failing check, then a regenerate.

`crm.call({ op, path, query, body, idem, confirm })` is the only way out:
1. access (D1); 2. op must be in the registry; 3. path values must match `^[A-Za-z0-9_.:@-]{1,128}$` and are URL-encoded; 4. query and body keys must be registry fields (`workspace_id` is dropped, never sent); 5. non-GET needs `ZUOPS_CRM_WRITES=on`; 6. `:admin` scope needs `ZUOPS_CRM_ADMIN_KEY`; 7. operations that reach people, and every DELETE, need `confirm: true`; 8. every non-GET gets an `Idempotency-Key` (the caller's, else generated) and an audit row (actor, op, path ids; never the body).
The answer is `{ ok, status, json (a string), reason, code, limits }`. JSON travels as a string so a large payload never meets Convex's 1,024-field limit.

### D12. Operations that reach people
Flagged `reaches` in `convex/crm/policy.ts` (an explicit list, checked by a test against the registry so a renamed operation fails loudly): send message, send scheduled now, approve suggested reply, email campaign send and send rest, automation enroll and toggle, estimate send, contract send, proposal send, report send and test email, reward game send, survey send, Google Business post approve and publish, review reply, support ticket message and reply, iMessage reaction. Booking, rescheduling and cancelling notify the lead by design and are single, deliberate actions, so they are not double-confirmed but are audited.

### D13. Screens
Curated: Dashboard, Leads, Pipeline, Inbox, Calendar, Social. Config-driven (one generic resource component, one config entry per resource): Campaigns, Automations, Forms, Calls, Settings, and More (invoices and estimates, reviews, contracts, proposals, reports, short links, widget, media, AI Brain, ads and Google, reward games, surveys, support, offers). Functions: a searchable catalog of all 352 operations, each with a form built from the registry, for anything a curated screen does not surface.

### Tables
Only `crmPulses { agencyId, event, deliveryId, leadId?, bookingId?, messageId?, at }` with `by_agency_at` and `by_delivery`. Pruned daily to 7 days. Audit rows go to the existing `outreachEvents`.
