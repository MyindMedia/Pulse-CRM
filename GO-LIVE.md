# Pulse Go-Live Checklist (the "seams")

The code for payments, email, and SMS is built and unit-tested. What remains is
account + environment configuration that cannot be done from the dev environment
(it needs your third-party accounts and the cloud Convex deployment). This is the
exact sequence to flip each seam from simulated to live.

All Convex env vars below are set on the **cloud** deployment, not the local
anonymous backend:

```
npx convex env set KEY value --prod        # or via the Convex dashboard for pastel-corgi-340
```

Deploys to cloud need `CONVEX_DEPLOY_KEY` (or `npx convex login`), then:

```
CONVEX_DEPLOY_KEY=... npx convex deploy
```

Frontend changes go live on the next Netlify build (push to the connected branch).

---

## 1. Payments - Stripe Connect (currently falls back to `provider: simulated`)

Each studio connects its OWN Stripe account during onboarding and gets paid
directly; Pulse facilitates.

1. In the Stripe dashboard, enable **Connect** (platform account).
2. Set on cloud Convex:
   - `STRIPE_SECRET_KEY` - the Connect-enabled platform secret key.
   - `STRIPE_WEBHOOK_SECRET` - signing secret from the webhook you register next.
3. Register a webhook endpoint pointing at `https://<CONVEX_SITE_URL>/stripe/webhook`,
   subscribed to at least `account.updated` (Connect account status) and the
   checkout/payment events the deposit flow uses.
4. Have a studio run the Stripe Connect step on `/settings` (or onboarding) to
   create their connected account; `stripeConnect.refreshStatus` flips them live.
5. Verify: a deposit checkout produces a real Stripe `payments` row with
   `provider: "stripe"` (not `simulated`).

## 2. Internal email - Resend (works now; needs a verified domain to send to anyone)

The internal channel ("<Studio> via Pulse") is live but, until the sending domain
is verified, Resend will reject sends to addresses other than the account owner.

1. Set on cloud Convex:
   - `RESEND_API_KEY` - your Resend API key.
   - `RESEND_FROM` - the verified from-address (e.g. `support@yourdomain.com`).
2. In Resend, add and **verify your sending domain** (SPF + DKIM DNS records).
3. Verify: an approved Approval-Inbox email to an external address shows
   `status: "sent"` (not `simulated` / `failed`).

## 3. Studio email via Google (optional per studio - send as their real Gmail)

1. Create a Google Cloud OAuth client (Web application).
2. Set on cloud Convex:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
3. Add authorized redirect URI: `https://<CONVEX_SITE_URL>/google/callback`.
4. Enable scopes: `gmail.send` and `userinfo.email`.
5. Studio connects Google on `/settings`; `clientEmail.sendToClient` then routes
   through their Gmail instead of the internal channel.

## 4. SMS (currently logged/simulated)

Pick one provider with `SMS_PROVIDER` (`twilio` | `telnyx` | `loopmessage`,
default `twilio`) and set its keys on cloud Convex:

- **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either
  `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`.
- **Telnyx:** `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`.
- **LoopMessage (iMessage):** `LOOPMESSAGE_API_KEY`, `LOOPMESSAGE_SECRET_KEY`,
  `LOOPMESSAGE_SENDER`, optional `LOOPMESSAGE_ENDPOINT`, `LOOPMESSAGE_WEBHOOK_SECRET`.

Point the provider's inbound webhook at `https://<CONVEX_SITE_URL>/sms/inbound`.
Verify: a session reminder sends a real SMS and an inbound reply is captured.

## 5. AI (leave deterministic fallback mode)

- `OPENAI_API_KEY` - set to use gpt-5-family for draft enrichment, the Agent, and
  the client concierge. Without it the app uses Gemini (`GEMINI_API_KEY`, already
  set) and then deterministic templates - everything still works, just less rich.

## 6. Other env already in play

- `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  (auth; dev instance today).
- `CONVEX_SITE_URL` / `NEXT_PUBLIC_CONVEX_SITE_URL`, `APP_URL` / `NEXT_PUBLIC_APP_URL`
  (link building).
- `AGENCY_ADMIN_EMAILS` (agency control-plane access).

---

## What was validated locally vs what needs you

- **Validated here:** the full vitest suite, TypeScript typecheck, and a production
  build all pass. The simulated fallbacks behave correctly (they log instead of
  sending when unconfigured).
- **Needs your accounts + cloud deploy:** real money movement (Stripe), real
  outbound email to arbitrary recipients (Resend domain), real SMS (provider
  keys), and richer AI (OpenAI key). None of these can be exercised end-to-end
  from the dev environment, which has no cloud access or third-party credentials.
