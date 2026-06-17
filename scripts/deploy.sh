#!/usr/bin/env bash
# Deploy Pulse from ANY environment — laptop, phone (claude.ai/code), or CI.
#
#   Frontend (Next.js) → Netlify, triggered automatically by `git push`.
#   Backend  (Convex)  → deployed here with CONVEX_DEPLOY_KEY.
#
# Credentials:
#   - CONVEX_DEPLOY_KEY  (required) — set it as an env var in the cloud
#       environment. Locally it falls back to 1Password if `op` is signed in.
#
# Usage:  bash scripts/deploy.sh           # deploy backend + push frontend
#         bash scripts/deploy.sh backend   # Convex only
#         bash scripts/deploy.sh frontend  # git push only
set -euo pipefail
cd "$(dirname "$0")/.."
# Prefer node@22 if present (Convex rejects unsupported runtimes like v25).
[[ -d /opt/homebrew/opt/node@22/bin ]] && export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

TARGET="${1:-all}"

deploy_backend() {
  if [[ -z "${CONVEX_DEPLOY_KEY:-}" ]] && command -v op >/dev/null 2>&1; then
    export CONVEX_DEPLOY_KEY="$(op read 'op://Security/Convex PULSE CRM/deploy key' 2>/dev/null || true)"
  fi
  if [[ -z "${CONVEX_DEPLOY_KEY:-}" ]]; then
    echo "ERROR: CONVEX_DEPLOY_KEY is not set. In a cloud session, add it as an" >&2
    echo "       environment variable (value: 1Password → Convex PULSE CRM → deploy key)." >&2
    exit 1
  fi
  echo "→ Deploying Convex backend (prod)..."
  npx --yes convex deploy -y
}

deploy_frontend() {
  echo "→ Pushing to main — Netlify auto-builds the frontend..."
  git push origin main
}

case "$TARGET" in
  backend)  deploy_backend ;;
  frontend) deploy_frontend ;;
  all)      deploy_backend; deploy_frontend ;;
  *) echo "usage: deploy.sh [all|backend|frontend]" >&2; exit 1 ;;
esac
echo "✓ Done."
