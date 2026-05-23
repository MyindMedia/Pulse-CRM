# Operational AI "Ops Autopilot" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a system-wide operational AI layer for Pulse that runs every subaccount's back office on a schedule, proposes/executes operational actions per studio, graduates trusted actions to autonomy, and rolls up across an agency.

**Architecture:** A `crons.ts` heartbeat fans deterministic + AI work across all active orgs. A per-org "ops brain" gathers operational signals, derives candidate actions (deterministic, OpenAI-optionally-ranked), and writes them to a new `opsActions` table with an approval lifecycle. Approved/auto actions execute through the existing `notify`/`sendEmail`/session seams, fully audited. An `opsAutonomy` table graduates trusted action types. An agency portfolio query rolls up across subaccounts.

**Tech Stack:** Convex (queries/mutations/actions/crons), TypeScript, OpenAI `gpt-5-mini` (optional, via `convex/lib/openai.ts`), Vitest + `convex-test`.

---

## File Structure

- Create `convex/crons.ts` — cron registration (Phase 1).
- Create `convex/orgs.ts` — `internal.orgs.listActiveOrgIds` (Phase 1). *(if `orgs.ts` already exists, add the export there)*
- Modify `convex/aiContext.ts` — add `*ForOrg` internalQuery variants (Phase 1).
- Modify `convex/aiActions.ts` — extract per-org generators + `*ForAllOrgs` fan-outs (Phase 1).
- Modify `convex/schema.ts` — add `opsActions`, `opsAutonomy` tables (Phase 2/3).
- Create `convex/opsBrain.ts` — signal gathering, candidate rules, scan actions (Phase 2).
- Create `convex/opsActions.ts` — queue queries + approve/dismiss/snooze + execute (Phase 2).
- Create `convex/agencyOps.ts` — portfolio roll-up (Phase 4).
- Modify `convex/lib/access.ts` — add `ops.*` capabilities to builders (Phase 2/3/4).
- Create `src/components/ai/ops-autopilot-panel.tsx` — approval queue UI (Phase 2).
- Tests: `convex/opsBrain.test.ts`, `convex/opsActions.test.ts`, `convex/opsAutonomy.test.ts`, `convex/agencyOps.test.ts`, `convex/aiActions.fanout.test.ts`.

---

## Phase 1 — Operational backbone

### Task 1: `listActiveOrgIds` internal query

**Files:**
- Create/modify: `convex/orgs.ts`
- Test: `convex/aiActions.fanout.test.ts`

- [ ] **Step 1: Write failing test**
```ts
import { convexTest } from "convex-test";
import schema from "./schema";
import { internal } from "./_generated/api";
import { expect, test } from "vitest";

test("listActiveOrgIds returns active non-demo orgs", async () => {
  const t = convexTest(schema);
  await t.run(async (ctx) => {
    await ctx.db.insert("orgs", { orgId: "org_a", name: "A", slug: "a", plan: "studio", status: "active" });
    await ctx.db.insert("orgs", { orgId: "org_b", name: "B", slug: "b", plan: "studio", status: "paused" });
    await ctx.db.insert("orgs", { orgId: "pulse-demo", name: "Demo", slug: "demo", plan: "studio", status: "active" });
  });
  const ids = await t.query(internal.orgs.listActiveOrgIds, {});
  expect(ids).toEqual(["org_a"]);
});
```
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run convex/aiActions.fanout.test.ts`
- [ ] **Step 3: Implement** in `convex/orgs.ts`:
```ts
import { internalQuery } from "./_generated/server";

