# Eval: What the assistant may send without approval
Status: draft, waiting for owner approval
Risk: High. It controls whether model-written messages reach real people without a human reading them, and it enforces a paid plan. If it is wrong, client data can be sent outside the studio, opted-out numbers get texted, or approved reminders stop going out.
RD: ./rd.md

## Must not break
- Suggest mode: proposals appear in the approval inbox, a person approves, the message is sent
- Daily digest delivery to the owner
- Accounting agent autonomy behaviour
- Agency console agent list and run-now
- `npx tsc --noEmit`, `npm run lint`, vitest, with only the known failures

## Checks
| ID | Check | How to verify | Result | Evidence |
|---|---|---|---|---|
| U-01 | Missing or unknown risk is treated as medium and waits | Unit test `normalizeRisk(undefined)` → "medium"; `_finalize` → `pending` | PASS | `convex/agentAutoSend.test.ts` "U-01: a missing or unknown risk is medium and waits" |
| U-02 | Auto-send to an existing client's email works on Max with auto_trusted | convex-test → approval `approved` by `agent:auto`, send scheduled | PASS | `convex/agentAutoSend.test.ts` "U-02: a named reminder to an existing client's email auto-sends on Max with auto_trusted" |
| U-03 | Auto-send to an address that is not a client of this org waits | convex-test with a stranger's email → `pending` | PASS | `convex/agentAutoSend.test.ts` "U-03: an address that is not a client of this studio waits" |
| U-04 | Auto-send to another studio's client waits | convex-test: email of org B's artist, run in org A → `pending` | PASS | `convex/agentAutoSend.test.ts` "U-04: another studio's client waits" |
| U-05 | SMS to an opted-out number never sends, even after a person approves | convex-test with `smsOptOuts` row → not sent, result recorded | PASS | `convex/agentAutoSend.test.ts` "U-05: a text to an opted-out client never auto-sends, and is not sent after a person approves"; also `convex/agent.test.ts` "an approved assistant text to a number that replied STOP is not sent" |
| U-06 | Phone and email matching handles case and +1 formats | Unit tests | PASS | `convex/agentAutoSend.test.ts` "U-06: email and phone matching handles case and +1 formats" |
| U-07 | Studio downgraded from Max stops auto-sending at once | convex-test: policy auto_trusted, tier growth → `pending` | PASS | `convex/agentAutoSend.test.ts` "U-07: a studio downgraded from Max stops auto-sending at once" and "U-07b: the operator switching the module off stops auto-send too" |
| U-08 | Agency cannot turn on auto-send for a studio without the plan (or at all, per decision 3) | convex-test on `agentFleet.setAutonomy` | PASS | `convex/agentAutoSend.test.ts` "U-08: an agency cannot turn auto-send on for a studio, but can turn it off" (decision 3: owner only) |
| U-09 | Non-owner cannot change autonomy | convex-test with engineer identity → FORBIDDEN | PASS | `convex/agentAutoSend.test.ts` "U-09: a non-owner cannot change autonomy; the owner on Max can" and "U-09b: an owner on Growth cannot turn auto-send on" |
| U-10 | Signed-out caller cannot change autonomy or approve | convex-test → error | PASS | `convex/agentAutoSend.test.ts` "U-10: a signed-out caller cannot change autonomy or approve" |
| U-11 | `executeApproval` called twice sends once | convex-test: second call sees status not `approved` → no send | PASS | `convex/agentAutoSend.test.ts` "U-11: executeApproval called twice sends once" (two concurrent calls plus a third) |
| U-12 | Prompt injection in a booking note does not cause an outside send | convex-test with a stubbed model output proposing `to: attacker@example.com` → `pending` | PASS | `convex/agentAutoSend.test.ts` "U-12: a model steered by a booking note to send outside the studio waits for a person" (model output stubbed) |
| U-13 | "Auto low-risk" no longer offered; stored `auto_low` behaves as suggest | Playwright on staging; convex-test | PASS (convex-test); screen NOT RUN | convex-test part: `convex/agentAutoSend.test.ts` "U-13: stored auto_low reads and behaves as suggest; it can no longer be saved". Screen part NOT RUN: on staging open /agent and /agency/agents and confirm "Auto low-risk" is gone |
| U-14 | Must-not-break list passes | Full suite | PASS | Full suite: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` with only the three known failures (counts in the pull request) |
