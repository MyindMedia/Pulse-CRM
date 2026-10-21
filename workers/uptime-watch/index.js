// uptime-watch — route-loading uptime monitor on a Cloudflare cron trigger.
//
// Why it lives HERE and nowhere else: on 2026-10-05T00:59:23Z the Netlify
// account tripped its credit allowance and every host on it 503'd
// `{"error":"usage_exceeded"}` at the edge, while Netlify's own control plane
// still said `state: ready`. A watcher on Netlify would have been blocked by
// the same gate; a watcher on Convex shares the product's own backend; a
// watcher on one laptop only runs while that laptop is awake. Cloudflare is
// off-platform relative to both and always on.
//
// It does three jobs, because they are three halves of the same lesson — the
// third one added 2026-10-21 (MYI-266) after `main` stopped deploying for
// ELEVEN DAYS while both of the first two stayed green and correct:
//   every 10 min — do the live routes still answer? (the outage itself)
//   every hour   — is the Netlify credit balance about to run out? (the cause,
//                  visible in the audit log ~20h before any site 503s)
//   every 30 min — is each site SERVING WHAT WE WROTE, and did its last build
//                  pass? (a site can be perfectly up and completely frozen)
//
// Entry points:
//   scheduled()            — the cron triggers. Dispatched by an EXACT table,
//                            see CRON_JOBS; do not re-introduce prefix matching.
//   GET /check?token=...   — route check on demand, same alerting and state.
//   GET /drill?token=...   — fire the alert path against a deliberately bad URL
//                            and send a DRILL email, WITHOUT touching state.
//                            This is how we prove the alert path still works
//                            instead of trusting a green dashboard.
//   GET /credit?token=...  — credit check on demand.
//        &since=<iso>      — ...replaying billing history from a past instant
//                            without persisting. Proves the credit alert path
//                            against the real outage instead of a fake event.
//   GET /deploy?token=...  — deploy watch on demand, same alerting and state.
//        &dry=1            — ...read-only: no alert, no state write.
//   GET /deploy-drill?token=...&at=<iso>
//                          — replay the deploy watch at a past instant from the
//                            REAL deploy records and force the email. Writes no
//                            state. Defaults to 2026-10-20T12:00:00Z, i.e. day
//                            eleven of the freeze this check exists for.

// Routes that must return 200. Booking is first because it is the revenue
// path: a studio's customers land there and nowhere else.
// Keep this list in sync with scripts/uptime-check.sh.
const ROUTES = [
  "https://pulse.myindsound.com/book/kamiza-private-recording-house",
  "https://pulse.myindsound.com/",
  "https://studiopulse.tech/",
  "https://app.myindsound.com/",
  "https://www.myindsound.com/",
];

const ATTEMPTS = 3; // retry before alarming, so one edge blip does not page anyone
const BACKOFF_MS = 5_000; // between attempts
const TIMEOUT_MS = 15_000; // per request
const REALERT_MINUTES = 60; // while still down, re-send at most this often
const STATE_KEY = "uptime:state";

// --- credit watch -----------------------------------------------------------
const CREDIT_KEY = "credit:state";
const CREDIT_WARN_PCT = 75; // warn here, not at 100 — see the note in runCreditCheck
const AUDIT_PAGES = 2; // ~7 days of account activity per page on this account
// The audit actions that mean money. Everything else in that log is site noise.
const BILLING_ACTIONS = [
  "Payment failed",
  "Payment succeeded",
  "Credits purchased",
  "Credit balance depleted",
  "Credit balance recovered",
  "Usage limit enforced",
  "Sites disabled",
  "Sites enabled",
  "Account notified of credit balance threshold",
];
// Actions that should wake someone up. A succeeded payment is logged, not paged.
const BILLING_ALERTABLE = [
  "Payment failed",
  "Credit balance depleted",
  "Usage limit enforced",
  "Sites disabled",
  "Account notified of credit balance threshold",
];

const FROM = "Pulse Uptime <uptime@studiopulse.tech>";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Probe one URL, retrying. Resolves to a row describing the final attempt. */
async function probe(url) {
  let status = 0;
  let body = "";
  let error = "";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "myindsound-uptime-watch/1 (cloudflare-cron)" },
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Never let Cloudflare's cache answer for us — a cached 200 would hide
        // a live outage, which is the exact failure mode we are watching for.
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      status = res.status;
      error = "";
      // Read a slice of the body so we can name the cause in the alert.
      body = (await res.text()).slice(0, 300).replace(/\s+/g, " ").trim();
      if (status === 200) break;
    } catch (e) {
      status = 0;
      error = String(e && e.message ? e.message : e);
      body = "";
    }
    if (attempt < ATTEMPTS) await sleep(BACKOFF_MS);
  }

  return { url, status, ok: status === 200, body, error, why: status === 200 ? "" : diagnose(status, body, error) };
}

/** Name the cause in the alert itself, so the reader is not left guessing. */
function diagnose(status, body, error) {
  if (body.includes("usage_exceeded")) {
    return (
      "Netlify ACCOUNT allowance tripped (credits). Every host on the account is blocked at the edge — " +
      "not a bad deploy, not an app bug. Check: netlify api listAccountsForUser --data '{}' | grep usages_exceeded"
    );
  }
  if (status === 0) return `Request never completed: ${error || "unknown transport error"}`;
  if (status === 404) return "404 — route or deploy published without the page (check the publish dir / Next plugin).";
  if (status >= 500) return `Server error ${status}. Body: ${body || "<empty>"}`;
  return `Unexpected non-200 (${status}). Body: ${body || "<empty>"}`;
}

