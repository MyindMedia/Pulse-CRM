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
| U-01 | Missing or unknown risk is treated as medium and waits | Unit test `normalizeRisk(undefined)` → "medium"; `_finalize` → `pending` | PENDING | |
| U-02 | Auto-send to an existing client's email works on Max with auto_trusted | convex-test → approval `approved` by `agent:auto`, send scheduled | PENDING | |
| U-03 | Auto-send to an address that is not a client of this org waits | convex-test with a stranger's email → `pending` | PENDING | |
| U-04 | Auto-send to another studio's client waits | convex-test: email of org B's artist, run in org A → `pending` | PENDING | |
| U-05 | SMS to an opted-out number never sends, even after a person approves | convex-test with `smsOptOuts` row → not sent, result recorded | PENDING | |
| U-06 | Phone and email matching handles case and +1 formats | Unit tests | PENDING | |
| U-07 | Studio downgraded from Max stops auto-sending at once | convex-test: policy auto_trusted, tier growth → `pending` | PENDING | |
| U-08 | Agency cannot turn on auto-send for a studio without the plan (or at all, per decision 3) | convex-test on `agentFleet.setAutonomy` | PENDING | |
| U-09 | Non-owner cannot change autonomy | convex-test with engineer identity → FORBIDDEN | PENDING | |
| U-10 | Signed-out caller cannot change autonomy or approve | convex-test → error | PENDING | |
| U-11 | `executeApproval` called twice sends once | convex-test: second call sees status not `approved` → no send | PENDING | |
| U-12 | Prompt injection in a booking note does not cause an outside send | convex-test with a stubbed model output proposing `to: attacker@example.com` → `pending` | PENDING | |
| U-13 | "Auto low-risk" no longer offered; stored `auto_low` behaves as suggest | Playwright on staging; convex-test | PENDING | |
| U-14 | Must-not-break list passes | Full suite | PENDING | |
