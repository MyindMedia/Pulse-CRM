# State: Agency CRM on Zuops

Branch `feat/agency-crm-zu` · worktree `~/Dev/pulse-wt-zucrm` · eval approved 2026-11-11 ("ok build it", scope widened to every Zuops function incl. social)

## Round 1 (building)
| Slice | Owner | Files | Status |
|---|---|---|---|
| Backend: registry, client, policy, access, `crm.call`, webhook, pulses | builder A | `convex/crm/`, `convex/crm.ts`, `scripts/zu-ops.mjs` | running |
| UI foundation, Dashboard, Leads, Pipeline, page, nav | builder B | `src/components/agency/crm/`, `src/app/agency/crm/` | running |
| Inbox, Calendar, Social | builder C | `crm-inbox.tsx`, `crm-calendar.tsx`, `crm-social.tsx` | waits on B's foundation |
| Generic resources (Campaigns, Automations, Forms, Calls, More, Settings), Functions | builder D | `crm-resources.tsx`, `crm-functions.tsx`, `crm-op-form.tsx` | waits on A's registry and B's foundation |
| Verify (fresh context) | verifier | eval.md results | not started |
| Review (fresh context, read only) | reviewer | diff vs design | not started |

## Open findings
None yet.

## Known facts that shape the build
- Key in 1Password is access level `write`: no `:admin` operations until a Full access key exists.
- `GET /v1/deals` and `/v1/pipelines` answer 403 and `/v1/activity` answered 500 on this account (2026-11-11). Screens must show the reason, not break.
- Staging and production share one Zuops sub-account: `ZUOPS_CRM_WRITES` stays unset on staging.
- `node_modules` in this worktree is a symlink to `~/Dev/pulse-wt-outreach/node_modules` (same dependency set).
- `convex/_generated/api.d.ts` is hand-edited for the new modules; codegen needs a deployment and is not run here.

## Not verifiable in this session
- X-10 live write round trip (needs the owner and production).
- R-05 pentest and U-12 cross-browser run against staging (need a deployed staging build).
