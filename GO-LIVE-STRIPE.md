# Pulse — Stripe Live Go-Live Runbook

The one remaining seam for real money. Everything else (code, webhooks handler,
Connect onboarding, deposit/membership flows) is built and running on **test**
keys against prod Convex `pastel-corgi-340`. This flips it to **live**.

> Real-money, hard-to-reverse, outward-facing. Do the steps in order. Nothing
> here charges anyone until a studio re-connects Stripe in live mode and a real
> checkout runs.

## Confirmed current state (verified 2026-06-03)

| Var (Convex prod) | Now | Needs |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (Connect platform key) | live `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | test-mode **platform** endpoint signing secret | live platform `whsec_…` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | test-mode **Connect** endpoint signing secret | live Connect `whsec_…` |

- **No frontend Stripe publishable key** — Pulse uses Stripe **hosted** Checkout
  + Connect onboarding (redirects). The `pk_*`/PUBLISHABLE refs in `src/` are
  **Clerk**, not Stripe. Nothing to change on the frontend / Netlify for Stripe.
- **Webhook URL (both endpoints share it):** `https://pastel-corgi-340.convex.site/stripe/webhook`
  `convex/http.ts` tries both signing secrets per request, so one URL + two
  endpoints (platform + Connect) is correct.
- **Events the handler acts on** (`convex/billingWebhooks.ts`):
  `account.updated`, `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`.

## Why two endpoints

- **Connect endpoint** ("Events on connected accounts") — carries the money
  events, because deposits + memberships are charged **on the studio's own
  connected account**: `account.updated` (studio finished/changed onboarding),
  `checkout.session.completed` (deposit/invoice settled),
  `customer.subscription.updated/deleted` (membership lifecycle).
- **Platform endpoint** ("Events on your account") — keep it wired for parity /
  any future platform-level events. Subscribe it to the same four event types.

---

## Fast path (automated)

`scripts/stripe-go-live.mjs` does steps 3 + 4 for you — creates both live webhook
endpoints (correct events, Connect vs Platform) via the Stripe API and sets all
three Convex prod vars. Rehearsed in test mode (webhook-create + env-set both
verified). After you've done steps 1–2 below (enable Connect live + get the live
key):

```
export CONVEX_DEPLOY_KEY="$(op read 'op://Security/Convex PULSE CRM/deploy key')"
STRIPE_SECRET_KEY=sk_live_…  node scripts/stripe-go-live.mjs --apply
```

It prints the remaining manual items (data cleanup, branding, studio re-connect).
Dry rehearsal anytime (safe, deletes its throwaways, no env changes):
`STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-go-live.mjs --rehearse`.

The manual breakdown below is the same sequence done by hand.

---

## Steps (Stripe dashboard is in LIVE mode for all of this)

### 1. Enable Connect in live mode
Stripe Dashboard → toggle to **Live** → **Connect** → complete the platform
profile if prompted (business details, payout, Connect settings). Express
accounts must be enabled (studios onboard as Express connected accounts).

### 2. Get the live platform secret key
Developers → API keys (Live) → reveal **Secret key** `sk_live_…`. This is the
Connect-enabled **platform** key.

### 3. Create the two live webhook endpoints
Developers → Webhooks (Live) → **Add endpoint**, twice — same URL both times:
`https://pastel-corgi-340.convex.site/stripe/webhook`

- **Endpoint A — Connect:** "Listen to events on **Connected accounts**". Select:
  `account.updated`, `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
  → its **Signing secret** = `STRIPE_CONNECT_WEBHOOK_SECRET`.
- **Endpoint B — Platform:** "Listen to events on **Your account**". Same four
  events. → its **Signing secret** = `STRIPE_WEBHOOK_SECRET`.

### 4. Set the three live values on Convex prod
```
export CONVEX_DEPLOY_KEY="$(op read 'op://Security/Convex PULSE CRM/deploy key')"
npx convex env set STRIPE_SECRET_KEY            sk_live_…           --prod
npx convex env set STRIPE_WEBHOOK_SECRET        whsec_…platform…    --prod
npx convex env set STRIPE_CONNECT_WEBHOOK_SECRET whsec_…connect…    --prod
```
No redeploy needed — env vars are read at request time. (Optionally save the
live values into 1Password `op://Security/6iy2n5m4i2fo3pvgf37fhlpfkm/*`.)

