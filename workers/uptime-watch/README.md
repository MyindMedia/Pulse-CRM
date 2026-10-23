# uptime-watch Worker — the armed monitor

One Cloudflare Worker, three cron triggers, three halves of the same lesson:

| job | cron | question |
|---|---|---|
| route check | `*/10 * * * *` | do the five live routes still answer 200? (**the outage**) |
| credit watch | `17 * * * *` | is the Netlify credit balance about to run out? (**the cause**, ~20h of warning) |
| deploy watch | `*/30 * * * *` | is each site serving **what we wrote**, and did its last build pass? (**the freeze**) |

```
live:   https://uptime-watch.myindmedia.workers.dev
cloud:  Cloudflare account "Pulse OS"
alerts: lawrenceb@myindmedia.org  via Resend, from uptime@studiopulse.tech
state:  KV namespace `uptime-watch-state`, keys `uptime:state`, `credit:state`, `deploy:state`
deploy: bash scripts/cf/deploy-uptime-watch.sh
```

> **This file is on `main` as of MYI-266 and was not before.** The Worker was
> armed on 2026-10-07 from `feat/uptime-monitor-myi-220`, which never merged, and
> `scripts/cf/deploy-uptime-watch.sh` could not be committed at all because
> `.gitignore` carries a blanket `*.sh`. For two weeks the only copy of the live
> monitor's source was an unmerged branch. Negations for both scripts are in
> `.gitignore` now.

## Why Cloudflare and not anywhere closer to hand

On 2026-10-05T00:59:23Z the Netlify account tripped its credit allowance. Every
host on it answered `503 {"error":"usage_exceeded"}` at the edge while Netlify's
own API still reported `state: current` / `state: ready`. Pulse, the app and the
marketing site were dark and every dashboard read green.

So the watcher has three hard constraints, and they rule out every convenient
option:

| option | why not |
|---|---|
| Netlify scheduled function | blocked by the very gate it would be watching for |
| Convex cron | shares the product's own backend |
| launchd on a laptop | only runs while that one machine is awake, and it is the founder's |
| GitHub Actions | fine in principle, but the push token holds `repo` scope only and GitHub refuses writes under `.github/workflows/`, so it stayed parked and unarmed for two days |

Cloudflare is independent of Netlify and Convex, always on, free at this volume,
and needs no GitHub token. The old parked `ci/uptime.yml` was deleted when this
went live — one armed monitor beats two, one of which is a file nobody installed.

**A deploy state is not a served page.** The only check that would have caught
the outage is one that fetches a URL and reads the status code. That is all this
does, and it reads the response body too: on `usage_exceeded` the alert says
*"Netlify ACCOUNT allowance tripped, every host is blocked at the edge, not an
app bug"*, because a bare `503` sends whoever is on call into application logs
that contain no trace of a billing block.

The Worker also sets `cf: { cacheTtl: 0 }` on every probe. A cached 200 from
Cloudflare's own edge would hide a live outage — exactly the failure mode here.

## The credit watch — why we built our own

Netlify's credit alert cannot do this job, on two counts, and both were measured:

1. **`credit_alert_percentage` is dashboard-only.** `PUT` and `PATCH` return HTTP
   200 with the full account object and the read-back never changes —
   `updated_at` included. Re-measured 2026-10-07 with an Owner token, the
   account **id** rather than the slug, and three payload shapes
   (`{credit_alert_percentage:75}`, nested under `account`, and alongside
   `name`/`slug`). All 200, all no-ops.
2. **Even when set, it fires too late.** During MYI-219 it was pinned at 100%,
   so the first warning arrived at the instant every site went dark.

The audit log is the only billing surface the API exposes, and it is genuinely
early: `Payment failed` at 2026-10-04T05:09:32Z, `Sites disabled` at
2026-10-05T00:59:23Z — **19.84 hours**, unread.

So the watch reads `GET /accounts/{id}/audit` (2 pages ≈ 14 days) plus the
account's `usages_exceeded` and `capabilities.credits`, and pages on:

- any **new** alertable billing event since its KV cursor — `Payment failed`,
  `Credit balance depleted`, `Usage limit enforced`, `Sites disabled`,
  `Account notified of credit balance threshold`;
- the account **entering** a `usages_exceeded` state;
- credit use **crossing 75%**.

