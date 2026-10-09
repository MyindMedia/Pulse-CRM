#!/usr/bin/env node
/* Does the booking-funnel counter still write? Asked from a real browser.
 *
 * WHY THIS EXISTS. `src/lib/use-booking-funnel.ts` swallows every failure by
 * design - a dropped measurement must never cost a booking - and that is the
 * right call on a booking page. It is also the shape that turns a broken write
 * into a confident zero: nothing on screen, nothing in a log, and a funnel
 * report that tells every studio it had no visitors no matter what its traffic
 * was. On 2026-10-04 the newest `bookingVisits` row was 41 days old and no one
 * could say whether that was an empty funnel or a dead gauge (MYI-226). It took
 * a person an hour to answer. This script answers it in a minute.
 *
 * WHAT IT PROVES, and why it needs no credentials. The write happens in a
 * `useEffect` after hydration, over the Convex websocket, so a `curl` of the
 * HTML proves nothing about it. This drives Chromium at the live page and reads
 * the websocket itself: it matches the `Mutation` frame for
 * `bookingFunnel:track` to its `MutationResponse` by `requestId` and requires
 * BOTH `success: true` and `result.ok: true`. Those are two different facts and
 * conflating them is how this check would have gone permanently green on a dead
 * counter: `success: true` only means the function returned without throwing,
 * and `track` returns `{ ok: false }` without inserting anything when the slug
 * resolves to no org, when the visitorKey is under 8 characters, or when the
 * 5,000/day volume guard trips. `result.ok` is the only field that means a row.
 * With it, the chain bundle -> hydration -> effect -> websocket -> mutation ->
 * row is covered with no admin key at all. Credential-free is what lets this
 * run on a GitHub runner, the only place independent of both Netlify and Convex.
 *
 * WHICH PAGE. Myind Sound's own booking page, never a customer's. The probe
 * writes a real row every run, and a row in a client's funnel is a lie to that
 * client. `?utm_source=uptime-probe` makes the rows label themselves: the
 * funnel groups by `utmSource`, so every probe visit lands in its own
 * `uptime-probe` source bucket instead of masquerading as traffic.
 *
 * Usage:  node scripts/funnel-liveness.mjs [url]
 * Exit:   0 = the counter wrote
 *         1 = the page served but the write did not happen  <- the real alarm
 *         2 = the page did not serve, so there is nothing to measure. That is
 *             scripts/uptime-check.sh's alarm; do not page twice for one fault.
 *
 * Needs Playwright + Chromium, which this repo does NOT depend on (it is an ops
 * script, not app code, and must not pull a browser into the app's lockfile):
 *   npm i -g playwright && playwright install chromium
 */

const DEFAULT_URL =
  "https://pulse.myindsound.com/book/myind-sound?utm_source=uptime-probe";

// The effect fires after hydration, not after load. Chromium on a cold CI
// runner pulling a cold CDN needs room; a write that lands at 11s is a healthy
// write, and calling it a failure would page someone over a slow runner.
const HYDRATION_BUDGET_MS = 20_000;
const NAV_TIMEOUT_MS = 60_000;

async function loadPlaywright() {
  // Resolved at run time from wherever it is installed, so the script works
  // both on a GitHub runner (global install) and on a laptop that already has
  // a Playwright checkout. A missing browser must name its own fix.
  const candidates = [
    "playwright",
    "/usr/local/lib/node_modules/playwright/index.mjs",
    `${process.env.HOME}/.claude/tools/browser-check/node_modules/playwright/index.mjs`,
  ];
  for (const spec of candidates) {
    try {
      return await import(spec);
    } catch {
      /* try the next one */
    }
  }
  console.error(
    "FAIL: Playwright is not installed. Install it with:\n" +
      "  npm i -g playwright && playwright install chromium",
  );
  process.exit(2);
}

const url = process.argv[2] ?? DEFAULT_URL;
const { chromium } = await loadPlaywright();

const sent = [];
const received = [];
const consoleErrors = [];
const failedRequests = [];

const browser = await chromium.launch();
// A fresh context every run: `visitorKey` lives in sessionStorage, so a new
// context is a new visitor and a new row. Reusing one would dedupe the probe
// away and the check would go permanently green on a dead counter.
const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 myindsound-funnel-liveness/1",
});
const page = await context.newPage();

page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on("requestfailed", (r) =>
  failedRequests.push(`${r.url()} :: ${r.failure()?.errorText ?? "unknown"}`),
);
page.on("websocket", (ws) => {
  const text = (f) =>
    typeof f.payload === "string" ? f.payload : f.payload.toString("utf8");
  ws.on("framesent", (f) => {
    const s = text(f);
    if (s.includes("bookingFunnel:track")) sent.push(s);
  });
  ws.on("framereceived", (f) => {
    const s = text(f);
    if (s.includes("MutationResponse")) received.push(s);
  });
});

let status = 0;
try {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: NAV_TIMEOUT_MS,
  });
  status = response?.status() ?? 0;
} catch (err) {
  console.error(`\nSITE DOWN: ${url} did not load (${err.message})`);
  console.error("This is scripts/uptime-check.sh's alarm, not a counter fault.");
  await browser.close();
  process.exit(2);
}