### 5. Clear stale TEST connected-account state  ⚠️ required
Test-mode `acct_…` IDs do **not** exist in live mode. Any studio whose
`stripeAccountId` was set in test mode will throw on `accounts.retrieve` and
show a broken "connected" state. Same for test memberships
(`stripeCustomerId`/`stripeSubscriptionId`) and any `stripePriceId`.

Before announcing live, clear these fields on every org/membership so studios
get a clean "Connect Stripe" prompt and re-onboard in live mode:
- orgs: `stripeAccountId`, `stripeChargesEnabled`, `stripeDetailsSubmitted`
- memberships rows: `stripeCustomerId`, `stripeSubscriptionId`
- membership plans: `stripePriceId`

**Use the built-in migration** `internal.stripeConnect._resetTestConnectStateForGoLive`
(internal-only; not client-callable). It clears the three connected-account
surfaces above and cancels any membership whose live subscription no longer
exists. Run it from the Convex dashboard → Functions → Run, or via CLI:
```
# dry run first - reports counts, writes nothing
npx convex run stripeConnect:_resetTestConnectStateForGoLive --prod
# apply
npx convex run stripeConnect:_resetTestConnectStateForGoLive '{"dryRun": false}' --prod
```
(It does NOT touch the `agencies` table — Pulse's own platform billing — by design.)

### 6. Redo Stripe branding in LIVE mode (Dashboard only)
Stripe forbids setting a platform's own account branding via the API
(`"You cannot use this method on your own account"`), so this is a one-time
Dashboard task. Test-mode branding does not carry over to live. Assets are
prepared in the repo:
- **Settings → Branding** (drives Checkout):
  - Icon: `public/stripe-icon.png` (512x512 square)
  - Logo: `public/pulse-logo-main.png`
  - Brand color `#FDB913` (gold), Accent color `#141417` (ink)
- **Settings → Connect → Branding** (drives studio Express onboarding): same
  icon + brand color `#FDB913`.

`bash scripts/verify-go-live.sh` reports branding as 4 warnings until this is done.

### 7. Each studio re-connects Stripe (live)
Studio opens `/settings` → Connect Stripe → completes live Express onboarding.
`stripeConnect.refreshStatus` flips them to charges-enabled.

### 8. (Optional) Embedded onboarding — branded, in-app connect
The connect flow uses Stripe's EMBEDDED Connect components (themed to Pulse)
when a publishable key is present, so studios onboard inside `/payments` instead
of being redirected to Stripe's hosted page. Set the LIVE publishable key on
the Netlify site (client-exposed, safe to be public):
```
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_live_…
```
Add it in Netlify → Site settings → Environment, then redeploy (it is baked at
build time). Without it, the flow automatically falls back to the hosted Account
Link redirect — no breakage. Backend powered by `stripeConnect.createAccountSession`.

---

## Verify live
Run the read-only verifier first — it checks the account (live, charges +
payouts), branding, Connect, all three plan prices, and both webhook endpoints
in one pass:
```
bash scripts/verify-go-live.sh
```
0 failures = go-live is healthy; branding shows as warnings until step 6 is done.
Then spot-check the live behaviour:
1. `npx convex env list --prod` shows all three as `…live…` / live signing secrets.
2. A studio finishes live Connect onboarding → `account.updated` lands →
   `stripeChargesEnabled = true`.
3. A real `/book` deposit checkout produces a `payments` row with
   `provider: "stripe"` (not `simulated`) and the webhook 200s.
4. Stripe Dashboard (Live) → Webhooks → both endpoints show recent 200s.

## Rollback
Re-set the three vars back to the test values (keep them in 1Password) and the
app is instantly back on test rails — no deploy, no data change. The stale-field
cleanup in step 5 is the only non-trivial-to-undo action, so do it last /
deliberately.