function renderReport(rows, startedAt) {
  const lines = [`Route uptime check — ${startedAt}`, "", "| result | code | url"];
  for (const r of rows) {
    lines.push(`| ${r.ok ? "PASS  " : "FAIL  "} | ${String(r.status).padStart(3, " ")} | ${r.url}`);
    if (!r.ok) lines.push(`      -> ${r.why}`);
  }
  const down = rows.filter((r) => !r.ok).length;
  lines.push("");
  lines.push(down ? `FAIL: ${down} of ${rows.length} routes are not serving.` : `PASS: all ${rows.length} routes returned 200.`);
  return lines.join("\n");
}

async function sendAlert(env, { subject, report, note }) {
  const key = env.RESEND_API_KEY;
  const to = (env.ALERT_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  // Fail loudly rather than returning a cheerful no-op: a monitor whose alert
  // path is unconfigured is worse than no monitor, because it reads as green.
  if (!key) return { sent: false, error: "RESEND_API_KEY is not set on the Worker" };
  if (!to.length) return { sent: false, error: "ALERT_TO is not set on the Worker" };

  const text = [note, "", report, "", "Monitor: Cloudflare Worker `uptime-watch` (cron */10). Source: Pulse-CRM workers/uptime-watch/."]
    .filter((s) => s !== undefined)
    .join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, text }),
  });
  const payload = await res.text();
  if (!res.ok) return { sent: false, error: `Resend ${res.status}: ${payload.slice(0, 300)}` };
  let id = "";
  try {
    id = JSON.parse(payload).id || "";
  } catch {
    /* keep the raw body in the log instead */
  }
  return { sent: true, id, to };
}

async function readState(env, key = STATE_KEY) {
  if (!env.STATE) return null;
  try {
    return await env.STATE.get(key, "json");
  } catch {
    return null;
  }
}

async function writeState(env, state, key = STATE_KEY) {
  if (!env.STATE) return;
  try {
    await env.STATE.put(key, JSON.stringify(state));
  } catch (e) {
    console.log(`state write failed (${key}): ${e}`);
  }
}

/** Run the real check, alert on a transition or a stale alert, persist state. */
async function runCheck(env, { trigger }) {
  const startedAt = new Date().toISOString();
  const rows = await Promise.all(ROUTES.map(probe));
  const failing = rows.filter((r) => !r.ok);
  const report = renderReport(rows, startedAt);
  const prev = (await readState(env)) || { status: "unknown", since: startedAt, lastAlertAt: null };

  let alert = { sent: false, skipped: "no change" };

  if (failing.length) {
    const wasDown = prev.status === "down";
    const ageMin = prev.lastAlertAt ? (Date.now() - Date.parse(prev.lastAlertAt)) / 60_000 : Infinity;
    if (!wasDown || ageMin >= REALERT_MINUTES) {
      alert = await sendAlert(env, {
        subject: `🔴 Pulse routes down — ${failing.length}/${rows.length} not serving`,
        report,
        note: wasDown
          ? `STILL DOWN since ${prev.since}. ${failing.length} of ${rows.length} routes are not serving.`
          : `${failing.length} of ${rows.length} live routes stopped serving. First failing check: ${startedAt}.`,
      });
    } else {
      alert = { sent: false, skipped: `already alerted ${Math.round(ageMin)}m ago; re-alert at ${REALERT_MINUTES}m` };
    }
    await writeState(env, {
      status: "down",
      since: prev.status === "down" ? prev.since : startedAt,
      lastAlertAt: alert.sent ? startedAt : prev.lastAlertAt,
      lastCheckAt: startedAt,
      failing: failing.map((r) => ({ url: r.url, status: r.status })),
      trigger,
    });
  } else {
    if (prev.status === "down") {
      alert = await sendAlert(env, {
        subject: "✅ Pulse routes recovered — all 200",
        report,
        note: `Recovered at ${startedAt}. Down since ${prev.since}.`,
      });
    }
    await writeState(env, {
      status: "up",
      since: prev.status === "up" ? prev.since : startedAt,
      lastAlertAt: alert.sent ? startedAt : prev.lastAlertAt,
      lastCheckAt: startedAt,
      failing: [],
      trigger,
    });
  }

  console.log(`[${trigger}] ${failing.length ? "FAIL" : "PASS"} — alert=${JSON.stringify(alert)}`);
  return { startedAt, trigger, ok: failing.length === 0, failing: failing.length, total: rows.length, alert, report };
}

/**
 * Fire the alert path on purpose. Appends a URL that cannot resolve, forces the
 * email, and deliberately does NOT write state — a drill must never make the
 * next real outage look like "already alerted".
 */
async function runDrill(env, badUrl) {
  const startedAt = new Date().toISOString();
  const target = badUrl || "https://uptime-drill.pulse.myindsound.com/this-host-does-not-exist";
  const rows = await Promise.all([...ROUTES.map(probe), probe(target)]);
  const failing = rows.filter((r) => !r.ok);
  const report = renderReport(rows, startedAt);
  const alert = await sendAlert(env, {
    subject: `🧪 DRILL — uptime alert path test (${failing.length} deliberate failure${failing.length === 1 ? "" : "s"})`,
    report,
    note:
      `This is a DRILL, not an outage. A deliberately unresolvable URL was added to the route list ` +
      `to prove the alert path delivers: ${target}\nNo monitor state was changed.`,
  });
  console.log(`[drill] alert=${JSON.stringify(alert)}`);
  return { startedAt, trigger: "drill", drillTarget: target, failing: failing.length, total: rows.length, alert, report };
}

