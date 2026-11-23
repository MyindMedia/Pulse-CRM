#!/usr/bin/env bash
# Deploy the uptime-watch Worker + its cron trigger to Cloudflare.
#
# No wrangler, no node_modules: straight Cloudflare API, same approach as the
# pulse-media worker. Credentials come from 1Password at run time and are never
# written to disk.
#
# Usage:  bash scripts/cf/deploy-uptime-watch.sh
# Env:    ALERT_TO     comma-separated alert recipients (default below)
#         CRON_ROUTES  route check (default every 10 minutes)
#         CRON_CREDIT  Netlify credit watch (default hourly at :17)
#         CRON_DEPLOY  deploy watch (default every 30 minutes)   [MYI-266]
#         GITHUB_TOKEN optional. A FINE-GRAINED, Contents:read token over
#                      myind-sound / myindsound-synergy / Pulse-CRM. Without it
#                      the deploy watch runs its three Netlify-only conditions
#                      and reports the repository comparison as NOT RUN, which
#                      is the honest state rather than a quiet pass. Do NOT put
#                      the fleet's classic `repo`-scope PAT here: it carries
#                      WRITE on every repository, for the sake of one GET.
#
# After it runs it prints the trigger token. That token is DERIVED from the
# Cloudflare API token (sha256), so it is reproducible by anyone with 1Password
# access and is stored nowhere. Recompute it with:
#   printf 'uptime-watch:%s' "$(op read 'op://Security/Cloudflare Pulse OS/Your API Token')" | shasum -a 256 | cut -c1-32

set -euo pipefail

NAME="uptime-watch"
KV_TITLE="uptime-watch-state"
ALERT_TO="${ALERT_TO:-lawrenceb@myindmedia.org}"
CRON_ROUTES="${CRON_ROUTES:-*/10 * * * *}"
CRON_CREDIT="${CRON_CREDIT:-17 * * * *}"
CRON_DEPLOY="${CRON_DEPLOY:-*/30 * * * *}"
COMPAT_DATE="2026-09-01"
# The account every host shares. The credit watch reads its audit log.
NETLIFY_ACCOUNT_ID="${NETLIFY_ACCOUNT_ID:-67521d86dae03920b1185320}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
src="$here/workers/$NAME/index.js"
[ -f "$src" ] || { echo "missing $src" >&2; exit 1; }

# --- every cron we are about to install must be dispatched by index.js.
#
# index.js routes `scheduled()` through an exact-match table (CRON_JOBS). A cron
# installed here that is not a key in that table runs the fallback at best and,
# under the prefix test this replaced, ran the WRONG CHECK silently: deployed,
# scheduled, green in the dashboard, and never executing the job it was added
# for. Nothing downstream can detect that, so it is caught here, before upload.
echo -n "cron table: "
for cron in "$CRON_ROUTES" "$CRON_CREDIT" "$CRON_DEPLOY"; do
  grep -qF "\"$cron\":" "$src" || {
    echo "FAIL"
    echo "  '$cron' is not a key in CRON_JOBS in workers/$NAME/index.js." >&2
    echo "  Add it there (pointing at the job it should run) or change the schedule." >&2
    echo "  Nothing was deployed." >&2
    exit 1
  }
done
echo "OK (all 3 crons are dispatched by index.js)"

CF_TOKEN="$(op read 'op://Security/Cloudflare Pulse OS/Your API Token')"
CF_ACCT="$(op read 'op://Security/Cloudflare Pulse OS/Account ID')"
RESEND_KEY="$(op read 'op://Security/Resend Pulse/Api')"
# Owner-scope PAT. Netlify has no read-only or billing-only token scope, so this
# is the only token that can read the audit log. Worker secrets are not readable
# back out of the API; even so, rotate it if the Cloudflare account is ever shared.
NETLIFY_TOKEN="$(op read 'op://Security/Netlify Personal Access Key/Personal Access Key')"
TRIGGER_TOKEN="$(printf 'uptime-watch:%s' "$CF_TOKEN" | shasum -a 256 | cut -c1-32)"
# MYI-266: the `cfat_` token in 1Password was REVOKED at some point after the
# 2026-10-07 arming, and nothing said so. The Worker kept running the code it
# already had and kept answering /state, because TRIGGER_TOKEN is a sha256 of
# this string and matching it proves only that the string is unchanged — not
# that Cloudflare still accepts it. So the monitor looked fully operable while
# being impossible to redeploy. Fail here, with the fix, rather than printing
# "FAIL" three times and a success banner underneath.
echo -n "cf token:  "
probe="$(curl -sS -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/workers/subdomain")"
if ! printf '%s' "$probe" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("success") else 1)'; then
  echo "FAIL"
  echo "  Cloudflare rejected the token at op://Security/Cloudflare Pulse OS/Your API Token:" >&2
  printf '  %s\n' "$(printf '%s' "$probe" | head -c 300)" >&2
  echo "  Mint a new account API token (Workers Scripts:Edit, Workers KV Storage:Edit) in the" >&2
  echo "  'Pulse OS' Cloudflare account, store it in that 1Password field, and re-run." >&2
  echo "  Nothing was deployed; the Worker is still running its previously uploaded code." >&2
  exit 1
fi
echo "OK"

api() { # api <method> <path> [curl args...]
  local method="$1" path="$2"; shift 2
  curl -sS -X "$method" -H "Authorization: Bearer $CF_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT$path" "$@"
}

