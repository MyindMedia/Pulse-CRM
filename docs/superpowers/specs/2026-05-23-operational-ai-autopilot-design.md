# Pulse Operational AI — "Ops Autopilot" Design

**Date:** 2026-05-23
**Status:** Approved for build (autonomous build grant — user directive "get it all done")
**Author:** Claude (Opus 4.7) with Lawrence Berment

## Goal

Give Pulse a system-wide operational AI layer that runs the back end of every
studio subaccount on its own: it keeps the deterministic automations actually
running on a schedule, then layers an AI "operations brain" on top that reads
each studio's live state, decides what should happen next, and either queues
those actions for one-tap approval or (once trusted) executes them
autonomously. An agency owner gets a portfolio roll-up across all subaccounts.

The differentiator vs. competitors: scheduling tools nudge; Pulse *acts*.

## Background — what exists today

- **6 event-driven / manual AI generators** (`convex/aiActions.ts`): session
  recap, prep packet, 24h/1h reminders (event-scheduled via `scheduler.runAt`),
  weekly briefing + rate-cut promos (manual dashboard buttons).
- **Deterministic booking automation** (`convex/automation.ts`): hold release,
  balance reminders, forfeit, session progression. Has a `tick` internal
  mutation "meant to run every 15 min (see crons.ts)".
- **Room-status recompute** (`convex/maintenance.ts`): `recomputeAllRoomStatuses`.
- **Rule-based insight feed** (`convex/insights.ts`): churn/revenue/risk nudges,
  but currently only **seeded** + written from a few event sites. Presented as
  "AI" but no LLM involved.

### Two confirmed gaps

1. **Reliability gap:** `convex/crons.ts` is referenced in comments but **does
   not exist**. Nothing runs on a schedule. The booking automation that prevents
   no-shows is silently not running.
2. **Org-context gap:** `generateWeeklyBriefing` / `generateRateCutPromos`
   resolve org via `currentOrg` → `resolveViewer`, which needs an auth context.
   A cron has none, so they fall back to `DEMO_ORG`. They **cannot** fan out
   across subaccounts as written.

## Architecture — four phases, dependency-ordered

```
Phase 4  Agency-wide ops AI      (portfolio roll-up across all subaccounts)
Phase 3  Autonomy graduation     (trusted action-types auto-execute)
Phase 2  AI ops brain + HITL      (per-org reasoning → approval queue)  ★ differentiator
Phase 1  Operational backbone     (crons.ts heartbeat + org-explicit fan-out)  ★ foundation
```

All four ship in this build. Each phase is independently testable.

---

## Phase 1 — Operational backbone

### `convex/crons.ts` (new)
Registers via `cronJobs()` from `convex/server`:
- `booking-automation` — every 15 min → `internal.automation.tick`
  (already all-org safe; it queries every session).
- `room-status` — every 15 min → `internal.maintenance.recomputeAllRoomStatuses`
  (already all-org safe).
- `ops-brain-daily` — daily 13:00 UTC → `internal.opsBrain.scanAllOrgs`
  (Phase 2 fan-out).
- `weekly-briefing` — Mon 13:00 UTC → `internal.aiActions.runWeeklyForAllOrgs`.
- `rate-cut-sweep` — Mon 13:05 UTC → `internal.aiActions.runRateCutForAllOrgs`.

### Org-explicit fan-out (fixes the org-context gap)
Add a small internal helper `internal.orgs.listActiveOrgIds` (active, non-demo).
Add internal `*ForOrg` variants that take an explicit `orgId` and an internal
`*ForAllOrgs` fan-out that schedules one per org:
- `aiContext.weeklyBriefingContextForOrg({ orgId })` / `rateCutContextForOrg`
  — internalQuery clones that take orgId explicitly instead of `currentOrg`.
- `aiActions.generateWeeklyBriefingForOrg` / `generateRateCutPromosForOrg`
  — internal actions taking `{ orgId }`.
- `aiActions.runWeeklyForAllOrgs` / `runRateCutForAllOrgs` — list orgs, schedule
  per-org generators with `runAfter(0, ...)`.

The existing **public** actions (dashboard buttons) stay untouched — minimum
change. The internal variants share the prompt/fallback logic via extracted
helpers so we don't duplicate prompt text.

---

## Phase 2 — AI ops brain (human-in-the-loop)

### New table `opsActions`
A proposed (or executed) operational action with an executable payload and an
approval lifecycle. Distinct from `insights` (read-only nudges) because these
carry an action that can be *executed*.

```
opsActions:
  orgId: string
  type: union(
    "reengage_quiet_artist", "payment_reminder", "confirm_unconfirmed_session",
    "promote_underused_room", "resolve_revision_overflow", "chase_split_sheet",
    "deposit_unpaid_nudge"
  )
  priority: union("low","medium","high")
  title: string                 // short queue label
  rationale: string             // AI/rule reasoning shown to the owner
  entityType?: string           // "artist" | "session" | "song" | "room" | "invoice"
  entityId?: string
  payload: union(               // what executing actually does
    { kind:"email", to, subject, body, notifyKind },
    { kind:"session_status", sessionId, newStatus },   // e.g. confirm
    { kind:"note_only" }                               // surface-only, no side effect
  )
  status: union("proposed","approved","executing","executed","failed","dismissed","snoozed")
  autonomy: boolean             // true if auto-executed (Phase 3)
  source: union("openai","rule")
  model?: string
  dedupeKey: string             // `${type}:${entityId}` — open dedupe
  snoozeUntil?: number
  decidedBy?: string
  createdAt, decidedAt?, executedAt?: number
  result?: string               // execution outcome / error
indexes: by_org, by_org_status, by_org_dedupe (orgId,dedupeKey), by_entity
```