export const listActiveOrgIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("orgs").collect();
    return orgs
      .filter((o) => (o.status ?? "active") === "active" && o.orgId !== "pulse-demo")
      .map((o) => o.orgId);
  },
});
```
- [ ] **Step 4: Run, expect PASS**
- [ ] **Step 5: Commit** `feat(ops): listActiveOrgIds internal query`

### Task 2: Org-explicit AI context variants

**Files:**
- Modify: `convex/aiContext.ts`

Extract the body of `weeklyBriefingContext` and `rateCutContext` into pure helpers
`weeklyBriefingFor(ctx, orgId)` / `rateCutFor(ctx, orgId)` that take an explicit orgId.
Keep the existing public queries calling the helper with `await currentOrg(ctx)`.
Add internalQuery variants:
```ts
export const weeklyBriefingContextForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => weeklyBriefingFor(ctx, orgId),
});
export const rateCutContextForOrg = internalQuery({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => rateCutFor(ctx, orgId),
});
```
- [ ] Steps: refactor (no behavior change for public path) → run existing `convex` tests → commit `refactor(ops): org-explicit AI context helpers`.

### Task 3: Per-org generators + all-org fan-out

**Files:**
- Modify: `convex/aiActions.ts`
- Test: `convex/aiActions.fanout.test.ts`

Extract the prompt/fallback bodies of `generateWeeklyBriefing` / `generateRateCutPromos`
into helpers keyed by the context object, then:
```ts
export const generateWeeklyBriefingForOrg = internalAction({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const data = await ctx.runQuery(internal.aiContext.weeklyBriefingContextForOrg, { orgId });
    if (!data) return; await writeWeeklyBriefing(ctx, data);
  },
});
export const runWeeklyForAllOrgs = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.orgs.listActiveOrgIds, {});
    for (const orgId of ids) await ctx.scheduler.runAfter(0, internal.aiActions.generateWeeklyBriefingForOrg, { orgId });
    return { scheduled: ids.length };
  },
});
// same shape for rate-cut
```
- [ ] Test: seed 2 active orgs, run `runWeeklyForAllOrgs`, assert `{ scheduled: 2 }` and (after `t.finishAllScheduledFunctions()`) one `weekly_briefing` artifact per org.
- [ ] Commit `feat(ops): per-org AI generators + all-org fan-out`.

### Task 4: `convex/crons.ts`

**Files:**
- Create: `convex/crons.ts`

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("booking-automation", { minutes: 15 }, internal.automation.tick);
crons.interval("room-status", { minutes: 15 }, internal.maintenance.recomputeAllRoomStatuses);
crons.daily("ops-brain", { hourUTC: 13, minuteUTC: 0 }, internal.opsBrain.scanAllOrgs);
crons.weekly("weekly-briefing", { dayOfWeek: "monday", hourUTC: 13, minuteUTC: 0 }, internal.aiActions.runWeeklyForAllOrgs);
crons.weekly("rate-cut-sweep", { dayOfWeek: "monday", hourUTC: 13, minuteUTC: 5 }, internal.aiActions.runRateCutForAllOrgs);
export default crons;
```
*(Note: `automation.tick` is already an `internalMutation`; `scanAllOrgs` is added in Phase 2 — add that cron line in Phase 2 if implementing strictly in order, or stub `scanAllOrgs` first.)*
- [ ] Verify `npx convex dev --once` registers crons without error. Commit `feat(ops): crons.ts heartbeat`.

---

## Phase 2 — AI ops brain (HITL)

### Task 5: Schema — `opsActions` table

**Files:** Modify `convex/schema.ts`

Add the `opsActions` table exactly as specified in the design doc (orgId, type union,
priority, title, rationale, entityType/Id, payload union of email/session_status/note_only,
status union, autonomy bool, source, model, dedupeKey, snoozeUntil, decidedBy, timestamps,
result) with indexes `by_org`, `by_org_status` (orgId,status), `by_org_dedupe`
(orgId,dedupeKey), `by_entity` (entityId).
- [ ] Run `npx convex dev --once` to push schema. Commit `feat(ops): opsActions schema`.

### Task 6: `opsBrain.candidatesFor` deterministic rules

**Files:** Create `convex/opsBrain.ts`; Test `convex/opsBrain.test.ts`

`gatherState(ctx, orgId)` returns `{ quietArtists, overdueInvoices, unconfirmedSessions, ... }`.
`candidatesFor(state)` returns `ProposedAction[]` with stable `dedupeKey = \`${type}:${entityId}\``.
- [ ] Test: seed an artist with `lastContactAt` 130 days ago + a `sent` overdue invoice → expect a `reengage_quiet_artist` and a `payment_reminder` candidate with correct entityIds and a `note_only`/`email` payload.
- [ ] Implement gather + rules. Run, PASS. Commit `feat(ops): brain signal gathering + candidate rules`.

### Task 7: `scanOrg` + dedupe upsert

**Files:** `convex/opsBrain.ts`; Test `convex/opsBrain.test.ts`

`upsertProposed` (internalMutation): for each candidate, skip if an OPEN row
(`status in proposed|approved|snoozed`) with same `dedupeKey` exists; else insert
`status:"proposed"`. `scanOrg` (internalAction): gather → candidates → optional OpenAI
ranking/copy (fallback templated) → `upsertProposed`. `scanAllOrgs`: fan out per active org.
- [ ] Test: run `scanOrg` twice on same seed → exactly one row per candidate (dedupe holds).
- [ ] Commit `feat(ops): scanOrg with dedupe + scanAllOrgs fan-out`.

### Task 8: `opsActions` queue API + execute

**Files:** Create `convex/opsActions.ts`; Modify `convex/lib/access.ts`; Test `convex/opsActions.test.ts`

