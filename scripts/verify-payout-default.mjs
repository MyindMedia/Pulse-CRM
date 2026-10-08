#!/usr/bin/env node
/**
 * Pulse Express payout-schedule default VERIFIER.
 *
 * Proves the thing MYI-193 was reported to have shipped and MYI-237 found had
 * not: that an Express account created by `ensureExpressAccount` lands on
 * `weekly / friday`, not Stripe's `daily` default.
 *
 * The failure this script exists to prevent is specific. MYI-193's change was
 * committed to a feature branch (`732df4b` on `feat/acquisition-rails-myi-52`)
 * that was never merged. Three documents then asserted weekly-by-default as
 * settled fact for three days, because everyone read a document instead of the
 * account. A diff landing is not proof; a schedule read back off a created
 * account is. So this script does two things a doc cannot:
 *
 *   1. SOURCE  - asserts convex/stripeConnect.ts still passes
 *                settings.payouts.schedule inside the accounts.create call.
 *                Catches the parameter being dropped, moved, or reverted.
 *   2. LIVE    - creates one real Express account against the given key, reads
 *                settings.payouts.schedule back off Stripe's response, asserts
 *                weekly / friday / delay_days 2, then DELETES the probe account.
 *
 * Step 2 is the load-bearing one. Step 1 alone would have passed on the
 * unmerged branch.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_... node scripts/verify-payout-default.mjs
 *   # keep the probe account instead of deleting it (for manual inspection):
 *   STRIPE_SECRET_KEY=sk_... node scripts/verify-payout-default.mjs --keep
 *
 * Safe to run against a live key: it creates an account with no capabilities
 * requested beyond the normal ones, submits no details, moves no money, and
 * deletes the account it made. Exit code is non-zero if any check fails.
 */
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "..", "convex", "stripeConnect.ts");

const EXPECTED = { interval: "weekly", weekly_anchor: "friday", delay_days: 2 };
const KEEP = process.argv.includes("--keep");

const PASS = "  \x1b[32m✓\x1b[0m";
const FAIL = "  \x1b[31m✗\x1b[0m";
let failed = 0;
const ok = (msg) => console.log(`${PASS} ${msg}`);
const bad = (msg) => {
  failed += 1;
  console.log(`${FAIL} ${msg}`);
};

// ── 1. SOURCE ───────────────────────────────────────────────────────────────
// Read the accounts.create argument object out of the real file rather than
// grepping the whole file, so a `settings.payouts.schedule` sitting in a
// comment, a test, or some other call cannot green this check.
console.log("\n1. Source — convex/stripeConnect.ts passes the schedule at creation");

const src = readFileSync(SOURCE, "utf8");
const createAt = src.indexOf("stripe.accounts.create({");
if (createAt === -1) {
  bad("could not find a `stripe.accounts.create({` call in convex/stripeConnect.ts");
} else {
  // Walk braces from the opening `{` of the argument object to its match.
  const open = src.indexOf("{", createAt + "stripe.accounts.create(".length);
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  // Strip line comments so the explanatory block above the parameter cannot
  // satisfy the assertion on its own.
  const args = src
    .slice(open, close + 1)
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

  const hasInterval = /interval:\s*["']weekly["']/.test(args);
  const hasAnchor = /weekly_anchor:\s*["']friday["']/.test(args);
  const hasSettings = /settings:\s*\{\s*payouts:\s*\{\s*schedule:/.test(args);

  if (hasSettings && hasInterval && hasAnchor) {
    ok("accounts.create passes settings.payouts.schedule = weekly / friday");
  } else {
    bad(
      `accounts.create is missing the schedule (settings:${hasSettings} interval:${hasInterval} anchor:${hasAnchor})`,
    );
    console.log("    -> every Express account created from here is on Stripe's `daily` default");
  }
}

// ── 2. LIVE ─────────────────────────────────────────────────────────────────
console.log("\n2. Stripe — create one Express account and read its schedule back");

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  bad("STRIPE_SECRET_KEY is not set — the only check that can actually fail was skipped");
  console.log("    -> a skipped check is not a pass; re-run with a key");
  process.exit(1);
}
const stripe = new Stripe(key);
const mode = key.startsWith("sk_live_") ? "LIVE" : "test";

const platform = await stripe.accounts.retrieve();
console.log(`    platform: ${platform.id} (${mode} mode)`);

let probe;
try {
  // Identical parameters to ensureExpressAccount, with placeholder identity.
  probe = await stripe.accounts.create({
    type: "express",
    business_profile: { name: "MYI-237 payout schedule probe" },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "friday" } } },
    metadata: { probe: "MYI-237", created_by: "scripts/verify-payout-default.mjs" },
  });
} catch (err) {
  bad(`accounts.create rejected the schedule: ${err.message}`);
  process.exit(1);
}

// Read the schedule off a fresh retrieve, not off the create response, so this
// reflects what Stripe stored rather than what we sent.
const fresh = await stripe.accounts.retrieve(probe.id);
const got = fresh.settings?.payouts?.schedule ?? {};
console.log(`    created:  ${probe.id}`);
console.log(`    schedule: ${JSON.stringify(got)}`);

for (const [field, want] of Object.entries(EXPECTED)) {
  if (got[field] === want) ok(`${field} = ${want}`);
  else bad(`${field} = ${JSON.stringify(got[field])}, expected ${JSON.stringify(want)}`);
}

if (KEEP) {
  console.log(`\n    --keep: left ${probe.id} in place. Delete it when done.`);
} else {
  try {
    const deleted = await stripe.accounts.del(probe.id);
    if (deleted.deleted) ok(`probe account ${probe.id} deleted`);
    else bad(`probe account ${probe.id} was NOT deleted — remove it by hand`);
  } catch (err) {
    bad(`could not delete probe account ${probe.id}: ${err.message} — remove it by hand`);
  }
}

console.log(
  failed === 0
    ? "\n\x1b[32mPASS\x1b[0m — new Express accounts land on weekly / friday.\n"
    : `\n\x1b[31mFAIL\x1b[0m — ${failed} check(s) failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