### `convex/opsBrain.ts` (new)
- `gatherState` (internalQuery, `{ orgId }`): pulls the operational signals —
  quiet/dormant artists with recent activity gaps, overdue/sent-unpaid invoices,
  upcoming sessions still `tentative`/unconfirmed, rooms below utilization
  threshold over trailing weeks, songs near revision cap with unresolved
  comments, near-delivery songs with non-executed split sheets, public bookings
  with unpaid deposits. Reuses existing analytics where possible.
- `candidatesFor` (pure helper): deterministic rules → candidate `opsActions`
  (guarantees safety + works with no OpenAI key).
- `scanOrg` (internal action, `{ orgId }`): gather → candidates → optional
  OpenAI pass that ranks + writes human copy/email bodies (fallback = template)
  → upsert via `upsertProposed` (dedupe on open `dedupeKey`).
- `scanAllOrgs` (internal action): list active orgs, schedule `scanOrg` each.

### `convex/opsActions.ts` (new) — queries + mutations
- `list` (query): open queue for current org, newest/priority first.
- `counts` (query): open / high counts (for the nav badge).
- `approve` (mutation): requires capability `ops.action.approve`; flips to
  `approved`, schedules `internal.opsBrain.execute`.
- `dismiss` / `snooze(id, until)` (mutations).
- `execute` (internal action): re-reads the action, runs `payload`
  (email → `sendEmail` + `notify`; session_status → patch + activity),
  records `executed`/`failed` + result, writes `activity` and an `auditEvent`.

### UI — "Ops Autopilot" panel
Add a tab/section to the dashboard AI area (extend `pulse-ai-panel.tsx` or a new
`ops-autopilot-panel.tsx`): ranked queue of proposed actions, each with
rationale + Approve / Dismiss / Snooze, and an email-preview where a draft
exists. A nav badge shows the open high-priority count.

---

## Phase 3 — Autonomy graduation

### New table `opsAutonomy`
Per `(orgId, actionType)` policy + trust stats.
```
opsAutonomy:
  orgId, actionType
  mode: union("manual","auto")     // default manual
  approvedCount, dismissedCount: number
indexes: by_org, by_org_type (orgId, actionType)
```
- When `scanOrg` creates an action whose type is `auto` for that org, it
  schedules `execute` immediately and sets `autonomy=true` (still fully logged
  to activity + audit).
- `opsActions.approve`/`dismiss` bump the trust counters.
- `opsAutonomy.suggestions` (query): action-types with ≥ N approvals and a low
  dismiss rate → surfaced as "graduate to autopilot?" prompts.
- `opsAutonomy.setMode` (mutation): owner flips a type to auto/manual
  (capability `ops.autonomy.manage`).

Guardrails: destructive/irreversible payloads (none in the initial set are
irreversible; session "confirm" is reversible) and a per-org daily auto-execute
cap to prevent runaway sends.

---

## Phase 4 — Agency-wide ops AI

- `convex/agencyOps.ts`:
  - `portfolio` (query, agency viewers only): for each subaccount under the
    agency, open ops-action counts by priority, automation health, last scan,
    7-day revenue/no-show deltas → a portfolio health board.
  - `digest` (internal action): per-agency weekly AI digest artifact — "which
    studios need attention and why" — stored as an `aiArtifacts` row scoped to
    the agency owner's entered org, or a new lightweight agency artifact.
- UI: a board in the agency console (`src/app/agency`) listing studios ranked
  by attention needed, each linking into that subaccount's Ops Autopilot.

---

## Capabilities (Access Engine)
New capabilities, added to studio/agency capability builders:
- `ops.action.approve` — approve/execute a queued action (owner, manager).
- `ops.autonomy.manage` — flip autonomy modes (owner).
- `ops.portfolio.view` — agency portfolio board (agency owner/admin).

## Safety & tenancy invariants
- `orgId` is field #1 of every new index; never trusted from client args.
- The OpenAI layer is always optional: every brain/generator path has a
  deterministic fallback, so the system runs with no `OPENAI_API_KEY`.
- Execution is idempotent and logged: re-running `execute` on an already-executed
  action is a no-op; every execution writes `activity` + `auditEvent`.
- Dedupe prevents the brain from re-proposing the same open action each run.
- Per-org daily auto-execute cap bounds Phase 3 blast radius.

## Testing
Vitest + `convex-test`, mirroring existing `*.test.ts` files:
- Phase 1: cron registration shape; `runWeeklyForAllOrgs` fans out per active
  org; fallback path with no OpenAI key.
- Phase 2: `candidatesFor` produces expected actions from seeded signals; dedupe
  on re-scan; approve→execute sends/patches + logs audit; dismiss/snooze.
- Phase 3: auto-type schedules execution + sets autonomy; trust counters;
  graduation suggestions; daily cap.
- Phase 4: portfolio roll-up scoped to one agency; non-agency viewer denied.

## Out of scope (YAGNI for this build)
- SMS execution (email-only initially; SMS payload kind reserved later).
- Real Stripe refunds from ops actions.
- Conversational chat assistant (separate future spec).
- Model tiering (stays `gpt-5-mini`).