ok() { python3 -c 'import json,sys;d=json.load(sys.stdin);print("OK" if d.get("success") else "FAIL "+json.dumps(d.get("errors")))'; }

# --- KV namespace for down/up state (so we alert on the transition, not every run)
kv_id="$(api GET /storage/kv/namespaces | python3 -c "
import json,sys
want=sys.argv[1]
for n in (json.load(sys.stdin).get('result') or []):
    if n.get('title')==want: print(n['id']); break
" "$KV_TITLE")"
if [ -z "$kv_id" ]; then
  kv_id="$(api POST /storage/kv/namespaces -H 'Content-Type: application/json' \
    --data "{\"title\":\"$KV_TITLE\"}" | python3 -c 'import json,sys;print((json.load(sys.stdin).get("result") or {}).get("id",""))')"
  echo "created KV namespace $KV_TITLE -> $kv_id"
fi
[ -n "$kv_id" ] || { echo "could not resolve KV namespace" >&2; exit 1; }

# --- upload the script with its bindings
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "github:    token supplied — the deploy watch will compare against the branch head"
else
  echo "github:    NOT supplied — the deploy watch runs its Netlify-only conditions and reports"
  echo "           the repository comparison as NOT RUN. See the header for the token to mint."
fi

KV_ID="$kv_id" RESEND_KEY="$RESEND_KEY" ALERT_TO="$ALERT_TO" \
TRIGGER_TOKEN="$TRIGGER_TOKEN" COMPAT_DATE="$COMPAT_DATE" \
NETLIFY_TOKEN="$NETLIFY_TOKEN" NETLIFY_ACCOUNT_ID="$NETLIFY_ACCOUNT_ID" \
GITHUB_TOKEN="${GITHUB_TOKEN:-}" \
python3 - >"$work/metadata.json" <<'PY'
import json, os
secrets = ["RESEND_API_KEY", "ALERT_TO", "TRIGGER_TOKEN", "NETLIFY_TOKEN", "NETLIFY_ACCOUNT_ID"]
# Only bind GITHUB_TOKEN when there is one. Binding an EMPTY secret would make
# `env.GITHUB_TOKEN` a falsy-but-present string, which the Worker would read as
# "configured" and then fail every call against — a quiet 401 loop instead of
# the loud "not configured" line it is supposed to print.
if os.environ.get("GITHUB_TOKEN"):
    secrets.append("GITHUB_TOKEN")
env = {"RESEND_API_KEY": os.environ["RESEND_KEY"]}
print(json.dumps({
    "main_module": "index.js",
    "compatibility_date": os.environ["COMPAT_DATE"],
    "observability": {"enabled": True},
    "bindings": [{"type": "kv_namespace", "name": "STATE", "namespace_id": os.environ["KV_ID"]}]
    + [{"type": "secret_text", "name": n, "text": env.get(n, os.environ.get(n, ""))} for n in secrets],
}))
PY

echo -n "upload:    "
api PUT "/workers/scripts/$NAME" \
  -F "metadata=@$work/metadata.json;type=application/json" \
  -F "index.js=@$src;type=application/javascript+module" | ok

# --- the cron triggers. This is the whole point: it runs without anyone's laptop.
# Routes every 10 min, credit watch hourly, deploy watch every 30 min. Dispatch
# is an EXACT match on event.cron against CRON_JOBS in index.js — asserted at the
# top of this script, which is why no expression here carries a magic prefix.
echo -n "cron:      "
api PUT "/workers/scripts/$NAME/schedules" -H 'Content-Type: application/json' \
  --data "[{\"cron\":\"$CRON_ROUTES\"},{\"cron\":\"$CRON_CREDIT\"},{\"cron\":\"$CRON_DEPLOY\"}]" | ok

# --- workers.dev URL, so /check and /drill are reachable on demand
echo -n "subdomain: "
api POST "/workers/scripts/$NAME/subdomain" -H 'Content-Type: application/json' \
  --data '{"enabled":true,"previews_enabled":false}' | ok

sub="$(curl -sS -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/workers/subdomain" \
  | python3 -c 'import json,sys;print((json.load(sys.stdin).get("result") or {}).get("subdomain",""))')"

cat <<EOF

Deployed $NAME — routes "$CRON_ROUTES", credit "$CRON_CREDIT", deploy "$CRON_DEPLOY", alerts to $ALERT_TO
  health: https://$NAME.$sub.workers.dev/health
  state:  https://$NAME.$sub.workers.dev/state?token=$TRIGGER_TOKEN
  check:  https://$NAME.$sub.workers.dev/check?token=$TRIGGER_TOKEN
  drill:  https://$NAME.$sub.workers.dev/drill?token=$TRIGGER_TOKEN   <- proves the route alert path, changes no state
  credit: https://$NAME.$sub.workers.dev/credit?token=$TRIGGER_TOKEN
          ...&since=2026-10-04T00:00:00Z   <- replays the real MYI-219 billing chain, changes no state
  deploy: https://$NAME.$sub.workers.dev/deploy?token=$TRIGGER_TOKEN
          ...&dry=1                        <- read-only: no alert, no state write
  deploy-drill: https://$NAME.$sub.workers.dev/deploy-drill?token=$TRIGGER_TOKEN
          ...&at=2026-10-20T12:00:00Z      <- replays the real eleven-day freeze, changes no state
          ...&at=2026-10-21T06:25:00Z      <- replays the real nocommit CLI publish

After ANY change here, run both drills. A deploy watch that has never alerted is
a deploy watch you are trusting on the strength of a green dashboard.
EOF
