# Stripe Connect — letting studios accept their own payments

Pulse is a **Connect platform**: each studio (sub-account) connects or creates its
**own** Stripe account and collects client money **directly into its own bank**.
Pulse never holds funds — it facilitates. This doc is the **platform-owner side**:
what *you* (Lawrence / ThaMyind) do once in the Stripe dashboard so every studio
can self-onboard.

## What's already built in Pulse (no code work needed)

The studio-facing flow is done and live:

| Piece | File | Does |
|---|---|---|
| Connect onboarding action | `convex/stripeConnect.ts` → `createAccountLink` | Creates an **Express** connected account for the studio + a hosted onboarding link |
| Status sync | `refreshStatus` + `account.updated` webhook | Flips the studio to "charges enabled" when they finish |
| Direct-charge checkout | `createDepositCheckout`, `booking.ts`, `invoicePay.ts` | Deposits / balances / invoice pay-links charge **on the studio's account** |
| Guided UI | `payments-setup-walkthrough.tsx`, `stripe-connect-card.tsx`, `get-paid-banner.tsx` | 3-step "Connect → Verify → Collect" with live status |

**Where a studio finds it:** `/welcome` (onboarding), the `/dashboard` banner,
the dedicated `/payments` page, and **Settings**. They click **Connect Stripe**,
go through Stripe's hosted Express onboarding (email, business, bank, ID), land
back in Pulse, and payments turn on automatically.

The "Connect Stripe" button only appears once **you** have set `STRIPE_SECRET_KEY`
on the Convex deployment (the `status.configured` flag). Until then studios see
"Payments aren't enabled yet — your admin needs to configure Stripe."

---

## What YOU do in the Stripe dashboard (one time)

### 1. Enable Connect
Stripe Dashboard → **Connect** → **Get started / Enable**. This turns your Stripe
account into a *platform* that can create connected accounts. Pick the
**platform/marketplace** option (you onboard other businesses), not "I'm a single
business".

### 2. Complete the platform profile  ⚠️ required for live
Connect → **Settings** → **Platform profile** (a.k.a. "responsibilities"). Stripe
asks who handles support, refunds, disputes, and negative balances. For Pulse's
model (Express + **direct charges**), the **connected studio** is the merchant of
record and carries liability — answer accordingly. **You cannot create *live*
connected accounts until this is complete.** (Test mode skips it — see below.)

### 3. Confirm Express is the account type
Pulse creates `type: "express"` accounts. Express is on by default once Connect is
enabled — nothing to toggle. Optionally style what studios see in their own slim
Stripe dashboard: Connect → **Settings → Express Dashboard** (logo, color, name).

### 4. Brand the onboarding (do it in BOTH test and live)
Settings → **Connect → Branding** (and Settings → **Branding**): business name,
icon/logo, brand color. This brands the Stripe-hosted screens your studios walk
through, so it feels like Pulse, not a stranger's Stripe.
Use: gold `#FDB913`, ink `#141417`, logo `https://studiopulse.tech/pulse-logo.png`.

### 5. Public details (shown to the studios' clients)
Settings → **Public details / Customer support**: support email, statement
descriptor, support phone. These appear on your studios' clients' card statements
and receipts.

### 6. Capabilities — nothing extra
Pulse requests `card_payments` + `transfers` per account; enabling Connect already
covers these. Stripe may ask the *studio* for more info during their onboarding —
that's normal and self-service.

### 7. Hand Pulse the key + webhook
- **Secret key:** any secret key on your Connect-enabled account is Connect-capable.
  Set it as `STRIPE_SECRET_KEY` on Convex prod (`pastel-corgi-340`). Test key is
  already set; the **live** key + the two webhook endpoints are automated by
  `scripts/stripe-go-live.mjs --apply` (see `GO-LIVE-STRIPE.md`).
- **`account.updated` webhook (on connected accounts):** lets Pulse flip a studio
  to "live" the instant they finish onboarding. Created automatically by the
  go-live script. (Without it, Pulse still polls on return, just less instantly.)

---

## Test it right now (no real money)

`STRIPE_SECRET_KEY` on prod is currently a **test** key, and test mode needs none
of the live gating above — so you can prove the whole studio flow today:

1. As a studio, open **/payments** (or `/welcome`) → **Connect Stripe**.
2. In Stripe's test onboarding use the magic fill: phone `000 000 0000`, code
   `000000`, test SSN `000000000`, any future DOB, address `address_full_match`,
   test bank routing `110000000` / account `000123456789`.
3. Land back in Pulse → the walkthrough flips to **"Payments are live."**
4. Take a test booking deposit → a real Stripe Checkout opens on the studio's
   connected account; card `4242 4242 4242 4242` settles it; the `payments` row
   reads `provider: "stripe"`.

When you're ready for real money, follow `GO-LIVE-STRIPE.md` (live key + webhooks +
clear the test Connect state). **Studios re-connect once in live mode** because
test connected accounts don't carry over.

## TL;DR
Code: done. Your move: **Connect → Enable → complete platform profile → brand it →
set the live key** (one `--apply` command). Then every studio self-onboards from
the Pulse UI and gets paid straight to their bank.
