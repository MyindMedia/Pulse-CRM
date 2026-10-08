## 1. Foundations

- [x] 1.1 Read the Resend Receiving docs and record the findings with URLs in design.md.
- [x] 1.2 `convex/mail/svix.ts` signature check; verify: tests for valid, bad signature, stale timestamp, missing headers, multiple signatures.
- [x] 1.3 `convex/mail/address.ts` local-part validation, reserved names, address normalisation, routing; verify: tests.
- [x] 1.4 `convex/mail/threading.ts` subject normalisation, References parsing, thread choice; verify: tests.
- [x] 1.5 `convex/mail/compose.ts` outbound payload (headers, from, branded vs personal body); verify: tests for In-Reply-To, References, from, no em dashes, signature present for personal.
- [x] 1.6 Schema: `mailboxes`, `mailThreads`, `mailMessages` in `convex/mail/tables.ts`.

## 2. Server

- [x] 2.1 `convex/mail.ts` access, seed defaults (support, lawrenceb, info), create mailbox, list mailboxes with unread counts, list threads, get thread, mark read, archive, move unrouted thread, attachment URL.
- [x] 2.2 `convex/mailInbound.ts` HTTP action `/resend/inbound`: 503 when secret or mail agency unset, Svix verify, dedupe, fetch full message, ingest, schedule attachments; `_hydrate` retry path.
- [x] 2.3 `_ingest`: dedupe in transaction, route, thread, store, unread counts.
- [x] 2.4 `_copyAttachments` to R2 through `storeBytes` (no Convex storage fallback).
- [x] 2.5 `mail.send` + `_deliver` + `_finish` (accepted / rejected / unknown, never auto-retried).
- [x] 2.6 Register `/resend/inbound` in `convex/http.ts`.

## 3. Web

- [x] 3.1 `/agency/email` page: mailbox rail with unread counts, Unrouted view, thread list, thread view, reply and compose, New inbox dialog; 390px layout (rail becomes a select, list and thread stack).
- [x] 3.2 `src/lib/email-html.ts` sanitizer + sandboxed iframe with CSP, remote images blocked by default; verify: tests.
- [x] 3.3 Agency nav "Email" link, shown to the mail-owning agency.
- [x] 3.4 `GET|POST /api/agency/email/inboxes` route using the caller's Clerk session and the same Convex functions.

## 4. Docs and checks

- [x] 4.1 `docs/EMAIL-INBOXES.md`: curl usage, DNS MX, Resend Receiving + webhook, env vars.
- [x] 4.2 Integration tests (convex-test): webhook 503 unset, 401 bad signature, ingest dedupe, routing to mailbox and Unrouted, threading by In-Reply-To and subject, new-inbox validation, outbound headers.
- [x] 4.3 `npx tsc --noEmit`, eslint on changed files, vitest.

## 5. Lawrence (manual, after merge and deploy)

- [ ] 5.1 Resend: Domains > studiopulse.tech > turn on Receiving; add the MX record it shows at the DNS host; wait for "verified".
- [ ] 5.2 Resend: Webhooks > add `https://pastel-corgi-340.convex.site/resend/inbound`, event `email.received`; copy the signing secret.
- [ ] 5.3 Convex prod env: `RESEND_WEBHOOK_SECRET=<whsec_...>` and `MAIL_AGENCY_ID=<Pulse agency id>` (or confirm `OUTREACH_INTAKE_AGENCY_ID` is set).
- [ ] 5.4 Open `/agency/email` once (seeds the mailboxes), send a test to support@ and check it lands.
