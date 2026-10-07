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
COMPAT_DATE="2026-09-01"
# The account every host shares. The credit watch reads its audit log.
NETLIFY_ACCOUNT_ID="${NETLIFY_ACCOUNT_ID:-67521d86dae03920b1185320}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
src="$here/workers/$NAME/index.js"
[ -f "$src" ] || { echo "missing $src" >&2; exit 1; }

CF_TOKEN="$(op read 'op://Security/Cloudflare Pulse OS/Your API Token')"
CF_ACCT="$(op read 'op://Security/Cloudflare Pulse OS/Account ID')"
RESEND_KEY="$(op read 'op://Security/Resend Pulse/Api')"
# Owner-scope PAT. Netlify has no read-only or billing-only token scope, so this
# is the only token that can read the audit log. Worker secrets are not readable
# back out of the API; even so, rotate it if the Cloudflare account is ever shared.
NETLIFY_TOKEN="$(op read 'op://Security/Netlify Personal Access Key/Personal Access Key')"
TRIGGER_TOKEN="$(printf 'uptime-watch:%s' "$CF_TOKEN" | shasum -a 256 | cut -c1-32)"

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
KV_ID="$kv_id" RESEND_KEY="$RESEND_KEY" ALERT_TO="$ALERT_TO" \
TRIGGER_TOKEN="$TRIGGER_TOKEN" COMPAT_DATE="$COMPAT_DATE" \
NETLIFY_TOKEN="$NETLIFY_TOKEN" NETLIFY_ACCOUNT_ID="$NETLIFY_ACCOUNT_ID" \
python3 - >"$work/metadata.json" <<'PY'
import json, os
secrets = ["RESEND_API_KEY", "ALERT_TO", "TRIGGER_TOKEN", "NETLIFY_TOKEN", "NETLIFY_ACCOUNT_ID"]
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
# Routes every 10 min; Netlify credit watch hourly. index.js branches on
# event.cron, so the minute-based expression MUST keep its `*/` prefix.
echo -n "cron:      "
api PUT "/workers/scripts/$NAME/schedules" -H 'Content-Type: application/json' \
  --data "[{\"cron\":\"$CRON_ROUTES\"},{\"cron\":\"$CRON_CREDIT\"}]" | ok

# --- workers.dev URL, so /check and /drill are reachable on demand
echo -n "subdomain: "
api POST "/workers/scripts/$NAME/subdomain" -H 'Content-Type: application/json' \
  --data '{"enabled":true,"previews_enabled":false}' | ok

sub="$(curl -sS -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/workers/subdomain" \
  | python3 -c 'import json,sys;print((json.load(sys.stdin).get("result") or {}).get("subdomain",""))')"

cat <<EOF

Deployed $NAME — routes "$CRON_ROUTES", credit "$CRON_CREDIT", alerts to $ALERT_TO
  health: https://$NAME.$sub.workers.dev/health
  state:  https://$NAME.$sub.workers.dev/state?token=$TRIGGER_TOKEN
  check:  https://$NAME.$sub.workers.dev/check?token=$TRIGGER_TOKEN
  drill:  https://$NAME.$sub.workers.dev/drill?token=$TRIGGER_TOKEN   <- proves the route alert path, changes no state
  credit: https://$NAME.$sub.workers.dev/credit?token=$TRIGGER_TOKEN
          ...&since=2026-10-04T00:00:00Z   <- replays the real MYI-219 billing chain, changes no state
EOF
