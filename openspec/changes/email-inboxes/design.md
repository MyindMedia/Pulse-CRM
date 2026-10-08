## Context

- Sending already works through Resend: `convex/lib/email.ts` (`sendEmail`, branded via `convex/lib/emailLayout.ts`) and the outreach path `convex/outreachSend.ts` (`_deliver`: raw fetch to `https://api.resend.com/emails`, idempotency key, 30s abort, outcome recorded as accepted / rejected / unknown and never auto-retried).
- Agency auth: `convex/outreach/scope.ts` `requireAgencyScope` (agency member) with `canManage` = owner or admin.
- Media rule: bytes users download live in R2. `convex/media.ts` `storeBytes(ctx, { scope, purpose, blob, ..., noFallback })` writes to R2 and records a `mediaFiles` row; `agency:<id>` scopes stay in the shared buckets.
- DNS on 2026-10-07: `dig +short MX studiopulse.tech` is empty. Root SPF is `v=spf1 include:sendgrid.net ~all`. `send.studiopulse.tech` has the Resend/SES feedback MX used for sending. So adding a receiving MX on the root breaks no existing inbox.

## Resend Receiving: what the docs say (read 2026-10-07)

Sources:
- Overview: https://resend.com/docs/dashboard/receiving/introduction
- Custom domain + MX: https://resend.com/docs/dashboard/receiving/custom-domains
- Webhook: https://resend.com/docs/dashboard/receiving/create-receiving-webhook
- Retrieve received email: https://resend.com/docs/api-reference/emails/retrieve-received-email
- List attachments: https://resend.com/docs/api-reference/emails/list-received-email-attachments
- Attachments guide: https://resend.com/docs/dashboard/receiving/attachments
- Threaded replies: https://resend.com/docs/dashboard/receiving/reply-to-emails
- Webhook verification: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
- Svix manual verification: https://docs.svix.com/receiving/verifying-payloads/how-manual

Findings:
1. **How it works.** Resend receives mail for a domain with Receiving turned on, parses it, and POSTs to a webhook you choose.
2. **MX.** Turn on the Receiving toggle on the domain's page in the Resend dashboard; a modal shows the MX record to add. The docs do not print the host or priority; copy them from that modal. Caveat from the docs: mail goes to the lowest-priority MX, so adding Resend next to another provider's MX on the same name can starve one of them. studiopulse.tech has no MX today, so the root is safe.
3. **Event.** `email.received`. Payload: `{ type, created_at, data: { email_id, created_at, from, to[], cc[], bcc[], received_for[], message_id, subject, attachments: [{ id, filename, content_type, content_disposition, content_id }] } }`.
4. **Metadata only.** "Webhooks do not include the email body, headers, or attachments, only their metadata." The full message comes from `GET https://api.resend.com/emails/receiving/{email_id}`: `from, to[], cc[], bcc[], reply_to[], subject, html, html_format (data_uri|cid), text, headers{}, received_for[], authentication{spf,dkim,dmarc}, message_id, raw{download_url,expires_at}, created_at, attachments[{id, filename, content_type, content_disposition, content_id, size}]`. Inline images arrive as base64 data URIs in `html` by default.
5. **Attachments.** `GET https://api.resend.com/emails/receiving/{email_id}/attachments` returns `{ data: [{ id, filename, size, content_type, content_disposition, content_id, download_url, expires_at }] }`. `download_url` is valid for one hour.
6. **Signature.** Headers `svix-id`, `svix-timestamp`, `svix-signature`. Signed content is `${svix-id}.${svix-timestamp}.${rawBody}`; key is the secret with `whsec_` removed, base64 decoded; HMAC-SHA256, base64. The header holds one or more space-separated `v1,<sig>` entries; accept if any matches; compare in constant time; reject stale timestamps (Svix libraries use 5 minutes). Use the raw body, never re-serialized JSON.
7. **Threading replies.** Set `In-Reply-To` to the received `message_id` and prefix the subject with `Re:`. For later replies add `References` with the earlier ids, space-separated, latest last.

## Decisions

### D1. Verify by hand with WebCrypto, not the `svix` package
`convex/mail/svix.ts` implements the steps above with `crypto.subtle` (available in the Convex default runtime and in vitest). No `"use node"`, no dependency surprises, and every branch is unit tested. Tolerance 5 minutes each way. `RESEND_WEBHOOK_SECRET` unset returns 503 before the body is read: the route fails closed.