Three things it deliberately does not do:

- **No burn-rate math.** Averaging the gaps between zero readings once reported
  877 credits/day while the account sat dead at zero; the real figure was 348.
  A number that confident and that wrong is worse than no number.
- **No "unresolved invoice forever" alarm.** Netlify retries the same
  `invoice_id`, and a failure is only cleared by a `Payment succeeded` carrying
  *that* id. The MYI-219 top-up invoice `nir3oCx5hzTZVXuE` was never paid — the
  recovery was a different invoice — so a standing "unresolved" alert would page
  every hour forever. The cursor is what makes it signal.
- **No treating `capabilities.credits.used` as proof.** It is undocumented,
  `/accounts/{id}/credits` does not exist, and per-site `credit_usage` reports 0
  for every site. Every credit email says so in as many words, so a `0%` is
  never read as a healthy balance.

The Netlify token is an **Owner-scope PAT** (`op://Security/Netlify Personal
Access Key`) held as a Worker secret. Netlify has no read-only or billing-only
scope, so there is no smaller key to use. Worker secrets are not readable back
out of the API; rotate it if the Cloudflare account is ever shared.

## Alerting

- 3 attempts per route, 5s apart, 15s timeout, then it counts as down.
- Alerts on the **transition** up→down, re-sends at most hourly while still
  down, and sends a recovery mail on down→up. State lives in KV, so a restart
  does not re-page and a long outage does not send 144 emails a day.
- `/health` is unauthenticated and says only *the watcher is alive*. That is a
  different claim from *the routes are up* — do not wire a status page to it.

## Prove it, don't trust the green

```bash
TOKEN=$(printf 'uptime-watch:%s' "$(op read 'op://Security/Cloudflare Pulse OS/Your API Token')" | shasum -a 256 | cut -c1-32)
B=https://uptime-watch.myindmedia.workers.dev

curl -s "$B/health"                  # watcher alive
curl -s "$B/state?token=$TOKEN"      # both checks' last result, and what the cron last did
curl -s "$B/check?token=$TOKEN"      # run the real route check now (200 / 503)
curl -s "$B/drill?token=$TOKEN"      # FIRE THE ROUTE ALERT: adds an unresolvable
                                     # URL, emails a DRILL, changes no state
curl -s "$B/credit?token=$TOKEN"     # run the credit check now
curl -s "$B/credit?token=$TOKEN&since=2026-10-04T00:00:00Z"
                                     # FIRE THE CREDIT ALERT: replays the real
                                     # MYI-219 billing chain, changes no state
```

These exist because a monitor that has never alerted is an untested monitor. Run
them after any change to the alert channel, the Resend key or the recipient list.
Neither writes state — a drill must never leave the next real outage looking like
"already alerted".

The credit drill is a **replay of real history**, not a synthetic event: `since`
rewinds the cursor for one run, so the alert is assembled from the actual
`Payment failed` → `Credit balance depleted` → `Usage limit enforced` →
`Sites disabled` chain that took the account down. If the email reads wrong, it
would have read wrong during the outage.

The trigger token is **derived** (`sha256("uptime-watch:" + CF_API_TOKEN)`), not
stored. Anyone with 1Password access to `Cloudflare Pulse OS` can recompute it;
losing it means re-running the deploy script, which is idempotent.

## Verified on 2026-10-07

- cron `*/10 * * * *` registered, fired on its own schedule, `/state` shows
  `trigger: "cron:*/10 * * * *"`.
- real check: 5/5 routes 200.
- drill: injected `uptime-drill.pulse.myindsound.com` → 530, email
  `01a11425-014b-75f7-839e-33310a4a8912` accepted and delivered by Resend; state
  unchanged (`status: up`, `lastAlertAt: null`).
- the up→down/down→up branch in `runCheck` — the one the cron calls, not just
  the drill path — proven by seeding KV to `down` and re-running `/check`, which
  sent the recovery mail `01a11425-9b56-7270-a04e-bb7d9a3ff4d6`.

## Changing the route list

Edit `ROUTES` in `index.js` **and** `scripts/uptime-check.sh` (the local/manual
copy of the same check), then re-run the deploy script.


## The deploy watch (MYI-266)

