#!/usr/bin/env node
/**
 * Pulse Stripe go-live VERIFIER (read-only).
 *
 * Confirms the live Stripe account is actually go-live ready and reports the
 * one thing the automation cannot set for you: Checkout / Connect branding.
 * Makes ONLY read calls (retrieve / list) - never mutates anything.
 *
 * Checks:
 *   1. Account     - live key, charges + payouts enabled, country, currency.
 *   2. Branding    - icon / logo / brand colors on the public account settings
 *                    (drives the platform Checkout look). Reports set vs missing.
 *   3. Connect     - Connect is enabled (can list connected accounts) + count.
 *   4. Plan prices - the three self-serve subscription prices exist, are live,
 *                    active, USD, recurring/month, at the expected amounts.
 *   5. Webhooks    - a Platform (connect=false) and a Connect (connect=true)
 *                    endpoint exist at the prod URL, enabled, with the 4 events.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/verify-go-live.mjs
 *   # optional overrides (otherwise prices are discovered by amount):
 *   STRIPE_PRICE_STUDIO=price_... STRIPE_PRICE_PRO=price_... STRIPE_PRICE_GROWTH=price_...
 *   WEBHOOK_URL=https://pastel-corgi-340.convex.site/stripe/webhook
 *
 * Exit code is non-zero if any hard check fails (branding-missing is a WARN,
 * not a failure, since it is a one-time dashboard task).
 */
import Stripe from "stripe";

const WEBHOOK_URL =
  process.env.WEBHOOK_URL ?? "https://pastel-corgi-340.convex.site/stripe/webhook";
const EVENTS = [
  "account.updated",
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];
// Self-serve tier -> expected monthly amount (cents). Solo=studio, Studio=pro, Label=growth.
const EXPECTED = [
  { tier: "studio", label: "Solo", cents: 4900, env: "STRIPE_PRICE_STUDIO" },
  { tier: "pro", label: "Studio", cents: 12900, env: "STRIPE_PRICE_PRO" },
  { tier: "growth", label: "Label", cents: 19900, env: "STRIPE_PRICE_GROWTH" },
];

const PASS = "  \x1b[32m✓\x1b[0m";
const WARN = "  \x1b[33m!\x1b[0m";
const FAIL = "  \x1b[31m✗\x1b[0m";
let failures = 0;
let warnings = 0;
const pass = (m) => console.log(`${PASS} ${m}`);
const warn = (m) => { warnings++; console.log(`${WARN} ${m}`); };
const fail = (m) => { failures++; console.log(`${FAIL} ${m}`); };
const money = (c) => `$${(c / 100).toFixed(2)}`;

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("\n✖ STRIPE_SECRET_KEY is required (use scripts/verify-go-live.sh).\n");
  process.exit(1);
}
const keyMode = key.includes("_live_") ? "live" : key.includes("_test_") ? "test" : "unknown";
const stripe = new Stripe(key);

async function checkAccount() {
  console.log("\n== 1/5  Account ==");
  const a = await stripe.accounts.retrieve();
  console.log(`  ${a.id} - ${a.business_profile?.name ?? "(no business name)"} [${keyMode} mode]`);
  if (keyMode !== "live") fail(`key is ${keyMode} mode, not live - this is NOT the go-live key`);
  else pass("live secret key");
  a.charges_enabled ? pass("charges enabled") : fail("charges NOT enabled");
  a.payouts_enabled ? pass("payouts enabled") : fail("payouts NOT enabled");
  a.details_submitted ? pass("account details submitted") : warn("account details not fully submitted");
  console.log(`     country=${a.country} default_currency=${(a.default_currency ?? "?").toUpperCase()}`);
  return a;
}

function checkBranding(a) {
  console.log("\n== 2/5  Branding (Checkout + Connect look) ==");
  const b = a.settings?.branding ?? {};
  b.icon ? pass("icon set") : warn("icon NOT set (Dashboard > Settings > Branding)");
  b.logo ? pass("logo set") : warn("logo NOT set (Dashboard > Settings > Branding)");
  b.primary_color
    ? pass(`primary color ${b.primary_color}`)
    : warn("primary color NOT set (use Pulse gold #FDB913)");
  b.secondary_color
    ? pass(`secondary color ${b.secondary_color}`)
    : warn("secondary/accent color NOT set (use ink #141417)");
}