// --- credit watch -----------------------------------------------------------
//
// Netlify's own credit alert cannot do this job. `credit_alert_percentage` is a
// DASHBOARD-ONLY field: PUT and PATCH return HTTP 200 with the full account
// object and the read-back never changes, `updated_at` included (re-measured
// 2026-10-07 with an Owner token, the account id rather than the slug, and three
// payload shapes). And even when set it fires at the threshold Netlify picked —
// during MYI-219 it was pinned at 100%, i.e. the first warning arrived at the
// moment every site went dark.
//
// The audit log is the only billing surface the API exposes, and it is early:
// on 2026-10-04 `Payment failed` was logged at 05:09:32Z and sites were not
// disabled until 2026-10-05T00:59:23Z — 19.84 hours of warning, unread.

async function netlifyJson(env, path) {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${env.NETLIFY_TOKEN}`, "User-Agent": "myindsound-uptime-watch/1" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`netlify ${path} -> HTTP ${res.status}`);
  return res.json();
}

/** Billing-relevant audit entries, newest first. */
async function billingEvents(env) {
  const out = [];
  for (let page = 1; page <= AUDIT_PAGES; page++) {
    const rows = await netlifyJson(env, `/accounts/${env.NETLIFY_ACCOUNT_ID}/audit?page=${page}&per_page=100`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const p = row.payload || {};
      if (!BILLING_ACTIONS.includes(p.action)) continue;
      const t = p.traits || {};
      out.push({
        at: p.timestamp || row.created_at,
        action: p.action,
        // Netlify RETRIES the same invoice_id, so a failure is only cleared by a
        // success carrying the SAME id. Keep it, do not count raw failures.
        invoiceId: t.invoice_id || null,
        amount: t.amount_due || t.amount || null,
        purchaseType: t.purchase_type || null,
        usagePercentage: typeof t.usage_percentage === "number" ? t.usage_percentage : null,
        cause: t.cause || t.reason || null,
      });
    }
  }
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out;
}

function renderCredit({ at, pct, used, included, exceeded, blockedSites, events }) {
  const lines = [`Netlify credit watch — ${at}`, ""];
  lines.push(
    `credits: ${used === null ? "unreadable" : `${used} of ${included} used`}` +
      (pct === null ? "" : ` (${pct}%)`) +
      `   warn at ${CREDIT_WARN_PCT}%`
  );
  lines.push(`usages_exceeded: ${exceeded.length ? JSON.stringify(exceeded) : "[] (not blocked)"}`);
  lines.push(`sites_with_usage_exceeded: ${blockedSites.length}`);
  lines.push("");
  lines.push(events.length ? "Billing events (newest first):" : "No billing events in the audit window.");
  for (const e of events.slice(0, 12)) {
    lines.push(
      `  ${e.at}  ${e.action}` +
        (e.invoiceId ? `  invoice=${e.invoiceId}` : "") +
        (e.amount ? `  amount=${e.amount}` : "") +
        (e.usagePercentage !== null ? `  usage=${e.usagePercentage}%` : "") +
        (e.cause ? `  (${e.cause})` : "")
    );
  }
  lines.push("");
  lines.push(
    "What this does NOT prove: `capabilities.credits.used` is an undocumented field and " +
      "`/accounts/{id}/credits` does not exist, so a 0 here is not evidence of a healthy balance. " +
      "The audit events are the signal that has actually fired before an outage."
  );
  return lines.join("\n");
}

/**
 * Alert on NEW alertable billing events, on entering a blocked state, and on
 * crossing the credit warn threshold. `sinceOverride` replays history without
 * persisting, so the alert path can be proven against the real MYI-219 chain.
 */
async function runCreditCheck(env, { trigger, sinceOverride }) {
  const at = new Date().toISOString();
  if (!env.NETLIFY_TOKEN || !env.NETLIFY_ACCOUNT_ID) {
    // Loud, not green: an unconfigured credit watch must never read as healthy.
    return { at, trigger, error: "NETLIFY_TOKEN / NETLIFY_ACCOUNT_ID not set on the Worker" };
  }

  const account = await netlifyJson(env, `/accounts/${env.NETLIFY_ACCOUNT_ID}`);
  const credits = ((account.capabilities || {}).credits) || {};
  const used = typeof credits.used === "number" ? credits.used : null;
  const included = typeof credits.included === "number" ? credits.included : null;
  const pct = used !== null && included ? Math.round((used / included) * 100) : null;
  const exceeded = account.usages_exceeded || [];
  const blockedSites = account.sites_with_usage_exceeded || [];
  const events = await billingEvents(env);

  const prev = (await readState(env, CREDIT_KEY)) || null;
  const cursor = sinceOverride || (prev && prev.cursor) || null;
  const newest = events.length ? events[0].at : at;

  const report = renderCredit({ at, pct, used, included, exceeded, blockedSites, events });
  let alert = { sent: false, skipped: "nothing new" };
  let reason = "";

  if (!prev && !sinceOverride) {
    // First run: establish the cursor and say so, rather than re-paging an
    // incident that is already closed. The baseline mail doubles as delivery proof.
    alert = await sendAlert(env, {
      subject: "🟡 Netlify credit watch armed",
      report,
      note:
        `Credit watch is now running hourly on Cloudflare. Baseline taken at ${at}; ` +
        `it will page on any NEW billing event after ${newest}, on entering a blocked state, ` +
        `and when credit use crosses ${CREDIT_WARN_PCT}%.`,
    });
    reason = "armed";
  } else {
    const fresh = events.filter((e) => BILLING_ALERTABLE.includes(e.action) && (!cursor || Date.parse(e.at) > Date.parse(cursor)));
    const nowBlocked = exceeded.length > 0;
    const wasBlocked = Boolean(prev && prev.blocked);
    const crossed = pct !== null && pct >= CREDIT_WARN_PCT && !(prev && prev.pct !== null && prev.pct >= CREDIT_WARN_PCT);

    if (fresh.length || (nowBlocked && !wasBlocked) || crossed) {
      reason = [
        fresh.length ? `${fresh.length} new billing event(s)` : "",
        nowBlocked && !wasBlocked ? "account entered a usage-exceeded state" : "",
        crossed ? `credit use crossed ${CREDIT_WARN_PCT}% (${pct}%)` : "",
      ]
        .filter(Boolean)
        .join("; ");
      alert = await sendAlert(env, {
        subject: nowBlocked
          ? "🔴 Netlify account is BLOCKED on usage — every host is dark"
          : `🟠 Netlify credit warning — ${reason}`,
        report,
        note:
          `${reason}.\n\n` +
          (fresh.length
            ? `New since ${cursor || "the beginning of the window"}:\n` +
              fresh.map((e) => `  ${e.at}  ${e.action}${e.invoiceId ? `  invoice=${e.invoiceId}` : ""}`).join("\n") +
              "\n\n"
            : "") +
          `A failed top-up invoice is retried under the SAME invoice id and is only cleared by a ` +
          `"Payment succeeded" carrying that id — a success on a different invoice does not clear it. ` +
          `Fix the card at app.netlify.com -> ${account.slug || "team"} -> Billing.`,
      });
    }
  }

  if (!sinceOverride) {
    await writeState(
      env,
      { cursor: newest, at, pct, used, included, blocked: exceeded.length > 0, lastAlertAt: alert.sent ? at : prev && prev.lastAlertAt, reason, trigger },
      CREDIT_KEY
    );
  }

  console.log(`[${trigger}] credit pct=${pct} blocked=${exceeded.length > 0} alert=${JSON.stringify(alert)}`);
  return { at, trigger, pct, used, included, blocked: exceeded.length > 0, cursor, newest, reason, alert, replayOnly: Boolean(sinceOverride), report };
}

// --- deploy watch (MYI-266) -------------------------------------------------
//
// `main` on MyindMedia/myind-sound stopped deploying on 2026-10-08 and nobody
// found out until 2026-10-20. Both checks above were green the whole time and
// both were RIGHT to be: the 2026-10-08 deploy served all five routes at 200,
// and the account never came near its credit ceiling. A site can be perfectly
// up and completely frozen. Neither of them asks the only question that would
// have caught it: is this site serving what we wrote, and did its last build
// pass?
//
// A laptop check (myind-sound `scripts/deploy-currency-check.mjs`, MYI-233) did
// catch it, inside 31 hours, and emailed 33 times. Two reasons this one exists
// anyway and is not a duplicate:
//   - It runs on ~60% of intervals, because launchd only runs while that Mac is
//     awake; measured over this incident, 440 readings where 729 were due, with
//     one 18.8-hour hole.
//   - It watches ONE site. Three hosts matter and the other two had nothing.
//
// What it reads, per site:
//   GET /sites/{id}                   -> published_deploy, build_settings
//   GET /sites/{id}/deploys?per_page  -> every ATTEMPT, including the failures;
//                                        a red build is not a published deploy
//                                        and appears nowhere in /sites/{id}
//   GET repos/{repo}/commits/{branch} -> the newest commit on the branch
//                                        (optional, see GITHUB_TOKEN below)
const DEPLOY_KEY = "deploy:state";
const DEPLOY_PER_PAGE = 10;
const DEPLOY_REPLAY_PER_PAGE = 100; // a replay must still reach the instant it replays
const DEPLOY_REALERT_MINUTES = 360; // 6h while a condition stands
const DEPLOY_FROZEN_DAYS = 3; // published this old with nothing newer is frozen
const DEPLOY_INFLIGHT_MINUTES = 60; // a build is "in flight" for at most this long

// The sites a freeze would cost us something. Deliberately not "every site on
// the account": 80 sites are on it, most are one-off static uploads with no
// repo, and a watcher that pages about those teaches the reader to ignore it —
// which is the failure mode that cost eleven days.
const DEPLOY_SITES = [
  {
    id: "579774c1-ab0e-402b-88dc-246c521531c2",
    name: "myind-sound",
    host: "app.myindsound.com",
    repo: "MyindMedia/myind-sound",
    branch: "main",
  },
  {
    id: "47075e5d-95eb-414c-a919-6293a48806ed",
    name: "myindsound",
    host: "www.myindsound.com",
    repo: "MyindMedia/myindsound-synergy",
    branch: "main",
  },
  {
    id: "0aadb515-829e-4566-819c-2dde04c7c5a1",
    name: "pulse-dash-kit",
    host: "studiopulse.tech",
    repo: "MyindMedia/Pulse-CRM",
    branch: "main",
  },
];

const FAILED_STATES = new Set(["error", "failed"]);
const INFLIGHT_STATES = new Set([
  "new",
  "pending_review",
  "accepted",
  "enqueued",
  "building",
  "uploading",
  "uploaded",
  "preparing",
  "prepared",
  "processing",
]);

const hours = (ms) => ms / 3_600_000;
const sha7 = (s) => (typeof s === "string" && s.length >= 7 ? s.slice(0, 7) : String(s ?? "none"));
const ageText = (ms) => {
  if (!Number.isFinite(ms)) return "unknown";
  // Negative is never a measurement — it is a restamped timestamp or clock skew.
  if (ms < 0) return `INVALID (${hours(-ms).toFixed(1)}h in the future)`;
  return hours(ms) < 24 ? `${hours(ms).toFixed(1)}h` : `${(hours(ms) / 24).toFixed(1)}d`;
};

/**
 * The newest commit on a branch, from GitHub.
 *
 * OPTIONAL, and loudly so. There is no read-only GitHub token in 1Password yet,
 * and the fleet's classic PAT carries `repo` WRITE on every repository — too
 * much to hand a Worker for one `GET`. So the three conditions that need only
 * Netlify run today and the one that needs GitHub reports itself as NOT RUN
 * rather than as passing. Set GITHUB_TOKEN (fine-grained, Contents: read, these
 * three repos) and condition 3 arms itself with no code change.
 *
 * Why it is needed at all when Netlify already lists the deploys: Netlify only
 * knows about commits it was TOLD about. When a build is refused before a
 * deploy object exists — the 2026-10-05 shape, `stop_builds` or a credit
 * ceiling — pushes land on GitHub and Netlify's newest record stays green and
 * old. Only GitHub can say "main moved and nothing even tried".
 */
async function githubHead(env, repo, branch) {
  if (!env.GITHUB_TOKEN) {
    return { sha: null, configured: false, reason: "GITHUB_TOKEN is not set on the Worker" };
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "myindsound-uptime-watch/1",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { sha: null, configured: true, reason: `github ${repo} -> HTTP ${res.status}` };
    }
    const body = await res.json();
    return { sha: body.sha || null, configured: true, reason: "" };
  } catch (e) {
    return { sha: null, configured: true, reason: String(e && e.message ? e.message : e) };
  }
}

/**
 * Judge one site. Returns facts plus a list of findings; `crit` findings are
 * what page. Pure-ish: all IO is done by the caller and passed in, so the
 * replay path and the live path judge identically.
 */
function judgeSite(site, { siteObj, deploys, head, now }) {
  const findings = [];
  const add = (id, severity, text) => findings.push({ id, severity, text });

  const published = siteObj?.published_deploy || null;
  const publishedSha = published?.commit_ref || null;
  const publishedAt = Date.parse(published?.published_at || published?.created_at || "");
  const publishedAge = Number.isFinite(publishedAt) ? now - publishedAt : NaN;

  const prod = (Array.isArray(deploys) ? deploys : []).filter(
    (d) => (d?.context ?? "production") === "production" && (!d?.branch || d.branch === site.branch)
  );
  const builds = prod.filter((d) => d?.commit_ref);
  const uploads = prod.filter((d) => !d?.commit_ref);
  const newest = builds[0] || null;

  if (!Array.isArray(deploys)) {
    // Condition 1 cannot run. Say so; never let it read as a pass.
    add(
      "deploys_unreadable",
      "crit",
      "Could not read the deploys list for this site, so a FAILED build would be invisible to this reading."
    );
  }

  // --- condition 1: the newest build attempt failed.
  // The whole reason this check exists. GET /sites/{id} carries published_deploy
  // only, so two red builds on 2026-10-10 were invisible to every other signal.
  let consecutiveFailures = 0;
  for (const d of builds) {
    if (FAILED_STATES.has(String(d.state))) consecutiveFailures += 1;
    else break;
  }
  if (consecutiveFailures > 0 && newest) {
    add(
      "build_failed",
      "crit",
      `THE LAST BUILD FAILED. ${consecutiveFailures} consecutive production build(s) on ${site.branch} ended in ` +
        `\`${newest.state}\`; newest ${sha7(newest.commit_ref)} at ${newest.created_at} ` +
        `(${ageText(now - Date.parse(newest.created_at || ""))} ago)` +
        (newest.error_message
          ? `, "${String(newest.error_message).replace(/\s+/g, " ").slice(0, 160)}"`
          : "") +
        ". Reproduce against the COMMITTED tree, not your working tree — an uncommitted `prettier --write` is " +
        "exactly what did this: git archive HEAD | (mkdir -p /tmp/t && tar -x -C /tmp/t)"
    );
  }

  // --- condition 4: a CLI upload is published.
  // Checked before condition 2 on purpose: "not tracking the branch at all" is
  // a different, worse statement than "behind the branch", and a null
  // commit_ref makes every commit comparison below meaningless.
  if (published && !publishedSha) {
    add(
      "nocommit_published",
      "crit",
      `The PUBLISHED deploy has NO commit_ref (state ${published.state ?? "?"}, published ` +
        `${published.published_at ?? published.created_at ?? "?"}). That is a \`netlify deploy\` CLI upload, not a ` +
        "build of a commit: this site is not tracking its branch at all, and a Mac-built upload can ship the wrong " +
        "native binaries into a Linux runtime (MYI-254)."
    );
  } else if (!published) {
    add("never_published", "crit", "This site has no published_deploy at all.");
  }

  // --- condition 2: the published commit is not the newest one Netlify has.
  // Netlify-internal, so it needs no GitHub token, and it is TRUE for the whole
  // eleven days: published 13ba030 `ready` while the newest attempt was `error`.
  if (publishedSha && newest && newest.commit_ref !== publishedSha) {
    const newestAge = now - Date.parse(newest.created_at || "");
    const inflight = INFLIGHT_STATES.has(String(newest.state));
    const young = Number.isFinite(newestAge) && newestAge < DEPLOY_INFLIGHT_MINUTES * 60_000;
    if (inflight && young) {
      add(
        "build_inflight",
        "info",
        `A newer build is in flight: ${sha7(newest.commit_ref)} is \`${newest.state}\` (${ageText(newestAge)}). ` +
          "Not alarmed on — every push looks like this for about three minutes."
      );
    } else {
      add(
        "published_not_newest",
        "crit",
        `MASKED: the published deploy is ${sha7(publishedSha)} but Netlify's newest attempt on ${site.branch} is ` +
          `${sha7(newest.commit_ref)} \`${newest.state}\` from ${newest.created_at} (${ageText(newestAge)} ago). ` +
          "An older green deploy is serving over a newer one, which is why every route answers 200 and why nothing " +
          "else on this fleet notices."
      );
    }
  }

  // --- condition 2, full strength: published vs the branch head on GitHub.
  if (head?.sha && publishedSha && head.sha !== publishedSha) {
    const lagOk = Number.isFinite(publishedAge);
    if (!lagOk || publishedAge >= DEPLOY_INFLIGHT_MINUTES * 60_000) {
      add(
        "behind_branch",
        "crit",
        `STALE: published ${sha7(publishedSha)} != ${site.repo}@${site.branch} ${sha7(head.sha)}. The published ` +
          `deploy is ${ageText(publishedAge)} old. EQUALITY is the pass condition, not ancestry — "published is an ` +
          'ancestor of the branch" is true for an arbitrarily stale site.'
      );
    }
  }

  // --- condition 3: frozen. Needs GitHub to be worth a page, because only
  // GitHub can say the branch moved while Netlify created no record at all.
  const frozen = Number.isFinite(publishedAge) && publishedAge >= DEPLOY_FROZEN_DAYS * 86_400_000;
  if (frozen && head?.sha && publishedSha && head.sha !== publishedSha) {
    add(
      "frozen",
      "crit",
      `FROZEN: nothing has been published for ${ageText(publishedAge)} and ${site.branch} has moved. Pushes that are ` +
        "refused before a build object exists (a credit ceiling, or build_settings.stop_builds) create NO failed " +
        "build to retry and NOTHING tells you — clearing the lock queues nothing, you must createSiteBuild by hand."
    );
  } else if (frozen && !head?.configured) {
    add(
      "frozen_unverified",
      "warn",
      `Nothing published for ${ageText(publishedAge)}. Whether ${site.branch} has moved could not be checked ` +
        `(${head?.reason || "no GitHub read"}), so this is a quiet site or a frozen one and this run cannot tell ` +
        "which. Set GITHUB_TOKEN to make it decidable."
    );
  }

  // --- the build-stop switches. Cheap, and the 2026-10-05 shape.
  const bs = siteObj?.build_settings || {};
  if (bs.stop_builds === true || bs.skip_automatic_builds === true) {
    add(
      "builds_disabled",
      "crit",
      `Push-to-deploy is OFF for this site: stop_builds=${JSON.stringify(bs.stop_builds)}, ` +
        `skip_automatic_builds=${JSON.stringify(bs.skip_automatic_builds)}. Pushes land on the repo and build nothing.`
    );
  }

  if (!head?.configured) {
    add(
      "github_not_configured",
      "warn",
      `Branch head not read (${head?.reason || "unknown"}). Conditions that compare against the repository are NOT ` +
        "running: a build that never fired at all would not be caught by this reading."
    );
  } else if (!head.sha) {
    add("github_unreadable", "crit", `Branch head unreadable: ${head.reason}.`);
  }

  return {
    site: site.name,
    host: site.host,
    repo: site.repo,
    branch: site.branch,
    publishedSha,
    publishedState: published?.state ?? null,
    publishedAt: published?.published_at ?? published?.created_at ?? null,
    publishedAgeHours: Number.isFinite(publishedAge) ? Number(hours(publishedAge).toFixed(1)) : null,
    newestBuild: newest
      ? { sha: newest.commit_ref, state: newest.state, at: newest.created_at }
      : null,
    branchHead: head?.sha ?? null,
    consecutiveFailures,
    buildRecords: builds.length,
    cliUploads: uploads.length,
    findings,
    recent: builds.slice(0, 5).map(
      (d) =>
        `${d.created_at}  ${String(d.state).padEnd(8)}  ${sha7(d.commit_ref)}` +
        (d.error_message ? `  ${String(d.error_message).replace(/\s+/g, " ").slice(0, 100)}` : "")
    ),
  };
}

