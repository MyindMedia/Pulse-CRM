#!/usr/bin/env bash
# Route-loading uptime check for every host we must keep serving.
#
# Why this exists: on 2026-10-05T00:59:23Z the Netlify account tripped its credit
# allowance and EVERY host 503'd `{"error":"usage_exceeded"}` at the edge, while
# the Netlify control plane still reported `state: current` / `state: ready`.
# A deploy state is not a served page. This check loads real routes and asserts
# HTTP 200, which is the only signal that proves the product answers.
#
# Usage:  bash scripts/uptime-check.sh
# Exit:   0 = every route 200, 1 = at least one route failed
# Output: a PASS/FAIL table on stdout, plus a one-line diagnosis per failure.
#
# This is the HAND copy, for running during an incident. The armed, scheduled
# monitor is the Cloudflare Worker in workers/uptime-watch/ (cron every 10 min,
# emails on the transition). Change ROUTES below and you must change it there too.

set -uo pipefail

# Routes that must return 200. Booking is first because it is the revenue path:
# a studio's customers land there and nowhere else.
ROUTES=(
  "https://pulse.myindsound.com/book/kamiza-private-recording-house"
  "https://pulse.myindsound.com/"
  "https://studiopulse.tech/"
  "https://app.myindsound.com/"
  "https://www.myindsound.com/"
)

# Worst case is ATTEMPTS * (TIMEOUT + BACKOFF) * #ROUTES. Keep that comfortably
# under the cron interval or runs queue up behind each other.
ATTEMPTS=3      # retry before alarming, so a single edge blip does not page anyone
BACKOFF=10      # seconds between attempts
TIMEOUT=15      # per-request budget

failed=0
report=""

for url in "${ROUTES[@]}"; do
  code=""
  body=""
  for attempt in $(seq 1 "$ATTEMPTS"); do
    body_file="$(mktemp)"
    code="$(curl -sS -o "$body_file" -w '%{http_code}' -m "$TIMEOUT" \
             -H 'User-Agent: myindsound-uptime-check/1' "$url" 2>/dev/null || echo 000)"
    body="$(head -c 200 "$body_file" | tr -d '\n')"
    rm -f "$body_file"
    [ "$code" = "200" ] && break
    [ "$attempt" -lt "$ATTEMPTS" ] && sleep "$BACKOFF"
  done

  # Note the explicit $'\n': command substitution strips trailing newlines, so
  # without it every row concatenates onto the previous one.
  if [ "$code" = "200" ]; then
    report+="$(printf '| %-6s | %-3s | %s' "PASS" "$code" "$url")"$'\n'
  else
    failed=$((failed + 1))
    # Name the cause in the alert itself. "503" alone sends the on-call reading
    # application logs for an account-level billing block that is not in them.
    case "$body" in
      *usage_exceeded*)
        why="Netlify ACCOUNT allowance tripped (credits). Every host on the account is blocked at the edge; not a bad deploy, not an app bug. Check: netlify api listAccountsForUser --data '{}' | grep usages_exceeded" ;;
      *)
        why="Unexpected non-200. Body: ${body:-<empty>}" ;;
    esac
    report+="$(printf '| %-6s | %-3s | %s\n      -> %s' "FAIL" "$code" "$url" "$why")"$'\n'
  fi
done

printf '\nRoute uptime check — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' "| result | code | url"
printf '%s\n' "$report"

if [ "$failed" -gt 0 ]; then
  printf '\nFAIL: %d of %d routes are not serving.\n' "$failed" "${#ROUTES[@]}"
  exit 1
fi

printf '\nPASS: all %d routes returned 200.\n' "${#ROUTES[@]}"
