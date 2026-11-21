# RD: What the assistant may send without approval (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `ai-platform-agency:ai-autonomy`.
Code read on `develop` (2026-11-12).

## What Pulse says
Max plan row "Let simple reminders run themselves": "A switch that lets plain reminders go out without approval. The owner can turn it on. Everything else still waits for approval." (`convex/lib/pricing.ts:644`, text at `:1203-1206`)

## What actually happens today
- The assistant settings have three choices: Suggest (default), "Auto low-risk", "Auto trusted" (`src/app/(app)/agent/page.tsx:395`, agency console `src/app/agency/agents/page.tsx:83`).
- **"Auto low-risk" does nothing different from Suggest.** No branch in `convex/agent.ts` reads `auto_low`; only `auto_trusted` auto-runs (`convex/agent.ts:409-414`). The accounting agent reads the value but also acts only on `auto_trusted`.
- **"Auto trusted" sends anything the model proposes as an email or text, to any address the model wrote.** In `_finalize`, any proposed `send_email` / `send_sms` with risk "low" is approved by `agent:auto` and executed at once (`convex/agent.ts:413-423`). The risk level comes from the model, and a missing or unknown value becomes "low" (`normalizeRisk`, `convex/agent.ts:1041-1043`). `executeApproval` sends to `proposedPayload.to` directly with `sendEmail` / `sendSms` (`convex/agent.ts:705-715`). Nothing checks that the address is one of the studio's clients, nothing checks SMS opt-outs (`convex/lib/sms.ts` has no opt-out check), and nothing limits it to reminders.
- **The plan is checked only when the switch is changed.** `setPolicy` requires the `aiAutonomy` entitlement for the autonomy field (`convex/agent.ts:120-130`), but the run reads `policy.autonomy` without re-checking (`convex/agent.ts:624`), so a studio that downgrades from Max keeps auto-sending. The agency console's `agentFleet.setAutonomy` has no plan check at all (`convex/agentFleet.ts:134-141`), so an agency can turn "Auto trusted" on for a Core studio.

## Who is hurt and how
- **Clients and strangers:** a model-written email or text goes out under the studio's name with no human reading it. The model reads studio data that includes text written by outsiders (booking notes, inbound messages); a crafted note can steer it to send client details to an outside address ("prompt injection"). Opted-out phone numbers can be texted, which is a legal problem for SMS in the US.
- **The studio:** messages it never approved, possibly to the wrong people.
- **Pulse:** sells "plain reminders" and "the owner can turn it on" when the working option is much broader and an agency can turn it on.

**Can it be happening in production now?** Only for orgs whose `agentPolicies.autonomy` is `auto_trusted`. How the owner can check: production `agentPolicies` where `autonomy = "auto_trusted"`; then `agentApprovals` with `decidedBy: "agent:auto"` for those orgs, and look at each `proposedPayload.to` against that studio's `artists`.

## Cause (verified on develop)
`convex/agent.ts:409-414`, `:1041-1043`, `:624`, `:705-715`; `convex/agentFleet.ts:134-141`. The audit description is correct; the second reviewer's raise to High is right.

## Proposed fix (smallest correct change)
In `convex/agent.ts`:
1. `normalizeRisk` defaults to `"medium"`, so a missing risk never auto-sends.
2. In `_finalize`, auto-approve only when all are true: autonomy is `auto_trusted`; `orgHasFeature(ctx, orgId, "aiAutonomy")` right now; the action is `send_email` or `send_sms`; the `to` matches the email or phone of an existing client (`artists`) of this org; for SMS, the number is not in `smsOptOuts`. Otherwise the approval stays `pending` for a person.
3. In `executeApproval`, check the SMS opt-out again before sending (approved-by-person sends too).
4. Remove the "Auto low-risk" option from both selects (or implement it per decision 1), and treat stored `auto_low` as `suggest`.
5. `agentFleet.setAutonomy`: require the sub-account's plan to include `aiAutonomy`.
6. Optional, recommended: limit auto-send to a fixed set of reminder kinds the model must name (session reminder, balance reminder, file delivery ready), matching the price list wording.
Files: `convex/agent.ts`, `convex/agentFleet.ts`, `src/app/(app)/agent/page.tsx`, `src/app/agency/agents/page.tsx`, tests in `convex/agent.test.ts`.
**Schema:** none (the `auto_low` literal can stay in the union for old rows).
**One-time correction:** none to data. The owner may want to review past `agent:auto` sends found by the check above.

## Decisions for the owner
1. "Auto low-risk": (a) remove it (recommended); (b) define it as "internal actions only, never messages to clients" and build it.
2. Scope of auto-send: (a) any message to an existing client (minimum fix); (b) only named reminder kinds to existing clients (recommended; matches what the price list sells).
3. Agency console: should an agency be allowed to turn auto-send on for a studio at all, or only the studio's owner (the price list says "the owner")? Recommend owner only.

## Interim step (no money logic)
Reword the price row now to "A switch that lets the assistant send messages to your clients without approval. Off unless the owner turns it on." Optionally the owner can set any `auto_trusted` policy back to `suggest` from the app, which is a settings change, not code.

## Risk
- Studios that use auto-send today will see more messages waiting for approval. That is intended; tell them.
- Matching `to` against clients must normalise emails and phone numbers (case, +1), or real reminders get held back. Tests cover both formats.
- **Rollback:** revert the extra conditions; behaviour returns to today.