/** One site's IO. `replayAt` reconstructs a past instant from the real records. */
async function readSite(env, site, { replayAt }) {
  const perPage = replayAt ? DEPLOY_REPLAY_PER_PAGE : DEPLOY_PER_PAGE;
  const [siteObj, deploys, head] = await Promise.all([
    netlifyJson(env, `/sites/${site.id}`).catch(() => null),
    netlifyJson(env, `/sites/${site.id}/deploys?per_page=${perPage}`).catch(() => null),
    replayAt
      ? Promise.resolve({ sha: null, configured: false, reason: "replay: branch head then is unknown" })
      : githubHead(env, site.repo, site.branch),
  ]);

  if (!replayAt) return { siteObj, deploys, head };

  // Rewind. Drop every record created after the instant, then reconstruct what
  // was PUBLISHED then: the newest production deploy that had reached `ready`.
  //
  // `published_at` is NOT fixed at a deploy's birth — re-publishing an old
  // deploy restamps it with today, so taking the field at face value dated the
  // eleven-day freeze to the FUTURE. Anything stamped after the instant had not
  // happened yet, so fall back to created_at.
  const cut = Date.parse(replayAt);
  const kept = (Array.isArray(deploys) ? deploys : []).filter(
    (d) => Date.parse(d?.created_at || "") <= cut
  );
  const wasPublished =
    kept.find((d) => d?.state === "ready" && (d?.context ?? "production") === "production") || null;
  const stampedBefore = (d) => {
    const p = Date.parse(d?.published_at || "");
    return Number.isFinite(p) && p <= cut ? d.published_at : d?.created_at || null;
  };
  return {
    siteObj: {
      ...(siteObj || {}),
      published_deploy: wasPublished
        ? {
            id: wasPublished.id,
            state: wasPublished.state,
            commit_ref: wasPublished.commit_ref,
            branch: wasPublished.branch,
            published_at: stampedBefore(wasPublished),
          }
        : null,
    },
    deploys: kept,
    head,
  };
}