Add capabilities `ops.action.approve`, `ops.autonomy.manage` to `buildStudioCaps`
(owner+manager get approve; owner gets autonomy.manage). Implement `list`, `counts`,
`approve` (requireCapability → status `approved`, schedule `execute`), `dismiss`, `snooze`,
and internal `execute` (idempotent: no-op if already executed; email payload →
`sendEmail`+`notify`; session_status → patch + `activity`; always writes `auditEvent`).
- [ ] Test: approve an email action → after scheduled fns run, status `executed`, a
`notifications` row exists, an `auditEvent` row exists; re-running `execute` is a no-op.
- [ ] Test: dismiss sets `dismissed`; snooze sets `snoozed`+`snoozeUntil`.
- [ ] Commit `feat(ops): ops action queue + audited execution`.

### Task 9: Ops Autopilot UI panel

**Files:** Create `src/components/ai/ops-autopilot-panel.tsx`; wire into dashboard.

Render `api.opsActions.list`, grouped by priority; each card shows title, rationale,
email preview when payload.kind==="email", and Approve/Dismiss/Snooze buttons calling the
mutations with toast feedback. Add a count badge from `api.opsActions.counts`.
*(Read `node_modules/next/dist/docs/` conventions before editing app/page files — this Next is non-standard per AGENTS.md.)*
- [ ] Manual verify in `npm run dev` after `npx convex dev --once`. Commit `feat(ops): Ops Autopilot approval panel`.

---

## Phase 3 — Autonomy graduation

### Task 10: Schema — `opsAutonomy`; trust counters

**Files:** Modify `convex/schema.ts`, `convex/opsActions.ts`; Test `convex/opsAutonomy.test.ts`

Add `opsAutonomy` table (orgId, actionType, mode default "manual", approvedCount,
dismissedCount; indexes by_org, by_org_type). `approve`/`dismiss` bump counters via an
internal `bumpTrust(orgId, type, kind)` helper.
- [ ] Test: approve twice → approvedCount 2 for that type.
- [ ] Commit `feat(ops): autonomy table + trust counters`.

### Task 11: Auto-execute + daily cap + graduation suggestions

**Files:** `convex/opsBrain.ts`, `convex/opsActions.ts`; Test `convex/opsAutonomy.test.ts`

In `upsertProposed`: if `opsAutonomy.mode==="auto"` for the type AND the per-org
auto-executed-today count < `DAILY_AUTO_CAP` (e.g. 20), insert with `autonomy:true,
status:"approved"` and schedule `execute`. Add `opsAutonomy.suggestions` query
(approvedCount ≥ 5 and dismissedCount/(approved+dismissed) < 0.2) and `setMode` mutation
(requireCapability `ops.autonomy.manage`).
- [ ] Test: set type to auto → `scanOrg` auto-executes (status executed, autonomy true);
cap blocks beyond limit; suggestion appears after 5 clean approvals.
- [ ] Commit `feat(ops): autonomous execution with daily cap + graduation`.

---

## Phase 4 — Agency-wide ops AI

### Task 12: `agencyOps.portfolio`

**Files:** Create `convex/agencyOps.ts`; Modify `convex/lib/access.ts` (`ops.portfolio.view` for agency owner/admin); Test `convex/agencyOps.test.ts`

`portfolio` (query): resolve agency viewer; for each subaccount under the agency
(`orgs.by_agency`), return `{ orgId, name, openHigh, openTotal, lastScanAt }` from
`opsActions` counts. Deny non-agency viewers.
- [ ] Test: two subaccounts under agency_x with seeded opsActions → portfolio returns both
with correct open-high counts; a studio-only viewer is denied.
- [ ] Commit `feat(ops): agency portfolio roll-up`.

### Task 13: Agency portfolio UI

**Files:** Create a board under `src/app/agency` listing studios ranked by `openHigh`,
each linking into that subaccount. Manual verify. Commit `feat(ops): agency portfolio board`.

---

## Final regression gate (before any push)
Per project rule "always run regression testing before pushing":
- `npx tsc --noEmit` (or project `typecheck`) — clean.
- `npm run lint` — clean.
- `npx vitest run` — all green.
- `npx convex dev --once` — schema + crons push without error.
- Smoke the dashboard Ops Autopilot panel.
State results in chat before pushing. Do not push unless asked.

## Self-Review notes
- Spec coverage: Phase 1 (Tasks 1–4), Phase 2 (5–9), Phase 3 (10–11), Phase 4 (12–13),
  capabilities woven into Tasks 8/11/12, testing per task, safety invariants (dedupe,
  idempotent execute, audit, daily cap) covered. No gaps.
- No placeholders: all tasks carry concrete code or exact behavior + test assertions.
- Type consistency: `dedupeKey`, `payload` union, `status` union, capability strings,
  fan-out fn names match across tasks and the design doc.
