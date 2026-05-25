# Pulse — Launch Checklist

Live: **https://pulse.myindsound.com** · Convex: `pastel-corgi-340` · Netlify: `pulse-dash-kit` (builds from `main`).

## ✅ Done (automated)
- Agency owner provisioned — Lawrence (`lawrenceb@myindsound.com`) owns the **Myind Sound** agency (Clerk org `org_3DvdJeJcHJykWNcXiPmRW6Lo5rU`, typed `agency`). `resolveViewer` recognizes agency owners by membership (no JWT template needed).
- Invite portal + branded `/welcome` onboarding (business → logo → payment → email → first room).
- Stripe **Connect** wired (test mode) + `account.updated` webhook; studios connect their own Stripe to collect deposits.
- Client email: **internal channel live** (Resend, `support@myindsound.com`, domain verified). Google channel = code-complete, awaiting OAuth client (below).
- Photo uploads (rooms, team, inventory); staff **scheduling** (shifts, who's-working, auto-shift on session engineers, availability, time-off).
- Clerk **in-app UI** themed (dark + gold) globally. Favicon set.
- Test studios purged.

- Public **deposit collection wired** — `/book` checkout charges the deposit/balance on the studio's *own connected Stripe* (hosted Checkout); `checkout.session.completed` webhook settles + confirms the session. Falls back to simulated record for studios without Stripe connected.

## ⏳ Manual steps to finish (console/dashboard only — not API-automatable)

### 1. Google OAuth (client email "Connect Google") — ✅ DONE 2026-05-24
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` set on Convex (1Password `op://Security/google Console Pulse/*`). OAuth client redirect `https://pastel-corgi-340.convex.site/google/callback`, **Testing** mode. To let non-test studios connect Google later, **publish** the app (triggers Google verification for the `gmail.send` restricted scope).

### 2. Branding (Stripe + Clerk dashboards)
Brand gold `#FDB913`, ink `#141417`, logo `https://pulse.myindsound.com/pulse-logo.png`.
- **Stripe** → Settings → **Branding** (Checkout) and **Connect → Branding** (onboarding). Set in **both Test and Live** mode.
- **Clerk** → Customization → **Theme** + **Emails** (hosted pages + transactional emails). (In-app components already branded in code.)

### 3. Stripe live mode (when ready for real charges)
Swap the test `STRIPE_SECRET_KEY` for a **live** Connect key + create a live `account.updated` webhook → set `STRIPE_WEBHOOK_SECRET`. Re-do Stripe branding in Live mode.

## Notes
- Secrets in 1Password: Stripe `op://Security/6iy2n5m4i2fo3pvgf37fhlpfkm/{Secret key,Publishable key}`; Resend `op://Security/Resend Pulse/Api`; Convex deploy key `op://Security/Convex PULSE CRM/deploy key`; Netlify PAT `op://Security/Netlify Personal Access Key/Personal Access Key`.
- Convex HTTP/site URL (for webhooks + OAuth redirect): `https://pastel-corgi-340.convex.site`.