function renderDeploy(rows, at, { replayAt } = {}) {
  const lines = [`Deploy watch — ${at}`];
  if (replayAt) lines.push(`REPLAY of the real records as they stood at ${replayAt}.`);
  for (const r of rows) {
    lines.push("");
    lines.push(`── ${r.site}  (${r.host})  ${r.repo}@${r.branch}`);
    lines.push(
      `   published ${sha7(r.publishedSha)} ${r.publishedState ?? "?"}  ${r.publishedAt ?? "?"}` +
        (r.publishedAgeHours === null ? "" : `  (${r.publishedAgeHours}h old)`)
    );
    lines.push(
      `   newest build ${r.newestBuild ? `${sha7(r.newestBuild.sha)} ${r.newestBuild.state} ${r.newestBuild.at}` : "none"}` +
        `   branch head ${sha7(r.branchHead)}`
    );
    const crit = r.findings.filter((f) => f.severity === "crit");
    const warn = r.findings.filter((f) => f.severity === "warn");
    const info = r.findings.filter((f) => f.severity === "info");
    if (!crit.length && !warn.length) lines.push("   OK");
    for (const f of crit) lines.push(`   [CRIT] ${f.text}`);
    for (const f of warn) lines.push(`   [warn] ${f.text}`);
    for (const f of info) lines.push(`   [info] ${f.text}`);
    if (crit.some((f) => f.id === "build_failed") && r.recent.length) {
      lines.push("   recent attempts (newest first):");
      for (const l of r.recent) lines.push(`     ${l}`);
    }
  }
  lines.push("");
  lines.push(
    "What a 200 from these hosts does NOT prove: that they are serving the commit we wrote. That is the whole " +
      "point of this check — on 2026-10-08 app.myindsound.com went green-and-frozen for eleven days."
  );
  return lines.join("\n");
}

