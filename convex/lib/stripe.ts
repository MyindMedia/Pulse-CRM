import Stripe from "stripe";
import { STRIPE_PRICE_ENV, TIERS, type BillingInterval, type TierKey } from "./pricing";

/* ============================================================
   Stripe SDK factory + tier ↔ price-id map. All Stripe access
   should go through stripeClient() so tests can stub.
   ============================================================ */

let _stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  // Convex actions run in a V8 (non-Node) runtime, so the SDK must use the
  // fetch-based HTTP client - the default Node http client has no node:https
  // and the request dies mid-flight ("Connection lost while action was in
  // flight"). Webhook signature checks already use constructEventAsync.
  _stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  return _stripe;
}

/** Tier and interval to Stripe price id env var name. Six prices:
    STRIPE_PRICE_{CORE,GROWTH,MAX}_{MONTHLY,ANNUAL}. The names live in
    lib/pricing.ts next to the prices they stand for. */
export const TIER_PRICE_ENV = STRIPE_PRICE_ENV;

/** The price id for a tier and interval. Throws, naming the env var, when it
 *  is not configured: asking for a year without the annual price set must
 *  say so rather than silently charge the monthly price for a year. */
export function priceIdForTier(tier: TierKey, interval: BillingInterval = "month"): string {
  const envKey = STRIPE_PRICE_ENV[tier][interval];
  const v = process.env[envKey];
  if (!v) throw new Error(`${envKey} not set`);
  return v;
}

/** Kept for callers that pass the interval positionally. */
export function priceIdForTierInterval(tier: TierKey, interval: BillingInterval): string {
  return priceIdForTier(tier, interval);
}

/** True when the price id for this tier and interval is configured, so the
 *  pricing page can fall back to "Book a demo" instead of a broken button. */
export function hasPriceId(tier: TierKey, interval: BillingInterval): boolean {
  return Boolean(process.env[STRIPE_PRICE_ENV[tier][interval]]);
}

/** Reverse lookup, used by the webhook to set agencies.plan from a
 *  subscription's price. Monthly and annual prices both map to their tier. */
export function tierForPriceId(
  priceId: string,
): { tier: TierKey; interval: BillingInterval } | null {
  for (const tier of TIERS) {
    for (const interval of ["month", "year"] as const) {
      const v = process.env[STRIPE_PRICE_ENV[tier][interval]];
      if (v && v === priceId) return { tier, interval };
    }
  }
  return null;
}
