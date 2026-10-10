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
 * IDEMPOTENCY, and the generation it is scoped to (MYI-252)
 * --------------------------------------------------------
 * A product is found by `pulse_tier` AND `pulse_price_book` together, so this
 * run can only ever reuse a product that THIS generation of the price book
 * created. Keying on `pulse_tier` alone is what caused MYI-248: on
 * 2026-10-07T22:09:18Z `findProduct("growth")` matched the 2026-06-07 $199
 * product, printed "reusing product", and created $297/mo + $2,970/yr on it.
 * The rules, and every refusal, live in `scripts/lib/price-book.mjs`.
 *
 * A rerun reuses the product and reuses a matching active price, only creating
 * a new price when the amount or interval changed. It never archives anything.
 * It STOPS, writing nothing, when the tier key belongs to another book, when
 * the slug is already taken, or when the bound product carries an active price
 * this book does not declare.
 *
 * Usage (TEST):
 *   STRIPE_SECRET_KEY=sk_test_... CONVEX_DEPLOY_KEY=... node scripts/stripe-create-products.mjs --apply
 * Usage (LIVE), only with explicit approval:
 *   STRIPE_SECRET_KEY=sk_live_... CONVEX_DEPLOY_KEY=... node scripts/stripe-create-products.mjs --apply --live-approved
 * Starting a NEW generation (bump PRICE_BOOK in lib/price-book.mjs first):
 *   ... node scripts/stripe-create-products.mjs --new-generation
 *
 * EXIT CODES
 *   0  every tier resolved; nothing was blocked
 *   1  a tier was blocked (see the conflict report) or an API call failed
 */
import Stripe from "stripe";
import { execFileSync } from "node:child_process";
import {
  PRICE_BOOK,
  bindProductToTier,
  foreignActivePrices,
  priceLabel,
} from "./lib/price-book.mjs";

/**
 * `slug` is the storefront revenue line (STRIPE_LINK_HYGIENE §7f) and is written
 * on CREATE only — an existing slug is never overwritten here. Without it a
 * product this script creates is an unlabelled sellable product, which is
 * exactly what made GATE A red in MYI-248.
 */