/** Stable identity of the CURRENT set of firing conditions, across all sites. */
function deployFingerprint(rows) {
  return rows
    .flatMap((r) => r.findings.filter((f) => f.severity === "crit").map((f) => `${r.site}:${f.id}`))
    .sort()
    .join(",");
}

/**
 * The deploy watch.
 *
 * Alerting rule, and it is the card's rule: ALERT ON THE FIRST OCCURRENCE. A
 * red build is already the alert — there is no flapping to smooth and no reason
 * to wait for a second confirmation of a build that has already failed. Then
 * re-alert every DEPLOY_REALERT_MINUTES while the same set stands, and alert
 * immediately again if the SET changes, so a second site breaking during a
 * standing incident is not swallowed by the cooldown.
 *
 * `replayAt` and `drill` never write state. A drill that leaves the next real
 * freeze looking like "already alerted" is worse than no drill.
 */
async function runDeployCheck(env, { trigger, replayAt = null, drill = false, dry = false }) {
  const at = new Date().toISOString();
  if (!env.NETLIFY_TOKEN) {
    return { at, trigger, error: "NETLIFY_TOKEN is not set on the Worker" };
  }
  const now = replayAt ? Date.parse(replayAt) : Date.now();
  if (replayAt && !Number.isFinite(now)) {
    return { at, trigger, error: `at=${replayAt} is not a parseable timestamp` };
  }

  const rows = [];
  for (const site of DEPLOY_SITES) {
    const io = await readSite(env, site, { replayAt });
    rows.push(judgeSite(site, { ...io, now }));
  }

  const report = renderDeploy(rows, at, { replayAt });
  const fingerprint = deployFingerprint(rows);
  const failing = rows.filter((r) => r.findings.some((f) => f.severity === "crit"));
  const prev = (await readState(env, DEPLOY_KEY)) || null;
  let alert = { sent: false, skipped: "nothing firing" };

  if (drill) {
    alert = await sendAlert(env, {
      subject: `🧪 DRILL — deploy watch (${failing.length} site(s) firing${replayAt ? `, replay of ${replayAt}` : ""})`,
      report,
      note:
        "This is a DRILL, not a live incident. It replays the REAL Netlify deploy records as they stood at " +
        `${replayAt}, so if this email reads badly it would have read badly during the outage. ` +
        "No monitor state was changed.",
    });
    return { at, trigger: "deploy-drill", replayAt, failing: failing.length, fingerprint, alert, rows, report };
  }

  if (fingerprint) {
    const ageMin = prev?.lastAlertAt ? (Date.now() - Date.parse(prev.lastAlertAt)) / 60_000 : Infinity;
    const changed = prev?.fingerprint !== fingerprint;
    if (changed || ageMin >= DEPLOY_REALERT_MINUTES) {
      alert = await sendAlert(env, {
        subject: `🔴 Deploy watch — ${failing.map((r) => r.site).join(", ")} not serving what we wrote`,
        report,
        note: changed
          ? `${failing.length} site(s) firing. First reading of this exact condition set: ${at}.`
          : `STILL FIRING since ${prev?.since ?? "?"}. Unchanged for ${Math.round(ageMin)} minutes.`,
      });
    } else {
      alert = {
        sent: false,
        skipped: `unchanged, alerted ${Math.round(ageMin)}m ago; re-alert at ${DEPLOY_REALERT_MINUTES}m`,
      };
    }
  } else if (prev?.fingerprint) {
    alert = await sendAlert(env, {
      subject: "✅ Deploy watch recovered — every site is serving its branch head",
      report,
      note: `Recovered at ${at}. Firing since ${prev.since ?? "?"} (${prev.fingerprint}).`,
    });
  }

  if (!dry && !replayAt) {
    await writeState(
      env,
      {
        at,
        fingerprint,
        since: fingerprint && prev?.fingerprint === fingerprint ? prev.since : fingerprint ? at : null,
        lastAlertAt: alert.sent ? at : (prev && prev.lastAlertAt) || null,
        failing: failing.map((r) => r.site),
        trigger,
      },
      DEPLOY_KEY
    );
  }

  console.log(`[${trigger}] deploy failing=${failing.length} fp="${fingerprint}" alert=${JSON.stringify(alert)}`);
  return { at, trigger, failing: failing.length, fingerprint, alert, rows, report, dry, replayAt };
}