### D2. Fetch the body synchronously, fall back to a scheduled retry
The HTTP action verifies, checks the dedupe index, then fetches `/emails/receiving/{id}` (12s timeout). On success the message is stored complete. If the fetch fails (no key, 5xx, network), the message is stored from the webhook metadata with `bodyStatus: "pending"` and `_hydrate` retries with backoff (1m, 5m, 30m, 2h, 6h). When the body arrives and the message started its own thread, it is re-threaded with the real In-Reply-To / References. Nothing is dropped and the webhook still answers 200 quickly.

### D3. Dedupe on `resendEmailId`, inside the mutation
`mailMessages.by_resend_id`. The HTTP action checks first (cheap early 200 for Svix retries), and `_ingest` checks again in its transaction, so two concurrent deliveries of one event cannot both insert (Convex OCC serializes them).

### D4. Routing
Candidates in order: `received_for` (the envelope recipient, covers Bcc), then `to`, then `cc`. Lowercased, `+tag` stripped, only `@studiopulse.tech`. First active mailbox wins. No match: thread with `mailboxId` unset, shown in the Unrouted view, where an owner can move it into a mailbox. The original recipients are kept on the thread.

### D5. Threading
1. Any id in In-Reply-To then References (newest first) that matches a stored message (`by_agency_message_id`) in the same mailbox: that thread.
2. Else same mailbox, same normalized subject (Re:/Fwd:/AW:/SV:/TR: stripped, case and space folded), the sender is already a participant, last activity within 60 days: that thread.
3. Else a new thread.
Outbound messages do not know their final Message-ID (Resend assigns it), so a reply to a thread that began with an inbound message threads by References (which carry the original inbound id); a reply to a brand-new outbound message threads by subject + participant.

### D6. Mail-owning agency
studiopulse.tech belongs to Pulse, not to every agency on the platform. `MAIL_AGENCY_ID` (fallback `OUTREACH_INTAKE_AGENCY_ID`) names the one agency whose owners and admins see Email. Unset: the tab says it is not set up and the inbound route returns 503 (Resend retries). The client never supplies an agency id.

### D7. Attachments to R2
After a message is stored, `_copyAttachments` lists attachments, downloads each (cap 25 MB, 10 per message) and calls `storeBytes({ scope: "agency:<id>", purpose: "document", noFallback: true })`, so bytes go to the shared private R2 bucket and never to Convex storage. The message keeps metadata plus the `mediaFiles` ref; the thread view asks for a signed URL on click. When R2 is not configured, the attachment is marked `skipped` with the reason, metadata kept. Inline data-URI images in received HTML are stripped before storage (Convex documents cap at 1 MiB and bytes belong in R2); HTML over 400k characters is truncated and flagged.

### D8. Outbound
`mail.send` (owner/admin) validates, writes the outbound row as `sending`, schedules `_deliver`. `_deliver` mirrors `outreachSend._deliver`: idempotency key `pulse-mail-<messageId>`, 30s abort, accepted / rejected / unknown recorded, never auto-retried. Payload built by the pure `buildOutboundPayload` (tested): `from: "<fromName> <address>"`, `In-Reply-To`, `References`, `text` and `html`.
- Shared mailbox: `brandEmail({ title: subject, bodyHtml })`.
- Personal mailbox with a signature key: escaped body paragraphs, then `signatureHtml(key, "image")` from the outreach code (the same default the outreach emails use, with its inline image attached through `inlineImagesFor`), then a small Pulse footer (tagline, address, site). Signature files are imported, not copied or edited.
- `stripEmDashes` on subject and body.

### D9. Rendering received HTML
`src/lib/email-html.ts` `sanitizeEmailHtml` removes script, style-less dangerous elements (script, iframe, object, embed, form, input, button, link, meta, base, svg script), `on*` handlers, `javascript:` and `data:` (except images) URLs, and swaps remote `img src` to `data-blocked-src` unless remote images are allowed. The result renders in `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">` (no scripts, opaque origin) with a CSP meta `default-src 'none'; img-src data:` (plus `https:` when the reader clicks "Load images"). Two independent layers.

### D10. REST API
`src/app/api/agency/email/inboxes/route.ts` (GET list, POST create). Auth is the caller's Clerk session (cookie or `Authorization: Bearer <session token>`). The route mints the Convex token (`getToken({ template: "convex" })`) and calls the same public Convex functions as the UI, so the owner/admin and mail-agency checks live in one place.

## Risks / Trade-offs

- Resend may assign a Message-ID we cannot read back; subject threading covers that case (D5).
- One inbound event with several of our addresses lands in one mailbox only (first match, D4).
- Mailbox unread counts sum up to 500 threads per mailbox; fine at current volume.
- HTML sanitizing is regex based. The sandboxed iframe plus CSP is the real boundary.
