import Stripe from "stripe";
import type { TierKey } from "./plans";

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

/** Tier → Stripe price ID env var name. enterprise is custom (no self-serve
    checkout); agency is legacy. */
export const TIER_PRICE_ENV: Record<TierKey, string> = {
  // Flow has no subscription price: it is billed as a take rate on what the
  // studio collects, not through a Stripe price object.
  flow: "STRIPE_PRICE_FLOW_UNUSED",
  studio: "STRIPE_PRICE_STUDIO",
  pro: "STRIPE_PRICE_PRO",
  label: "STRIPE_PRICE_LABEL",
  growth: "STRIPE_PRICE_GROWTH",
  enterprise: "STRIPE_PRICE_ENTERPRISE",
  agency: "STRIPE_PRICE_AGENCY",
};

export function priceIdForTier(tier: TierKey): string {
  const envKey = TIER_PRICE_ENV[tier];
  const v = process.env[envKey];
  if (!v) throw new Error(`${envKey} not set`);
  return v;
}

/** Reverse lookup - used by the webhook to flip agencies.plan. */
export function tierForPriceId(priceId: string): TierKey | null {
  for (const tier of ["studio", "pro", "label", "growth", "enterprise", "agency"] as TierKey[]) {
    if (process.env[TIER_PRICE_ENV[tier]] === priceId) return tier;
  }
  return null;
}