async function checkConnect() {
  console.log("\n== 3/5  Connect ==");
  try {
    const list = await stripe.accounts.list({ limit: 100 });
    pass("Connect is enabled (can list connected accounts)");
    const live = list.data.filter((x) => x.charges_enabled).length;
    console.log(`     connected accounts: ${list.data.length} (charges-enabled: ${live})`);
    if (list.data.length === 0)
      warn("no studios have connected Stripe yet (expected right after go-live reset)");
  } catch (e) {
    fail(`Connect not usable: ${e.message}`);
  }
}

async function checkPrices() {
  console.log("\n== 4/5  Plan prices ==");
  // Build a pool of live, active, recurring/month USD prices to match against.
  const pool = [];
  for await (const p of stripe.prices.list({ active: true, limit: 100, expand: ["data.product"] })) {
    if (p.currency === "usd" && p.recurring?.interval === "month" && p.livemode) pool.push(p);
  }
  for (const want of EXPECTED) {
    const byId = process.env[want.env];
    let match = byId ? pool.find((p) => p.id === byId) : null;
    if (byId && !match) {
      fail(`${want.label} (${want.env}=${byId}) not found among live monthly USD prices`);
      continue;
    }
    if (!match) match = pool.find((p) => p.unit_amount === want.cents);
    if (!match) {
      fail(`${want.label} ${money(want.cents)}/mo - no matching live price found`);
      continue;
    }
    const name = typeof match.product === "object" ? match.product.name : match.product;
    if (match.unit_amount === want.cents)
      pass(`${want.label}: ${match.id} = ${money(match.unit_amount)}/mo "${name}"`);
    else
      fail(`${want.label}: ${match.id} = ${money(match.unit_amount)}/mo (expected ${money(want.cents)})`);
  }
}

async function checkWebhooks() {
  console.log("\n== 5/5  Webhooks ==");
  const eps = [];
  for await (const ep of stripe.webhookEndpoints.list({ limit: 100 })) eps.push(ep);
  if (process.env.DEBUG_WEBHOOKS) {
    for (const e of eps)
      console.log(`     [dbg] ${e.id} url=${e.url} connect=${e.connect} status=${e.status} app=${e.application} events=${(e.enabled_events ?? []).length}`);
  }
  // A Connect (connected-accounts) endpoint is identified by connect===true OR,
  // when the platform has a Connect application, a non-null `application` id.
  // A Platform endpoint listens to the platform's own events: application===null
  // and not flagged connect.
  const isConnect = (e) => e.connect === true || e.application != null;
  for (const [connect, kind] of [[false, "Platform"], [true, "Connect"]]) {
    const ours = eps.filter(
      (e) => e.url === WEBHOOK_URL && e.status === "enabled" && isConnect(e) === connect,
    );
    if (ours.length === 0) {
      fail(`${kind} endpoint at ${WEBHOOK_URL} (connect=${connect}) NOT found/enabled`);
      continue;
    }
    const ep = ours[0];
    const evs = ep.enabled_events ?? [];
    const missing = EVENTS.filter((e) => !evs.includes(e) && !evs.includes("*"));
    if (missing.length) fail(`${kind} ${ep.id} missing events: ${missing.join(", ")}`);
    else pass(`${kind} ${ep.id} enabled, ${EVENTS.length} required events present`);
    if (ours.length > 1) warn(`${ours.length} ${kind} endpoints at this URL - duplicates may double-fire`);
  }
}

const a = await checkAccount();
checkBranding(a);
await checkConnect();
await checkPrices();
await checkWebhooks();

console.log("\n--------------------------------------------");
if (failures === 0 && warnings === 0) {
  console.log("\x1b[32m✓ Go-live verified: all checks passed.\x1b[0m\n");
} else {
  console.log(
    `${failures ? "\x1b[31m" : "\x1b[33m"}${failures} failure(s), ${warnings} warning(s).\x1b[0m`,
  );
  if (warnings && !failures)
    console.log("Warnings are one-time dashboard tasks (e.g. branding), not blockers.\n");
}
process.exit(failures ? 1 : 0);
