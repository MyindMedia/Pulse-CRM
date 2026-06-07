#!/usr/bin/env node
/**
 * Pulse platform-billing product setup.
 *
 * Creates the three self-serve subscription products/prices (Studio Starter,
 * Studio Pro, Studio Growth) in Stripe and sets the matching STRIPE_PRICE_*
 * vars on Convex prod, so the landing pricing tiles can start real
 * subscriptions via convex/billing.ts beginCheckout.
 *
 * Prices come from convex/lib/plans.ts (priceCents): 4900 / 12900 / 19900.
 *
 * Idempotent: products are tagged with metadata `pulse_tier:<key>`; a rerun
 * reuses the product and reuses a matching active monthly price, only creating
 * a new price when the amount changed.
 *
 * Usage (TEST):
 *   STRIPE_SECRET_KEY=sk_test_... CONVEX_DEPLOY_KEY=... node scripts/stripe-create-products.mjs --apply
 * Usage (LIVE):
 *   STRIPE_SECRET_KEY=sk_live_... CONVEX_DEPLOY_KEY=... node scripts/stripe-create-products.mjs --apply
 *
 * (A restricted key rk_live_ also works if it has Products + Prices write.)
 */
import Stripe from "stripe";
import { execFileSync } from "node:child_process";

const TIERS = [
  { key: "studio", env: "STRIPE_PRICE_STUDIO", name: "Pulse Studio Starter", cents: 4900 },
  { key: "pro", env: "STRIPE_PRICE_PRO", name: "Pulse Studio Pro", cents: 12900 },
  { key: "growth", env: "STRIPE_PRICE_GROWTH", name: "Pulse Studio Growth", cents: 19900 },
];

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const key = process.env.STRIPE_SECRET_KEY;
if (!key) die("STRIPE_SECRET_KEY is required.");
const mode = key.includes("_live_") ? "live" : key.includes("_test_") ? "test" : "unknown";
if (apply && !process.env.CONVEX_DEPLOY_KEY)
  die("--apply needs CONVEX_DEPLOY_KEY to set the Convex prod vars.");

const stripe = new Stripe(key);

async function findProduct(tierKey) {
  const tag = `pulse_tier:${tierKey}`;
  for await (const p of stripe.products.list({ limit: 100, active: true })) {
    if (p.metadata?.pulse_tier === tierKey || (p.description ?? "").includes(tag)) return p;
  }
  return null;
}

async function findPrice(productId, cents) {
  for await (const pr of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (pr.unit_amount === cents && pr.recurring?.interval === "month" && pr.currency === "usd")
      return pr;
  }
  return null;
}

function setConvexVar(name, value) {
  execFileSync("npx", ["convex", "env", "set", name, value, "--prod"], {
    stdio: ["ignore", "ignore", "inherit"],
    env: process.env,
  });
  console.log(`  • Convex prod: set ${name}`);
}

(async () => {
  console.log(`\n▶ Stripe product setup (${mode} mode)${apply ? "" : " — DRY RUN (pass --apply)"}\n`);
  for (const t of TIERS) {
    let product = await findProduct(t.key);
    if (!product) {
      if (!apply) {
        console.log(`  • ${t.name}: would CREATE product + $${t.cents / 100}/mo price`);
        continue;
      }
      product = await stripe.products.create({
        name: t.name,
        metadata: { pulse_tier: t.key },
      });
      console.log(`  • ${t.name}: created product ${product.id}`);
    } else {
      console.log(`  • ${t.name}: reusing product ${product.id}`);
    }

    let price = await findPrice(product.id, t.cents);
    if (!price) {
      if (!apply) {
        console.log(`      would CREATE $${t.cents / 100}/mo price`);
        continue;
      }
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: t.cents,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { pulse_tier: t.key },
      });
      console.log(`      created price ${price.id} ($${t.cents / 100}/mo)`);
    } else {
      console.log(`      reusing price ${price.id} ($${t.cents / 100}/mo)`);
    }

    if (apply) setConvexVar(t.env, price.id);
  }
  console.log(`\n✓ Done (${mode}).` + (apply ? "" : " Re-run with --apply to write.") + "\n");
})().catch((e) => die(e.message));