`main` on `MyindMedia/myind-sound` stopped deploying on **2026-10-08** and nobody
found out until **2026-10-20**. Both crons above were green for all eleven days
and both were **right** to be: the 2026-10-08 deploy served every route at 200,
and the account never came near its credit ceiling. **A site can be perfectly up
and completely frozen.** Liveness is not currency.

Per site, it reads:

```
GET /sites/{id}                      published_deploy, build_settings
GET /sites/{id}/deploys?per_page=10  every ATTEMPT, including the failures
GET repos/{repo}/commits/{branch}    the newest commit (optional, see below)
```

and pages on the **first occurrence** of any of these — a red build is already
the alert, there is no flapping to smooth:

| # | condition | needs GitHub? |
|---|---|---|
| 1 | the newest production build on the branch is `error` | no |
| 2 | the published deploy is not Netlify's newest attempt (**an older green deploy masking a newer red one** — true for all eleven days) | no |
| 2b | the published commit is not the branch head | yes |
| 3 | nothing published for 3+ days **while the branch has moved** (a build that never fired: no deploy object, nothing to retry, nothing to notice) | yes |
| 4 | the published deploy has a **null `commit_ref`** — a `netlify deploy` CLI upload is live, so the site is not tracking its branch at all | no |
| — | `stop_builds` or `skip_automatic_builds` is on | no |

Sites watched: `myind-sound` (app), `myindsound` (www), `pulse-dash-kit`
(studiopulse.tech / pulse). Deliberately not all 80 on the account — most are
one-off static uploads with no repo, and a monitor that pages about those trains
the reader to ignore it, which is the failure mode that cost eleven days.

### GITHUB_TOKEN is optional, and loudly so

There is no read-only GitHub token in 1Password. The fleet's classic PAT carries
`repo` **write** on every repository, which is far too much to hand a Worker for
one `GET`. So conditions 1, 2 and 4 run today, and **2b and 3 report themselves
as NOT RUN rather than passing**. Mint a fine-grained token (Contents: read, over
`myind-sound` / `myindsound-synergy` / `Pulse-CRM`), export `GITHUB_TOKEN`, re-run
the deploy script, and they arm with no code change. `GET /state` reports
`githubConfigured`.

### Prove it, don't trust the green

The drill replays the **real deploy records** as they stood at a past instant —
not a fixture — so if the email reads badly it would have read badly during the
outage. It writes no state: a drill must never leave the next real freeze looking
like "already alerted".

```bash
TOKEN=$(printf 'uptime-watch:%s' "$(op read 'op://Security/Cloudflare Pulse OS/Your API Token')" | shasum -a 256 | cut -c1-32)
BASE=https://uptime-watch.myindmedia.workers.dev

curl -s "$BASE/deploy?token=$TOKEN&dry=1"                            # read-only, no alert, no write
curl -s "$BASE/deploy-drill?token=$TOKEN"                            # replays 2026-10-20: 2 red builds masked by a green publish
curl -s "$BASE/deploy-drill?token=$TOKEN&at=2026-10-21T06:25:00Z"    # replays the nocommit CLI publish
curl -s "$BASE/state?token=$TOKEN" | python3 -m json.tool            # assert deploy:state is UNCHANGED after a drill
```

### Two traps already paid for

- **Dispatch is an EXACT match on `event.cron`** against `CRON_JOBS`. It used to
  be a prefix test on the cron's leading `*/`, which would have run the route
  check a third time every half hour and the deploy watch *never* — deployed,
  scheduled, green in the dashboard, not running. A prefix test cannot fail; it
  can only answer wrongly. `deploy-uptime-watch.sh` now refuses to install a cron
  that is not a key in that table.
- **`published_at` is not fixed at a deploy's birth.** Re-publishing the
  2026-10-08 deploy during recovery restamped it `2026-10-21`, which dated the
  eleven-day freeze to the *future* and printed its age as `-18.4h`. The replay
  clamps any timestamp that postdates the instant, and a negative age prints as
  `INVALID`, never as a number.

### What this still does not fix

The eleven days were not a detection failure. The myind-sound laptop check
(MYI-233) caught it inside 31 hours and delivered **33** alert emails. Nobody
read them. This Worker makes the detection off-laptop, multi-site and able to
name the cause — it does **not** make anything escalate past one human inbox.
That gap is still open on MYI-266.
