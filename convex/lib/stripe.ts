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
  _stripe = new Stripe(key);
  return _stripe;
}

/** Tier → Stripe price ID env var name. */
export const TIER_PRICE_ENV: Record<TierKey, string> = {
  studio: "STRIPE_PRICE_STUDIO",
  pro: "STRIPE_PRICE_PRO",
  agency: "STRIPE_PRICE_AGENCY",
};

export function priceIdForTier(tier: TierKey): string {
  const envKey = TIER_PRICE_ENV[tier];
  const v = process.env[envKey];
  if (!v) throw new Error(`${envKey} not set`);
  return v;
}

/** Reverse lookup — used by the webhook to flip agencies.plan. */
export function tierForPriceId(priceId: string): TierKey | null {
  for (const tier of ["studio", "pro", "agency"] as TierKey[]) {
    if (process.env[TIER_PRICE_ENV[tier]] === priceId) return tier;
  }
  return null;
}