if (status !== 200) {
  console.error(`\nSITE DOWN: ${url} answered HTTP ${status}.`);
  console.error("This is scripts/uptime-check.sh's alarm, not a counter fault.");
  await browser.close();
  process.exit(2);
}

await page.waitForTimeout(HYDRATION_BUDGET_MS);

const visitorKey = await page.evaluate(() => {
  try {
    return window.sessionStorage.getItem("pulse:visit");
  } catch {
    return "STORAGE_BLOCKED";
  }
});
// Read the heading AFTER the hydration budget, not before it. This page renders
// its studio name from a Convex query, so reading it at domcontentloaded always
// returns "(no h1)" and the report looks broken on a healthy run.
const renderedHeading = await page
  .locator("h1")
  .first()
  .innerText({ timeout: 5_000 })
  .catch(() => "");

await browser.close();

function parse(frame) {
  try {
    return JSON.parse(frame);
  } catch {
    return null;
  }
}

// Match response to request. Other mutations can be in flight on the same
// socket, so counting bare MutationResponse frames would credit this check with
// somebody else's success.
const trackRequestIds = new Set(
  sent.map(parse).filter(Boolean).map((m) => m.requestId),
);
const ours = received
  .map(parse)
  .filter((m) => m && trackRequestIds.has(m.requestId));

// Two separate facts, deliberately not collapsed. `success` is "the function
// did not throw"; `result.ok` is "a row exists". A slug that resolves to no org
// returns success:true with ok:false and writes nothing.
const threw = ours.filter((m) => m.success !== true);
const wrote = ours.filter((m) => m.success === true && m.result?.ok === true);
const refusedByHandler = ours.filter(
  (m) => m.success === true && m.result?.ok !== true,
);
const deduped = wrote.filter((m) => m.result?.deduped === true);

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
console.log(`\nBooking-funnel counter — ${stamp}`);
console.log(`url            ${url}`);
console.log(`http           ${status}`);
console.log(`rendered       ${renderedHeading || "(no h1)"}`);
console.log(`visitorKey     ${visitorKey ?? "(none minted)"}`);
console.log(`track sent     ${sent.length}`);
console.log(`row written    ${wrote.length}${deduped.length > 0 ? " (deduped)" : ""}`);

if (wrote.length > 0) {
  if (deduped.length === wrote.length) {
    // A fresh browser context mints a fresh visitorKey, so a dedupe here means
    // a key collision, which does not happen. Pass - the write path demonstrably
    // reached the dedupe check - but say so rather than claim a new row.
    console.log(
      "\nPASS: the write path is alive, but the server deduped this visit " +
        "rather than inserting. Unexpected from a fresh context; worth a look.",
    );
  } else {
    console.log("\nPASS: the booking page wrote a funnel row from a real browser.");
  }
  process.exit(0);
}

// Name the cause in the alert. Each branch below is a different fault with a
// different owner, and "the counter is broken" alone sends whoever is on call
// reading the one file that is working.
console.error("\nFAIL: the booking page served but recorded no funnel visit.");
if (visitorKey === "STORAGE_BLOCKED") {
  console.error(
    "  -> sessionStorage is blocked, so visitorKey() returns null and the hook " +
      "no-ops by design. Check the browser profile, not the app.",
  );
} else if (visitorKey === null) {
  console.error(
    "  -> No visitorKey was minted. The effect in src/lib/use-booking-funnel.ts " +
      "never ran: suspect hydration (the page is under a Suspense boundary) or a " +
      "bundle that threw before the effect.",
  );
} else if (sent.length === 0) {
  console.error(
    "  -> A key was minted but no bookingFunnel:track frame left the browser. " +
      "Suspect the Convex client never connected (check NEXT_PUBLIC_CONVEX_URL " +
      "and src/lib/convex-url.ts) or the effect's guards short-circuited.",
  );
} else if (threw.length > 0) {
  console.error(
    "  -> The mutation was sent and the server THREW. The silent catch in " +
      "use-booking-funnel.ts hid this from the visitor. Server response:",
  );
  for (const m of threw.slice(0, 3)) {
    console.error(`     ${JSON.stringify(m).slice(0, 300)}`);
  }
} else if (refusedByHandler.length > 0) {
  console.error(
    "  -> The mutation RAN and returned ok:false, so nothing was inserted. " +
      "convex/bookingFunnel.ts returns that for exactly three reasons: the slug " +
      "resolves to no org (check the url's slug against orgs.slug), the " +
      "visitorKey is under 8 characters after cleanKey(), or the org is over the " +
      "5,000-rows-per-day volume guard. Server response:",
  );
  for (const m of refusedByHandler.slice(0, 3)) {
    console.error(`     ${JSON.stringify(m).slice(0, 300)}`);
  }
} else {
  console.error(
    "  -> The mutation was sent and nothing came back within " +
      `${HYDRATION_BUDGET_MS / 1000}s. Suspect the websocket dropped mid-flight, ` +
      "or the Convex deployment is refusing connections.",
  );
}
if (consoleErrors.length > 0) {
  console.error("\n  console errors:");
  for (const e of consoleErrors.slice(0, 8)) console.error(`     ${e}`);
}
if (failedRequests.length > 0) {
  console.error("\n  failed requests:");
  for (const r of failedRequests.slice(0, 8)) console.error(`     ${r}`);
}
process.exit(1);
