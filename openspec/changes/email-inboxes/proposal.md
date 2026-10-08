## Why

Pulse sends mail from studiopulse.tech (support@, info@ for outreach, lawrenceb@ for Lawrence) but nothing receives it. `dig MX studiopulse.tech` returned no MX record on 2026-10-07, so a reply to an outreach email (reply-to info@studiopulse.tech) or a customer writing to support@ has nowhere to land. The owner decided on 2026-10-07 to receive and answer this mail inside the Agency Command Center rather than in a separate mail host.

## What Changes

- New top-level Agency nav item **Email** at `/agency/email`: a shared inbox for studiopulse.tech mailboxes, owners and admins of the mail-owning agency only.
- Mailboxes seeded on first open: `support@studiopulse.tech` ("Support"), `lawrenceb@studiopulse.tech` ("Lawrence B", personal, Lawrence's signature) and `info@studiopulse.tech` ("Info", where outreach replies arrive because outreach sets reply-to info@).
- New inboxes can be created from a "New inbox" dialog, from a Convex mutation, and from an authenticated REST route `POST /api/agency/email/inboxes` (plus `GET` to list). Local part `a-z0-9._-`, domain fixed to studiopulse.tech, duplicates and reserved names (postmaster, abuse, ...) refused.
- Receiving: Resend Receiving (MX on studiopulse.tech) posts `email.received` to a Convex HTTP action `POST /resend/inbound`. The action verifies the Svix signature with `RESEND_WEBHOOK_SECRET` (503 when unset, never open), dedupes by Resend email id, fetches the full message from the Resend API (the webhook carries metadata only), routes by recipient to a mailbox (unknown recipient goes to an **Unrouted** view, never dropped), threads by In-Reply-To / References / subject, and stores it. Attachment bytes are copied to R2 (shared private bucket, `agency:<id>` scope) through the existing `storeBytes` path.
- Sending: reply or new message from a mailbox through the existing Resend integration pattern (`outreachSend._deliver`), `from: Name <address>`, In-Reply-To and References set, saved as an outbound message with its provider status. Shared mailboxes use the Pulse brand layout (`brandEmail`); a personal mailbox (lawrenceb@) sends a plain-looking body plus Lawrence's existing signature (unmodified, from `convex/outreach/signatures.ts`) plus a small Pulse footer. Em dashes are stripped.
- Thread view renders received HTML sanitized, inside a sandboxed iframe with a CSP that blocks scripts and remote images (tracking pixels) by default.

## Capabilities

### New Capabilities
- `agency/email-inboxes`: mailbox management (seed, create via UI/API, validation), inbound receiving (verify, dedupe, fetch, route, thread, store, attachments), outbound reply/compose, the inbox UI.

### Modified Capabilities
- None with an existing spec. The Agency nav gains one link.

## Impact

- Convex: tables `mailboxes`, `mailThreads`, `mailMessages` (`convex/mail/tables.ts`); modules `convex/mail.ts`, `convex/mailInbound.ts`, `convex/mail/*.ts` (pure helpers); HTTP route `/resend/inbound` in `convex/http.ts`.
- Web: `/agency/email` page and components, nav link in `src/app/agency/layout.tsx`, route handler `src/app/api/agency/email/inboxes/route.ts`.
- Env (Convex): `RESEND_WEBHOOK_SECRET` (new, required), `MAIL_AGENCY_ID` (new; falls back to `OUTREACH_INTAKE_AGENCY_ID`), existing `RESEND_API_KEY`.
- DNS: one MX record on studiopulse.tech (value from the Resend dashboard). Resend: enable Receiving on the domain, add the webhook.
- Docs: `docs/EMAIL-INBOXES.md`.

## Non-goals

- Bluehost, IMAP, POP, any other mail host or sync.
- Forwarding to personal Gmail, auto-replies, rules, labels, search, drafts saved server side.
- Sending attachments from the composer (receive only this pass).
- Per-studio (sub-account) mailboxes or other domains. Only studiopulse.tech, only the mail-owning agency.
- AI triage of incoming mail.
