# Stripe: what to create for Core / Growth / Max

Nothing in this build created, edited or archived anything in Stripe. Create these by hand in the Stripe dashboard (live mode), then paste each price id into the Convex production environment.

Amounts come from `convex/lib/pricing.ts` (`PRICING`). Currency USD, recurring, licensed (flat), quantity 1. No trial on the price.

## 3 products, 6 prices

| # | Product name | Price | Interval | Amount (USD) | Convex env var |
|---|---|---|---|---|---|
| 1 | Pulse OS Core | Core monthly | Monthly | $149.00 | `STRIPE_PRICE_CORE_MONTHLY` |
| 2 | Pulse OS Core | Core annual | Yearly | $1,490.00 | `STRIPE_PRICE_CORE_ANNUAL` |
| 3 | Pulse OS Growth | Growth monthly | Monthly | $297.00 | `STRIPE_PRICE_GROWTH_MONTHLY` |
| 4 | Pulse OS Growth | Growth annual | Yearly | $2,970.00 | `STRIPE_PRICE_GROWTH_ANNUAL` |
| 5 | Pulse OS Max | Max monthly | Monthly | $699.00 | `STRIPE_PRICE_MAX_MONTHLY` |
| 6 | Pulse OS Max | Max annual | Yearly | $6,990.00 | `STRIPE_PRICE_MAX_ANNUAL` |

Notes:

- Max is one flat price with unlimited studios. Do not add per-studio prices, quantity tiers or seat pricing.
- Annual is ten times monthly (two months free).
- Optional, so the scripts can find the products again: on each product set metadata `pulse_tier` to `core`, `growth` or `max`; on each price set `pulse_tier` and `pulse_interval` (`month` or `year`).

## After creating them

1. Convex dashboard, production deployment, Settings > Environment Variables: add the six variables above, each set to its `price_...` id.
2. Leave the old variables (`STRIPE_PRICE_STUDIO`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_LABEL`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_ENTERPRISE`, `STRIPE_PRICE_AGENCY` and their `_ANNUAL` twins) in place until this branch is deployed, then delete them. Nothing reads them after the deploy.
3. Do not archive the old Stripe prices until nobody is subscribed to them. There are no paid subscribers today.
4. Check with the read-only verifier: `STRIPE_SECRET_KEY=sk_live_... node scripts/verify-go-live.mjs`.

Until a price id is set, the pricing page falls back to "Book a demo" for that plan and interval (`billing.checkoutAvailability`).

## Webhook

No new webhook endpoint or event is needed. The receiver (`convex/billingWebhooks.ts`) now maps all six prices back to their tier and records downgrades to Core. Review that diff before deploying.

## Automation (do not run without a go-ahead)

`scripts/stripe-create-products.mjs` creates the same three products and six prices idempotently and sets the Convex vars. It refuses to write in live mode without `--live-approved`. It has not been run.
