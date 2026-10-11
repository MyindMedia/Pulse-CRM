# Environments: staging and production

Pulse runs two complete copies. Build and test on **staging**; only promote to
**production** when Lawrence says it looks and works right.

| | Production | Staging |
|---|---|---|
| Git branch | `main` | `develop` |
| Netlify site | `pulse-dash-kit` → https://studiopulse.tech | `studiopulse-staging` → https://studiopulse-staging.netlify.app |
| Convex backend | `pastel-corgi-340` (prod) | `fiery-cricket-350` (dev) |
| Backend deploys | by hand: `npx convex deploy` with the prod key | automatically, in the staging site's Netlify build |
| Clerk login | production instance (`clerk.studiopulse.tech`) | development instance (`alive-emu-4.clerk.accounts.dev`), separate test users |
| Stripe | live account | sandbox (test mode, card `4242 4242 4242 4242`) |
| Data | real studios | test data only |
| Look | normal | amber **Staging · test data** pill at the top, `noindex` |

**Never copy production data into staging.** Staging is a public URL and its
data is not protected like production's. Use seeded demo data and test
accounts.

## How a change moves

1. **Start on a branch off `develop`.**
   `git fetch && git switch -c feat/<name> origin/develop`
   (A single-branch clone has no `origin/develop`: run
   `git config --add remote.origin.fetch '+refs/heads/develop:refs/remotes/origin/develop'`
   once, then fetch.)
2. **Merge it into `develop`** (pull request). A push to `develop` makes Netlify
   build the staging site. That build deploys the Convex functions to
   `fiery-cricket-350` first (`npx convex deploy --cmd 'npm run build'`), so the
   staging frontend and backend always match.
3. **Check the staging deploy actually happened.** A green `git push` proves
   nothing: confirm a new deploy on `studiopulse-staging` whose `commit_ref` is your
   commit reaches `ready`, then load the routes you changed (HTTP 200).
4. **Lawrence tests on https://studiopulse-staging.netlify.app.**
5. **Promote, only when Lawrence says ship it:**
   1. Open a pull request `develop` → `main`.
   2. Run `npx tsc --noEmit` and `npx vitest run` (the known failures on main
      are `lib/agentScope.test.ts` and `marketing/results.test.ts`).
   3. Squash-merge it.
   4. From an exact checkout of `origin/main`, deploy the production backend:
      `CONVEX_DEPLOY_KEY="$(op read 'op://Security/Convex PULSE CRM/deploy key')" npx convex deploy -y`.
      Do this **before or right as** Netlify publishes, so the new frontend
      never calls a function prod does not have yet.
   5. Confirm the `pulse-dash-kit` deploy for the merge commit is `ready` and
      its routes return 200.
6. **After a hotfix lands straight on `main`, merge `main` back into
   `develop`** so staging does not drift behind production.

## What lives where

- **Staging Netlify env** (site `studiopulse-staging`): `NEXT_PUBLIC_DEPLOY_ENV=staging`,
  `NEXT_PUBLIC_CLERK_CONVEX_TEMPLATE=convex`, Clerk dev keys, Convex dev URLs,
  Stripe sandbox publishable key, and a Convex **dev** deploy key
  (`CONVEX_DEPLOY_KEY`).
- **Staging Convex env** (`fiery-cricket-350`): Clerk dev issuer and secret,
  Stripe sandbox keys and price ids, `NEXT_PUBLIC_APP_URL` = the staging URL,
  `PULSE_AGENCY_ID` = the staging agency. `PULSE_DEMO_MODE` must stay
  **unset**: with it, anyone on the public staging URL is an owner without
  signing in.
- **Production** is unchanged by any of this. `NEXT_PUBLIC_DEPLOY_ENV` and
  `NEXT_PUBLIC_CLERK_CONVEX_TEMPLATE` are not set there.

## Costs and limits

Both sites draw on the same Netlify team credits. Staging builds only on
pushes to `develop` (no deploy previews). If the team runs out of credits,
**every** site 503s, production included, and pushes stop building silently.
