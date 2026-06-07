#!/usr/bin/env node
/**
 * Pulse Stripe go-live automation.
 *
 * Automates the fiddly, error-prone parts of GO-LIVE-STRIPE.md:
 *   1. Creates the TWO webhook endpoints (Connect + Platform) at the prod
 *      /stripe/webhook URL, each subscribed to the exact 4 events the handler
 *      acts on - via the Stripe API, so no dashboard event-picking by hand.
 *   2. Captures both signing secrets and sets all three Stripe vars on Convex
 *      prod (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET).
 *
 * It is idempotent: endpoints are tagged with a marker in `description`; a second
 * run reuses the existing endpoint instead of creating duplicates. (Reused
 * endpoints don't re-expose their signing secret, so on reuse the script leaves
 * the corresponding Convex var untouched - delete the endpoint first if you need
 * a fresh secret.)
 *
 * What it CANNOT do (still yours, one-time, dashboard-only):
 *   - Enable Connect in live mode (account-level; usually already on if test
 *     Connect works).
 *   - Generate/reveal the live sk_live_ key.
 *   - Checkout / Connect branding.
 *   - Studios re-running Connect onboarding in live mode.
 *   - The data cleanup: run `convex run stripeConnect:_resetTestConnectStateForGoLive`.
 *
 * Usage:
 *   # Rehearsal - proves the flow in TEST mode, creates + DELETES throwaway
 *   # endpoints, never touches Convex env or your existing test webhooks:
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-go-live.mjs --rehearse
 *
 *   # Live - creates the two live endpoints and sets the three Convex prod vars:
 *   STRIPE_SECRET_KEY=sk_live_...  CONVEX_DEPLOY_KEY=...  \
 *     node scripts/stripe-go-live.mjs --apply
 *
 * Env:
 *   STRIPE_SECRET_KEY  (required) the key whose mode you're operating in.
 *   CONVEX_DEPLOY_KEY  (required for --apply) prod deploy key.
 *   WEBHOOK_URL        (optional) override; defaults to the prod Convex site URL.
 */
import Stripe from "stripe";
import { execFileSync } from "node:child_process";

const MARKER = "pulse-go-live"; // identifies endpoints this script owns
const WEBHOOK_URL =
  process.env.WEBHOOK_URL ?? "https://pastel-corgi-340.convex.site/stripe/webhook";
const EVENTS = [
  "account.updated",
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--rehearse")
    ? "rehearse"
    : null;

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!mode) die("Pass --rehearse (test, non-destructive) or --apply (live).");

const key = process.env.STRIPE_SECRET_KEY;
if (!key) die("STRIPE_SECRET_KEY is required.");
// Accept secret (sk_) or restricted (rk_) keys, live or test.
const keyMode = key.includes("_live_") ? "live" : key.includes("_test_") ? "test" : "unknown";

if (mode === "apply" && keyMode !== "live")
  die(`--apply needs a live key (sk_live_ or rk_live_); got ${keyMode}. (Use --rehearse for test.)`);
if (mode === "rehearse" && keyMode !== "test")
  die(`--rehearse expects a test key (sk_test_ or rk_test_); got ${keyMode}.`);
if (mode === "apply" && !process.env.CONVEX_DEPLOY_KEY)
  die("--apply needs CONVEX_DEPLOY_KEY to set the Convex prod vars.");

const stripe = new Stripe(key);

/** Find an endpoint this script previously created for the given connect flag. */
async function findOwned(connect) {
  const tag = `${MARKER}:${connect ? "connect" : "platform"}`;
  for await (const ep of stripe.webhookEndpoints.list({ limit: 100 })) {
    if ((ep.description ?? "").includes(tag)) return ep;
  }
  return null;
}

async function ensureEndpoint(connect) {
  const kind = connect ? "Connect" : "Platform";
  const tag = `${MARKER}:${connect ? "connect" : "platform"}`;
  const existing = await findOwned(connect);
  if (existing) {
    console.log(`  • ${kind}: reusing existing ${existing.id} (secret not re-exposed on reuse)`);
    return { id: existing.id, secret: null, reused: true };
  }
  const ep = await stripe.webhookEndpoints.create({
    url: WEBHOOK_URL,
    enabled_events: EVENTS,
    connect, // true => "events on connected accounts"
    description: `Pulse ${kind} webhook [${tag}]`,
  });
  console.log(`  • ${kind}: created ${ep.id} (${EVENTS.length} events, connect=${connect})`);
  return { id: ep.id, secret: ep.secret, reused: false };
}

function setConvexVar(name, value) {
  execFileSync("npx", ["convex", "env", "set", name, value, "--prod"], {
    stdio: ["ignore", "ignore", "inherit"],
    env: process.env,
  });
  console.log(`  • Convex prod: set ${name}`);
}

async function rehearse() {
  console.log(`\n▶ REHEARSAL (test mode) — creating throwaway endpoints, will delete them.\n`);
  const created = [];
  try {
    for (const connect of [true, false]) {
      const ep = await stripe.webhookEndpoints.create({
        url: WEBHOOK_URL,
        enabled_events: EVENTS,
        connect,
        description: `REHEARSAL ${MARKER} (delete me)`,
      });
      const ok = typeof ep.secret === "string" && ep.secret.startsWith("whsec_");
      console.log(
        `  • ${connect ? "Connect" : "Platform"}: created ${ep.id}, signing secret returned: ${ok ? "yes ✓" : "NO ✗"}`,
      );
      created.push(ep.id);
      if (!ok) throw new Error("Stripe did not return a signing secret — flow is broken.");
    }
    console.log(`\n✓ Webhook-creation flow works as designed (both endpoints + secrets).`);
  } finally {
    for (const id of created) {
      try {
        await stripe.webhookEndpoints.del(id);
        console.log(`  • cleaned up ${id}`);
      } catch (e) {
        console.error(`  ! could not delete ${id}: ${e.message}`);
      }
    }
  }
  console.log(`\n▶ Convex env-set path is exercised separately by the test harness.\n`);
}

async function apply() {
  console.log(`\n▶ LIVE go-live — creating webhooks + setting Convex prod vars.\n`);
  console.log(`  URL: ${WEBHOOK_URL}`);
  const connect = await ensureEndpoint(true);
  const platform = await ensureEndpoint(false);

  setConvexVar("STRIPE_SECRET_KEY", key);
  if (connect.secret) setConvexVar("STRIPE_CONNECT_WEBHOOK_SECRET", connect.secret);
  else console.log(`  • STRIPE_CONNECT_WEBHOOK_SECRET left as-is (endpoint reused)`);
  if (platform.secret) setConvexVar("STRIPE_WEBHOOK_SECRET", platform.secret);
  else console.log(`  • STRIPE_WEBHOOK_SECRET left as-is (endpoint reused)`);

  console.log(`\n✓ Live Stripe wired. Remaining (manual):`);
  console.log(`  1. Clear stale test state:`);
  console.log(`     npx convex run stripeConnect:_resetTestConnectStateForGoLive '{"dryRun": false}' --prod`);
  console.log(`  2. Redo Checkout + Connect branding in Stripe LIVE mode.`);
  console.log(`  3. Each studio re-connects Stripe (live) on /settings.\n`);
}

(mode === "rehearse" ? rehearse() : apply()).catch((e) => die(e.message));