function authed(url, env) {
  const given = url.searchParams.get("token") || "";
  return Boolean(env.TRIGGER_TOKEN) && given === env.TRIGGER_TOKEN;
}

// Which cron runs which job. EXACT STRINGS, not a prefix test.
//
// This used to be a startsWith test on the cron expression's leading slash-star,
// which was correct for exactly as long as there were two crons and only one of
// them was minute-based. Adding the deploy watch every 30 minutes under that
// rule would have silently run the ROUTE check a third time every half hour and
// the deploy watch NEVER — a monitor deployed, scheduled, green in every
// dashboard, and not running. The trap is that a prefix test cannot fail; it
// can only answer wrongly.
//
// (And note this comment cannot be a /** */ block: a cron expression contains
// the two characters that close one, which is its own small lesson about
// putting crons in docstrings.)
//
// scripts/cf/deploy-uptime-watch.sh asserts every cron it is about to install
// appears as a key here, and refuses to deploy otherwise, so the mismatch is
// caught at deploy time instead of by its own silence.
const CRON_JOBS = {
  "*/10 * * * *": runCheck,
  "17 * * * *": runCreditCheck,
  "*/30 * * * *": runDeployCheck,
};

export default {
  async scheduled(event, env, ctx) {
    const job = CRON_JOBS[event.cron];
    if (job) {
      ctx.waitUntil(job(env, { trigger: `cron:${event.cron}` }));
      return;
    }
    // An unrecognised cron is a configuration error, and the one thing it must
    // not do is nothing. Run everything, and say so loudly in the log.
    console.log(
      `[cron:${event.cron}] UNRECOGNISED cron expression — not in CRON_JOBS. Running all three checks. ` +
        "Fix the schedule or the table; they are meant to be deployed together."
    );
    ctx.waitUntil(
      Promise.all([
        runCheck(env, { trigger: `cron:${event.cron}:fallback` }),
        runCreditCheck(env, { trigger: `cron:${event.cron}:fallback` }),
        runDeployCheck(env, { trigger: `cron:${event.cron}:fallback` }),
      ])
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

    if (url.pathname === "/" || url.pathname === "/health") {
      // Unauthenticated liveness only — this says the WATCHER is alive, which is
      // a different claim from "the routes are up". Do not confuse the two.
      return json({ worker: "uptime-watch", alive: true, now: new Date().toISOString() });
    }

    if (url.pathname === "/state") {
      if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
      return json({
        routes: (await readState(env)) || { status: "unknown" },
        credit: (await readState(env, CREDIT_KEY)) || { status: "unknown" },
        deploy: (await readState(env, DEPLOY_KEY)) || { status: "unknown" },
        crons: Object.keys(CRON_JOBS),
        githubConfigured: Boolean(env.GITHUB_TOKEN),
      });
    }

    if (url.pathname === "/credit") {
      if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
      try {
        const out = await runCreditCheck(env, { trigger: "manual", sinceOverride: url.searchParams.get("since") });
        return json(out, out.error ? 500 : 200);
      } catch (e) {
        return json({ error: String(e && e.message ? e.message : e) }, 502);
      }
    }

    if (url.pathname === "/check") {
      if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
      const out = await runCheck(env, { trigger: "manual" });
      return json(out, out.ok ? 200 : 503);
    }

    if (url.pathname === "/drill") {
      if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
      return json(await runDrill(env, url.searchParams.get("bad")));
    }

    if (url.pathname === "/deploy") {
      if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
      try {
        const out = await runDeployCheck(env, {
          trigger: "manual",
          dry: url.searchParams.get("dry") === "1",
        });
        return json(out, out.error ? 500 : out.failing ? 503 : 200);
      } catch (e) {
        return json({ error: String(e && e.message ? e.message : e) }, 502);
      }
    }

    if (url.pathname === "/deploy-drill") {
      if (!authed(url, env)) return json({ error: "unauthorized" }, 401);
      try {
        // Default: day eleven of the 2026-10-08 freeze. Two red builds on main,
        // masked by the green 2026-10-08 publish. Real records, not a fixture.
        const out = await runDeployCheck(env, {
          trigger: "deploy-drill",
          replayAt: url.searchParams.get("at") || "2026-10-20T12:00:00Z",
          drill: true,
        });
        return json(out, out.error ? 500 : 200);
      } catch (e) {
        return json({ error: String(e && e.message ? e.message : e) }, 502);
      }
    }

    return json(
      {
        error: "not found",
        paths: ["/health", "/state", "/check", "/drill", "/credit", "/deploy", "/deploy-drill"],
      },
      404
    );
  },
};
