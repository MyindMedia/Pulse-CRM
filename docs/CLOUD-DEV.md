# Developing Pulse from any device (phone, tablet, another machine)

Pulse development is **not tied to one laptop**. The live app already runs
entirely in the cloud (Convex + Netlify); this doc covers doing *development*
work — editing, deploying — from anywhere via a cloud Claude Code session.

## The model

- **Sync layer = git.** Code lives in GitHub (`MyindMedia/Pulse-CRM`). Every
  machine and every Claude session works from the same repo.
- **Frontend deploys** happen automatically on `git push` (Netlify). No
  credentials needed beyond GitHub access.
- **Backend (Convex) deploys** need one secret: `CONVEX_DEPLOY_KEY`.
- **Operational/long-running tasks** run server-side (Convex crons), so they
  never depend on a session being open.

## One-time setup (from your phone or any browser)

1. Open **claude.ai/code** and connect the **`MyindMedia/Pulse-CRM`** repo.
2. In that cloud environment's **settings → environment variables**, add:

   | Variable | Where to get it |
   |---|---|
   | `CONVEX_DEPLOY_KEY` | 1Password → "Convex PULSE CRM" → deploy key |
   | `OP_SERVICE_ACCOUNT_TOKEN` *(optional)* | a scoped 1Password service-account token — lets `op read` work in the cloud for every other secret |

   With just `CONVEX_DEPLOY_KEY` you can edit code and deploy both halves.
   Add `OP_SERVICE_ACCOUNT_TOKEN` only if you want credentialed scripts
   (Twilio, etc.) to run in the cloud the same way they do locally.

## Deploying from anywhere

```bash
bash scripts/deploy.sh            # Convex backend + push (Netlify builds)
bash scripts/deploy.sh backend    # Convex only
bash scripts/deploy.sh frontend   # git push only
```

The script reads `CONVEX_DEPLOY_KEY` from the environment, and falls back to
1Password when run locally — so the *same command* works on your laptop, your
phone session, or CI.

## What still needs a credentialed machine

- Reading local 1Password directly (unless `OP_SERVICE_ACCOUNT_TOKEN` is set in
  the cloud env).
- Nothing else — frontend deploys are push-triggered, backend deploys use the
  env var, and crons run in Convex regardless.
