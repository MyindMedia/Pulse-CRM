# Handoff: put Outreach prospects into Zuops (owner decision 2026-11-11)

Repo `MyindMedia/Pulse-CRM`, branch `feat/agency-crm-zu`, draft PR #185 into `develop`. Work on this branch, push to it, never merge, never deploy, never push to `main` or `develop`.

Read first: `AGENTS.md`, `openspec/changes/agency-crm-zuops/design.md` (whole file, incl. the Addendum), `specs/features/agency-crm-zuops/eval.md`, `specs/features/agency-crm-zuops/state.md`, then the code: `convex/crm.ts`, `convex/crm/zu.ts`, `convex/crm/policy.ts`, `convex/crm/access.ts`, `convex/crm/tables.ts`, `convex/outreach/tables.ts` (`outreachProspects`, `outreachSuppressions`), `convex/outreachProspects.ts`, `src/components/agency/outreach-workspace.tsx`, `src/components/agency/crm/crm-ui.tsx`, `src/components/agency/crm/use-zu.ts`, `src/components/agency/crm/crm-guard.test.ts`.

## The owner's words
"the out reach contacts should be put in but put into a phase thats outreach or email sent. and we will tier them from that if they respond." And: narrower staff access is fine "because max b will be a AI employee".

## What to build
Outreach prospects (Pulse's own `outreachProspects` rows) become leads in the Zuops sub-account, in a pipeline stage named **Outreach**. The owner tiers them by hand from there when they respond. Pulse stays the record for prospecting; Zuops gets a lead so the pipeline shows everyone in one place.

### Safety rules (these are the point; do not relax them)
1. **Never send a phone number.** These studios never opted in to texts or calls. A Zuops lead with no phone cannot be texted or called by auto-greet, AI replies or AI calling. Create with `full_name`, `email`, `source: "other"`, `stage_key`, `tags`, `inquiry`, `notes` only.
2. **Never `run_intake`.** Do not send the field at all.
3. **Never push an opted-out prospect.** Skip any prospect whose status is the opted-out/removed state, whose `replyIntent.optedOut` is true, or whose email is in `outreachSuppressions`. If a prospect that is already linked later opts out, call `POST /v1/leads/{lead_id}/do-not-contact` on its Zuops lead (once) and record it.
4. **Writes switch.** Everything here refuses unless `ZUOPS_CRM_WRITES === "on"`. Staging leaves it unset, so staging never writes.
5. **Human starts the first push.** The bulk push is a public action that requires `confirm: true`, and in the UI that flag may only come from `ConfirmDialog`'s `onConfirm(grant)` (`crm-guard.test.ts` enforces it). The dialog states the exact count.
6. **Access:** `crmAccess` (owner or admin of the pinned Pulse agency), same as `crm.call`. `agencyId` is never a client argument.
7. **No personal data in new tables, logs or audit rows.** The link table holds ids and status words only.
8. No em dashes in copy. US spelling. Say "Zuops".

### Backend: `convex/crmProspects.ts` (+ table in `convex/crm/tables.ts`, entries in `convex/_generated/api.d.ts` by hand, matching the existing pattern)
- Table `crmProspectLinks { agencyId, prospectId: Id<"outreachProspects">, zuLeadId: string, pushedAt: number, lastStatus: string, lastSyncedAt: number, dnc?: boolean, matched?: boolean }`, indexes `by_agency_prospect`, `by_agency`.
- `plan` (query): `null` without access, else `{ total, eligible, linked, toPush, skippedNoEmail, skippedOptedOut, writesOn, stageReady }`. Bounded reads (the prospect list is capped at 300 elsewhere: follow that cap; no unbounded `.collect()` on other tables).
- `push` (action, args `{ confirm: v.optional(v.boolean()), limit: v.optional(v.number()) }`): refuse without access, without the key, without writes on, without `confirm: true` (in that order, no request on refusal). Then:
  1. Ensure the stage: `GET /v1/stages`; if none has label "Outreach" (case-insensitive), `POST /v1/stages { label: "Outreach", behavior: "new", color: "slate", manual_only: true }` and use the `key` Zuops returns.
  2. For up to `limit` (default 25, max 50) eligible, unlinked prospects, oldest first: `POST /v1/leads` with `Idempotency-Key: prospect-<prospectId>` and body `{ full_name: <prospect name or handle>, email: <primary email: the first non-generic published email, else the first>, source: "other", stage_key, tags: ["Outreach", <status tag>], inquiry: "Pulse outreach prospect", notes: <website url and instagram handle, nothing else> }`.
  3. On 409 duplicate (`details.lead_id`): link to that lead with `matched: true`, and `PATCH /v1/leads/{id}` with `add_tags` only. Do NOT change the stage of a lead that already existed.
  4. Insert the link row. Stop the batch on 429 (return `retryAfter`) or on three consecutive failures.
  5. Return `{ ok, pushed, matched, failed, remaining, reason? }`. Audit one `outreachEvents` row per batch through the existing `logEvent` (action `crm.prospects.push`, detail = counts only).
- Status tags: map the prospect's status to exactly one of `Outreach: not emailed`, `Outreach: email sent`, `Outreach: replied`, `Outreach: booked` (read `prospectStatusV` and the `repliedAt` / `bookedAt` fields to map correctly; write the mapping as a pure function with a test per status).
- `syncStatuses` (internalAction) + a cron every 15 minutes in `convex/crons.ts`: no-op unless the key is set and writes are on. For linked prospects whose mapped tag differs from `lastStatus` (at most 25 per run): `PATCH /v1/leads/{id}` with `add_tags: [new]`, `remove_tags: [old]`, then update the link. For a linked prospect that is now opted out and not yet `dnc`: `POST /v1/leads/{id}/do-not-contact`, set `dnc: true`. It never creates leads and never moves stages. Add `/do-not-contact` and tag patches to nothing in `policy.ts`: this path does not go through `crm.call`; it is its own narrow, fixed set of four requests. Reuse `zuRequest` and mock mode (`ZUOPS_CRM_MOCK_URL`) exactly as `crm.ts` does (extract a small shared helper from `crm.ts` for "which base and key" rather than copying it; keep `crm.ts` behavior identical and its tests green).
- Existing eval check X-07 says no cron in Pulse calls a sending endpoint: this cron only tags and marks do-not-contact. Keep the X-07 test passing and extend it to assert `crmProspects.ts` contains no `/v1/messages`, `/send`, `/enroll`, `run_intake` or `phone`.
- Tests (`convex/crmProspects.test.ts`, convex-test + mocked fetch, invented studios only, e.g. "Northline Sound", hello@northline.example): access matrix (signed out, studio member, staff, other agency, owner); refusal order with zero fetch; no phone ever in any request body even when the prospect has phones; opted-out and suppressed prospects never pushed; stage created once and reused; idempotency key per prospect; 409 links without a stage change; batch limit and `remaining`; 429 stops the batch; status sync swaps tags; opt-out after linking calls do-not-contact once; nothing personal in `crmProspectLinks` or the audit row (scan rows for the fixture email and name).

### UI
- In `src/components/agency/outreach-workspace.tsx` (above the tabs) add one card, `ProspectsToZuops` in a new file `src/components/agency/crm/prospects-zuops.tsx`: "N of M prospects are in Zuops, in the Outreach stage." with the skipped counts in words, a `WriteButton` "Add K prospects to Zuops" that opens `ConfirmDialog` ("Add 25 prospects to Zuops? They go into the Outreach stage as leads with their email only. No phone number is sent, so Zuops cannot text or call them. Nobody is emailed by this."), a progress line while batches run (the button runs batches of 25 until `remaining` is 0 or a batch fails; one confirm covers the run), and the read-only reason when writes are off. Show "Zuops not connected" quietly when there is no key: the rest of Prospects must still work.
- CRM Pipeline already draws a column per Zuops stage, so "Outreach" appears on its own.
- Tests following `crm-leads.test.tsx` (renderToStaticMarkup with mocked hooks): states for no key, read only, nothing to push, K to push; the confirm text; `crm-guard.test.ts` still passes.

## Verify (no secrets are available in the cloud; that is fine)
- `npm ci` if `node_modules` is missing. Node 22.
- `npx vitest run convex/crm convex/crmProspects.test.ts src/components/agency src/app/agency`, `npx vitest run -c vitest.outreach.config.ts`, `npx tsc --noEmit`, `npx eslint --max-warnings 0` on the files you touched, `node scripts/zu-ops.mjs --check` (needs network to api.usezu.com; if blocked, say so).
- Do NOT call the real Zuops API with any key. Do NOT run `convex dev`, `convex deploy` or `convex codegen`. Use `node scripts/zu-mock.mjs` only if you want a manual check.
- Add the new files to `vitest.outreach.config.ts` / `tsconfig.outreach.json` include lists if the files you touch are listed there.

## Finish
1. Update `specs/features/agency-crm-zuops/eval.md`: add row U-17 (prospects into Zuops: the safety rules above, with the test names as evidence) under Screens, and one line under "Changes after approval". Update `state.md` and append one paragraph to `Grilled.md` (the owner's decision, quoted, and that phone numbers are never sent).
2. Commit in small steps, push to `feat/agency-crm-zu`, and comment on PR #185 with: what was built, the test tails, what was not verified (no browser run, no real Zuops write), and the one production step: this only does anything where `ZUOPS_CRM_WRITES=on`.
3. Leave both PRs (#185, #187) as drafts. Do not merge.

## Still open for the owner (do not act on these)
- "merge both" for #185 and #187 into `develop` (staging).
- Whether to fix `agencyStaff.setRole` (an agency admin can promote anyone, themselves included, to owner).
- Full access Zuops key (`API Full` on the 1Password item) for live webhooks.
