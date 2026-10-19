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
// It does two jobs, because they are two halves of the same lesson:
//   every 10 min — do the live routes still answer? (the outage itself)
//   every hour   — is the Netlify credit balance about to run out? (the cause,
//                  visible in the audit log ~20h before any site 503s)
//
// Entry points:
//   scheduled()            — the cron triggers.
//   GET /check?token=...   — route check on demand, same alerting and state.
//   GET /drill?token=...   — fire the alert path against a deliberately bad URL
//                            and send a DRILL email, WITHOUT touching state.
//                            This is how we prove the alert path still works
//                            instead of trusting a green dashboard.
//   GET /credit?token=...  — credit check on demand.
//        &since=<iso>      — ...replaying billing history from a past instant
//                            without persisting. Proves the credit alert path
//                            against the real outage instead of a fake event.

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

function authed(url, env) {
  const given = url.searchParams.get("token") || "";
  return Boolean(env.TRIGGER_TOKEN) && given === env.TRIGGER_TOKEN;
}

export default {
  async scheduled(event, env, ctx) {
    // Two crons, one Worker. The minute-based one is the route check; the hourly
    // one is the credit watch. Branch on which expression fired.
    const job = event.cron && event.cron.startsWith("*/") ? runCheck : runCreditCheck;
    ctx.waitUntil(job(env, { trigger: `cron:${event.cron}` }));
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

    return json({ error: "not found", paths: ["/health", "/state", "/check", "/drill", "/credit"] }, 404);
  },
};
