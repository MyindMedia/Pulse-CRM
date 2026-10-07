#!/usr/bin/env node
/**
 * Pulse platform-billing product setup: Core / Growth / Max.
 *
 * Creates the three subscription products and their SIX prices (monthly and
 * annual for each) in Stripe and sets the matching env vars on Convex prod:
 *
 *   STRIPE_PRICE_CORE_MONTHLY     $149/mo     STRIPE_PRICE_CORE_ANNUAL     $1,490/yr
 *   STRIPE_PRICE_GROWTH_MONTHLY   $297/mo     STRIPE_PRICE_GROWTH_ANNUAL   $2,970/yr
 *   STRIPE_PRICE_MAX_MONTHLY      $699/mo     STRIPE_PRICE_MAX_ANNUAL      $6,990/yr
 *
 * The amounts MUST match convex/lib/pricing.ts (PRICING). A test
 * (convex/pricing.test.ts) reads this file and fails if they drift.
 *
 * DO NOT RUN without Lawrence's go-ahead. docs/STRIPE-NEW-TIERS.md lists the
 * same six prices for creating them by hand in the Stripe dashboard.
 *
 * Idempotent: products are tagged with metadata `pulse_tier:<key>`; a rerun
 * reuses the product and reuses a matching active price, only creating a
 * new price when the amount or interval changed. It never archives anything.
 *
 * Usage (TEST):
 *   STRIPE_SECRET_KEY=sk_test_... CONVEX_DEPLOY_KEY=... node scripts/stripe-create-products.mjs --apply
 * Usage (LIVE), only with explicit approval:
 *   STRIPE_SECRET_KEY=sk_live_... CONVEX_DEPLOY_KEY=... node scripts/stripe-create-products.mjs --apply --live-approved
 */
import Stripe from "stripe";
import { execFileSync } from "node:child_process";

const TIERS = [
  {
    key: "core",
    name: "Pulse OS Core",
    prices: [
      { interval: "month", cents: 14900, env: "STRIPE_PRICE_CORE_MONTHLY" },
      { interval: "year", cents: 149000, env: "STRIPE_PRICE_CORE_ANNUAL" },
    ],
  },
  {
    key: "growth",
    name: "Pulse OS Growth",
    prices: [
      { interval: "month", cents: 29700, env: "STRIPE_PRICE_GROWTH_MONTHLY" },
      { interval: "year", cents: 297000, env: "STRIPE_PRICE_GROWTH_ANNUAL" },
    ],
  },
  {
    key: "max",
    name: "Pulse OS Max",
    prices: [
      { interval: "month", cents: 69900, env: "STRIPE_PRICE_MAX_MONTHLY" },
      { interval: "year", cents: 699000, env: "STRIPE_PRICE_MAX_ANNUAL" },
    ],
  },
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
if (apply && mode === "live" && !process.argv.includes("--live-approved"))
  die("Refusing to write LIVE Stripe products without --live-approved.");

const stripe = new Stripe(key);

async function findProduct(tierKey) {
  const tag = `pulse_tier:${tierKey}`;
  for await (const p of stripe.products.list({ limit: 100, active: true })) {
    if (p.metadata?.pulse_tier === tierKey || (p.description ?? "").includes(tag)) return p;
  }
  return null;
}

async function findPrice(productId, cents, interval) {
  for await (const pr of stripe.prices.list({ product: productId, active: true, limit: 100 })) {
    if (pr.unit_amount === cents && pr.recurring?.interval === interval && pr.currency === "usd")
      return pr;
  }
  return null;
}

const per = (interval) => (interval === "year" ? "yr" : "mo");

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
        console.log(`  • ${t.name}: would CREATE product`);
        for (const p of t.prices) console.log(`      would CREATE $${p.cents / 100}/${per(p.interval)} price -> ${p.env}`);
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

    for (const p of t.prices) {
      let price = await findPrice(product.id, p.cents, p.interval);
      if (!price) {
        if (!apply) {
          console.log(`      would CREATE $${p.cents / 100}/${per(p.interval)} price -> ${p.env}`);
          continue;
        }
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: p.cents,
          currency: "usd",
          recurring: { interval: p.interval },
          metadata: { pulse_tier: t.key, pulse_interval: p.interval },
        });
        console.log(`      created price ${price.id} ($${p.cents / 100}/${per(p.interval)})`);
      } else {
        console.log(`      reusing price ${price.id} ($${p.cents / 100}/${per(p.interval)})`);
      }
      if (apply) setConvexVar(p.env, price.id);
    }
  }
  console.log(`\n✓ Done (${mode}).` + (apply ? "" : " Re-run with --apply to write.") + "\n");
})().catch((e) => die(e.message));
