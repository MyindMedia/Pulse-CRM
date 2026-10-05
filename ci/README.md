# `ci/uptime.yml` — install this as a GitHub Action (one command)

```bash
mkdir -p .github/workflows && git mv ci/uptime.yml .github/workflows/uptime.yml
git commit -m "Arm the uptime monitor" && git push
```

It must live on the **default branch** (`main`) for `schedule:` to fire. GitHub
ignores `cron` triggers on any other branch.

## Why it is parked here instead of already installed

The token this repo's automation pushes with holds `repo` scope only. GitHub
refuses any push that creates or edits a file under `.github/workflows/` without
`workflow` scope:

```
! [remote rejected] (refusing to allow a Personal Access Token to create or
  update workflow `.github/workflows/uptime.yml` without `workflow` scope)
```

So either run the two commands above yourself, or add `workflow` scope to the
PAT and the push goes through unattended next time.

## What it watches, and why it is not on Netlify

`scripts/uptime-check.sh` loads five live routes and asserts **HTTP 200**.

On 2026-10-05T00:59:23Z the Netlify account tripped its credit allowance and
every host it serves answered `503 {"error":"usage_exceeded"}` at the edge — while
the Netlify API still reported `state: current` and `state: ready`. Pulse, the
app and the marketing site were all dark and every dashboard read green.

Two design consequences, both deliberate:

1. **A deploy state is not a served page.** The only check that would have caught
   this is one that fetches a URL and looks at the status code.
2. **The watcher cannot run on the thing it watches.** A Netlify scheduled
   function would have been blocked by the same account-level gate; a Convex
   cron shares the product's own backend. GitHub's runners are independent of
   both, which is the whole point.

The script also reads the response body: when it sees `usage_exceeded` the alert
says *"Netlify ACCOUNT allowance tripped, every host is blocked at the edge, not
an app bug"*, because a bare `503` sends whoever is on call into application
logs that contain no trace of a billing block.

## Running it by hand

```bash
bash scripts/uptime-check.sh   # exit 0 = all routes 200, exit 1 = something is down
```
