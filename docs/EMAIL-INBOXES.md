# Email inboxes (Agency > Email)

A shared inbox for studiopulse.tech inside the Agency Command Center, at `/agency/email`.

- Receive: Resend Receiving (MX on studiopulse.tech) posts `email.received` to Convex at `POST /resend/inbound`.
- Store: Convex tables `mailboxes`, `mailThreads`, `mailMessages`. Attachment bytes go to R2 (shared private bucket, `agency:<id>` scope), never to Convex storage.
- Send: Resend, from the mailbox address, with In-Reply-To and References set.
- Who: owners and admins of the agency named by `MAIL_AGENCY_ID` (falls back to `OUTREACH_INTAKE_AGENCY_ID`). Everyone else gets a 403 or a "not available" panel.

Design notes and the Resend doc links: `openspec/changes/email-inboxes/design.md`.

## Mailboxes

Seeded the first time an owner opens the tab (or with `npx convex run --prod mail:seedDefaults`):

| Address | Display name | From header | Style |
|---|---|---|---|
| support@studiopulse.tech | Support | Pulse Support | Pulse branded layout |
| lawrenceb@studiopulse.tech | Lawrence B | Lawrence Berment | Plain body + Lawrence's outreach signature + Pulse footer |
| info@studiopulse.tech | Info | Pulse | Pulse branded layout |

`info@` is there because every outreach email sets reply-to `info@studiopulse.tech`, so prospect replies land in Info.

Mail to any other `@studiopulse.tech` address is kept in **Unrouted**. Open it there and move it into an inbox to reply.

## Manual steps (Lawrence, after this is merged and deployed)

1. **Resend, enable receiving.** Resend dashboard > Domains > `studiopulse.tech` > turn on **Receiving**. A modal shows one MX record. Copy its exact host, value and priority. (Resend does not publish a fixed value in its docs; use what the modal shows.)
2. **DNS, add the MX record** at the studiopulse.tech DNS host, exactly as the modal shows it. On 2026-10-07 `dig +short MX studiopulse.tech` returned nothing, so no existing mailbox is affected. Do not touch the existing `send.studiopulse.tech` records (they are for sending). Back in Resend click **I've added the record** and wait for it to show **Verified**.
3. **Resend, add the webhook.** Resend dashboard > Webhooks > Add endpoint:
   - URL: `https://pastel-corgi-340.convex.site/resend/inbound`
   - Events: `email.received` (only this one)
   - Copy the **signing secret** (starts with `whsec_`).
4. **Convex prod env** (dashboard > pastel-corgi-340 > Settings > Environment variables):
   - `RESEND_WEBHOOK_SECRET` = the `whsec_...` secret from step 3. Until it is set the route answers 503 and stores nothing.
   - `MAIL_AGENCY_ID` = the Pulse agency id (the Clerk org id the agency console runs under). If `OUTREACH_INTAKE_AGENCY_ID` is already set to the same id you can skip this.
   - `RESEND_API_KEY` is already set (it sends today). Receiving needs it too: the webhook carries metadata only and the body is fetched with this key. Check the key has full access, not sending-only.
5. **Test.** Open `/agency/email` once (creates the three inboxes), then send a mail from Gmail to `support@studiopulse.tech`. It should appear within seconds. Reply from the tab and check it threads in Gmail.

## REST API

Same auth as the Agency console: the caller's Clerk session, owner or admin of the mail agency. From a signed-in browser tab the cookie is enough. From a terminal, pass a Clerk session token (valid about 60 seconds; get one in the browser console on studiopulse.tech with `await window.Clerk.session.getToken()`):

```bash
TOKEN="<paste session token>"

# List inboxes
curl -s https://studiopulse.tech/api/agency/email/inboxes \
  -H "Authorization: Bearer $TOKEN"

# Create an inbox
curl -s -X POST https://studiopulse.tech/api/agency/email/inboxes \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"localPart":"bookings","displayName":"Bookings"}'
```

Responses:

- `200` list: `{ "inboxes": [{ "id", "address", "displayName", "fromName", "kind", "active", "unread" }], "unroutedUnread": 0 }`
- `201` created: `{ "id", "address": "bookings@studiopulse.tech", "displayName": "Bookings" }`
- `400` invalid name (lowercase `a-z 0-9 . _ -`, starts and ends with a letter or digit, at most 64 characters, domain fixed to studiopulse.tech, reserved names such as `postmaster`, `abuse`, `noreply` refused)
- `409` the address already exists
- `401` no session; `403` not an owner or admin of the mail agency; `503` sign-in or Convex not configured

A request with no session at all is redirected to `/sign-in` by the app middleware before it reaches the route, like every other signed-in page.

From Convex directly (CLI, prod): `npx convex run --prod mail:seedDefaults` seeds the defaults. Creating other inboxes goes through the tab or the REST route so it is tied to a person.

## How mail is handled

1. `POST /resend/inbound` returns 503 when `RESEND_WEBHOOK_SECRET` or the mail agency is unset (Resend keeps retrying), 401 on a bad or stale Svix signature, 413 over 256 KB.
2. Duplicate deliveries of the same Resend email id are answered 200 and stored once.
3. The full message is fetched from `GET https://api.resend.com/emails/receiving/{id}`. If that fails, the message is stored from the webhook metadata and the body is fetched again at 1 min, 5 min, 30 min, 2 h and 6 h.
4. Routing: envelope recipient, then To, then Cc; `+tags` ignored. No inbox for the address: Unrouted.
5. Threading: In-Reply-To, then References, then the same subject from someone already on the thread within 60 days.
6. Attachments (up to 10 per message, 25 MB each) are copied to R2. With R2 not configured they show as "R2 is not configured" and the bytes stay at Resend.
7. Received HTML is sanitized and shown in a sandboxed frame with remote images blocked until you click "Load images".

## Limits worth knowing

- A reply to a thread that you started from Pulse threads by subject and sender, because Resend assigns the outgoing Message-ID and does not return it.
- One email addressed to two of our inboxes lands in the first match only (envelope recipient first).
- Sending attachments from the composer is not built.
- Unread counts add up the newest 500 conversations per inbox.
