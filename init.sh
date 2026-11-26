#!/usr/bin/env bash
# Pulse session bootstrap. Safe to run repeatedly. Never deploys, pushes or prints secrets.
#
#   ./init.sh                 base check, deps, typecheck, core tests, dev server if a safe backend is set
#   SMOKE=full ./init.sh      run the whole test suite instead of the core set
#   START_DEV=0 ./init.sh     skip the dev server
#   PORT=3200 ./init.sh       use another port (default 3147)
#   ALLOW_STALE=1 ./init.sh   continue even if the branch is far behind origin/develop
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

SMOKE="${SMOKE:-quick}"
START_DEV="${START_DEV:-1}"
PORT="${PORT:-3147}"
PROD_BACKEND="pastel-corgi-340"

say()  { printf '\n== %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

[ -f package.json ] || die "run from the repo root (package.json not found)"

say "Base branch"
git fetch -q origin develop 2>/dev/null || warn "could not fetch origin/develop; using the last known copy"
if git rev-parse -q --verify origin/develop >/dev/null; then
  behind="$(git rev-list --count HEAD..origin/develop)"
  echo "branch $(git branch --show-current), $behind commit(s) behind origin/develop"
  if [ "$behind" -gt 50 ] && [ "${ALLOW_STALE:-0}" != "1" ]; then
    die "this branch is stale. Start from current code: git switch -c feat/<name> origin/develop (see claude-progress.txt)"
  fi
  [ "$behind" -gt 0 ] && warn "consider merging origin/develop before building"
else
  warn "origin/develop is unknown here; confirm you are on current code"
fi

say "Node"
command -v node >/dev/null || die "node is not installed"
major="$(node -p 'process.versions.node.split(".")[0]')"
echo "node $(node -v)"
[ "$major" -ge 20 ] || die "Node 20 or newer is required"
case "$major" in
  20|22|24) ;;
  *) warn "Netlify builds on Node 20, and a local Convex backend needs Node 20, 22 or 24" ;;
esac

say "Dependencies"
if [ -L node_modules ]; then
  echo "node_modules is a symlink; leaving it untouched"
elif [ ! -x node_modules/.bin/tsc ] || [ ! -x node_modules/.bin/vitest ] \
  || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "installing from package-lock.json"
  npm ci --no-audit --no-fund
else
  echo "already installed"
fi

say "Typecheck"
npx --no-install tsc --noEmit

say "Tests ($SMOKE)"
if [ "$SMOKE" = "full" ]; then
  # See claude-progress.txt for failures already known on main.
  npx --no-install vitest run
else
  core=()
  for t in \
    convex/lib/access.test.ts convex/lib/accessPolicies.test.ts convex/money.test.ts \
    convex/entitlements.test.ts convex/pricing.test.ts convex/bookingPayment.test.ts \
    convex/booking.addons.test.ts convex/billing.test.ts convex/trialRequiresCard.test.ts \
    src/lib/convex-url.test.ts src/middleware.test.ts src/app/pricing/pricing.test.ts; do
    [ -f "$t" ] && core+=("$t")
  done
  [ "${#core[@]}" -gt 0 ] || die "no core test files found"
  npx --no-install vitest run "${core[@]}"
fi

if [ "$START_DEV" != "1" ]; then
  say "Done (dev server skipped)"
  exit 0
fi

say "Dev server"
# Read one variable the way Next would (shell first, then env files). Values are never printed.
env_value() {
  local name="$1" file line
  if [ -n "${!name:-}" ]; then printf '%s' "${!name}"; return 0; fi
  for file in .env.development.local .env.local .env.development .env; do
    [ -f "$file" ] || continue
    line="$(grep -E "^${name}=" "$file" | tail -n 1 || true)"
    [ -n "$line" ] || continue
    line="${line#*=}"; line="${line%%[[:space:]]#*}"; line="${line%\"}"; line="${line#\"}"
    printf '%s' "$line"; return 0
  done
}

backend="$(env_value NEXT_PUBLIC_CONVEX_URL)"
if [ -z "$backend" ]; then
  # src/lib/convex-url.ts falls back to PRODUCTION when this is unset, so never start without it.
  warn "NEXT_PUBLIC_CONVEX_URL is not set; not starting the app (it would use the production backend)"
  say "Done (static checks only)"
  exit 0
fi
case "$backend$(env_value CONVEX_DEPLOYMENT)$(env_value NEXT_PUBLIC_CONVEX_SITE_URL)" in
  *"$PROD_BACKEND"*|*prod:*) die "the configured Convex backend is production; use a non-production deployment" ;;
esac
case "$(env_value NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)$(env_value CLERK_SECRET_KEY)$(env_value NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)" in
  *pk_live_*|*sk_live_*) die "live Clerk or Stripe keys are configured; use test keys" ;;
esac

URL="http://localhost:$PORT"
PIDFILE=".next/pulse-dev-$PORT.pid"
LOG=".next/pulse-dev-$PORT.log"
mkdir -p .next

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "reusing dev server (pid $(cat "$PIDFILE"))"
else
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    die "port $PORT is in use by another process; set PORT to a free port"
  fi
  nohup npx --no-install next dev -p "$PORT" >"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
  echo "started dev server (pid $!), log: $LOG"
fi

say "HTTP smoke test"
page="$(mktemp)"
trap 'rm -f "$page"' EXIT
code=000
for _ in $(seq 1 45); do
  code="$(curl -s -o "$page" -w '%{http_code}' --max-time 60 "$URL/pricing" || true)"
  [ "$code" = "200" ] && break
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null || die "dev server exited; see $LOG"
  sleep 2
done
[ "$code" = "200" ] || die "$URL/pricing returned $code; see $LOG"
grep -q 'Growth' "$page" || die "$URL/pricing did not contain the plan list"
echo "$URL/pricing 200"

say "Done. App: $URL  Stop it with: kill \$(cat $PIDFILE)"