const TIERS = [
  {
    key: "core",
    name: "Pulse OS Core",
    slug: "pulse-os-core",
    prices: [
      { interval: "month", cents: 14900, env: "STRIPE_PRICE_CORE_MONTHLY" },
      { interval: "year", cents: 149000, env: "STRIPE_PRICE_CORE_ANNUAL" },
    ],
  },
  {
    key: "growth",
    name: "Pulse OS Growth",
    slug: "pulse-os-growth",
    prices: [
      { interval: "month", cents: 29700, env: "STRIPE_PRICE_GROWTH_MONTHLY" },
      { interval: "year", cents: 297000, env: "STRIPE_PRICE_GROWTH_ANNUAL" },
    ],
  },
  {
    key: "max",
    name: "Pulse OS Max",
    slug: "pulse-os-max",
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
const newGeneration = process.argv.includes("--new-generation");
const key = process.env.STRIPE_SECRET_KEY;
if (!key) die("STRIPE_SECRET_KEY is required.");
const mode = key.includes("_live_") ? "live" : key.includes("_test_") ? "test" : "unknown";
if (apply && !process.env.CONVEX_DEPLOY_KEY)
  die("--apply needs CONVEX_DEPLOY_KEY to set the Convex prod vars.");
if (apply && mode === "live" && !process.argv.includes("--live-approved"))
  die("Refusing to write LIVE Stripe products without --live-approved.");

const stripe = new Stripe(key);

/** Every active product, fetched once: the binding rules need the whole set. */
async function activeProducts() {
  const out = [];
  for await (const p of stripe.products.list({ limit: 100, active: true })) out.push(p);
  return out;
}

async function activePrices(productId) {
  const out = [];
  for await (const pr of stripe.prices.list({ product: productId, active: true, limit: 100 })) out.push(pr);
  return out;
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
  console.log(
    `\n▶ Stripe product setup (${mode} mode, price book ${PRICE_BOOK})` +
      `${apply ? "" : " — DRY RUN (pass --apply)"}${newGeneration ? " [--new-generation]" : ""}\n`
  );

  const products = await activeProducts();
  console.log(`  (${products.length} active products on the account)\n`);

  const blocked = [];
  let wouldCreatePrice = false;

  for (const t of TIERS) {
    const { action, product: bound, conflicts, notes } = bindProductToTier(
      products,
      t,
      PRICE_BOOK,
      { newGeneration }
    );
    for (const n of notes) console.log(`  · ${t.name}: ${n}`);

    if (action === "blocked") {
      console.log(`  ✖ ${t.name}: BLOCKED, nothing written for this tier`);
      for (const c of conflicts) console.log(`      ${c}`);
      blocked.push(t.key);
      continue;
    }

    let product = bound;
    let existing = [];
    if (!product) {
      if (!apply) {
        console.log(`  • ${t.name}: would CREATE product (slug=${t.slug}, book=${PRICE_BOOK})`);
        for (const p of t.prices) {
          console.log(`      would CREATE $${p.cents / 100}/${per(p.interval)} price -> ${p.env}`);
          wouldCreatePrice = true;
        }
        continue;
      }
      product = await stripe.products.create({
        name: t.name,
        metadata: {
          pulse_tier: t.key,
          pulse_price_book: PRICE_BOOK,
          slug: t.slug,
          revenue_role: "canonical",
        },
      });
      console.log(`  • ${t.name}: created product ${product.id} (slug=${t.slug}, book=${PRICE_BOOK})`);
    } else {
      console.log(`  • ${t.name}: reusing product ${product.id} (book ${PRICE_BOOK})`);

      // Rule 5 — a product serving two books must not be written to at all.
      existing = await activePrices(product.id);
      const foreign = foreignActivePrices(existing, t);
      if (foreign.length) {
        console.log(
          `  ✖ ${t.name}: BLOCKED — ${product.id} carries ${foreign.length} ACTIVE price(s) this ` +
            `book does not declare: ${foreign.map(priceLabel).join(", ")}`
        );
        console.log(
          `      That is one product id serving two price books, which is the MYI-248 shape. ` +
            `Deactivate them, or bump PRICE_BOOK and re-run with --new-generation. ` +
            `No price created and no Convex var set for this tier.`
        );
        blocked.push(t.key);
        continue;
      }
      console.log(`      ${existing.length} active price(s), all declared by this book`);
    }

    for (const p of t.prices) {
      let price = existing.find(
        (pr) => pr.unit_amount === p.cents && pr.recurring?.interval === p.interval && pr.currency === "usd"
      );
      if (!price) {
        if (!apply) {
          console.log(`      would CREATE $${p.cents / 100}/${per(p.interval)} price -> ${p.env}`);
          wouldCreatePrice = true;
          continue;
        }
        price = await stripe.prices.create({
          product: product.id,
          unit_amount: p.cents,
          currency: "usd",
          recurring: { interval: p.interval },
          metadata: { pulse_tier: t.key, pulse_interval: p.interval, pulse_price_book: PRICE_BOOK },
        });
        existing.push(price);
        console.log(`      created price ${price.id} ($${p.cents / 100}/${per(p.interval)})`);
        wouldCreatePrice = true;
      } else {
        console.log(`      reusing price ${price.id} ($${p.cents / 100}/${per(p.interval)})`);
      }
      if (apply) setConvexVar(p.env, price.id);
    }
  }

  if (wouldCreatePrice && mode === "live") {
    console.log(
      `\n⚠ A live price set changed (or would). GATE D in the storefront repo pins every active ` +
        `price id: run \`node scripts/revenue-by-product.mjs --relock\` there and commit the new ` +
        `ACTIVE_PRICE_BOOK, or the revenue report goes red.`
    );
  }

  if (blocked.length) {
    die(
      `BLOCKED: ${blocked.join(", ")}. Nothing was written for those tiers. ` +
        `Resolve the conflicts above — do not loosen the matcher (MYI-252).`
    );
  }

  console.log(`\n✓ Done (${mode}).` + (apply ? "" : " Re-run with --apply to write.") + "\n");
})().catch((e) => die(e.message));
