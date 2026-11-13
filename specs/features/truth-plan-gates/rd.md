# RD: Plan gates that are not enforced (truth fix, B5)

Status: draft, waiting for owner approval. No code has been written.
Audit id covered: `ai-platform-agency:entitlement-gate`.
Code read on `develop` (2026-11-12).

## What Pulse says
"You get what you paid for: Your plan is enforced in the code itself. A locked feature stays locked even if someone finds its address." (`convex/lib/pricing.ts:1387-1389`)

## What actually happens today
Most paid features go through `requireCapability` / `requireFeature` (`convex/lib/entitlements.ts:117-125`), which checks the plan and the operator's module switch. These do not:
1. **AI receptionist (Growth).** The settings Integrations tab shows the receptionist panel on every plan (`src/app/(app)/settings/page.tsx:183`). `orgs.setAiReceptionist` checks only the `branding.edit` role, not the plan (`convex/orgs.ts:465-468`). Inbound SMS starts the receptionist on the stored flag alone (`convex/sms.ts:404`), and `receptionist._context` also reads only the flag (`convex/receptionist.ts:135-144`). So a Core studio can switch it on, and an operator switching the module off does not stop it.
2. **Visitor check-in (Growth).** Public `visitors.register` finds the studio from the URL slug and records the visit with no plan check (`convex/visitors.ts:242-288`). `registerManual`, `checkOut`, `list` and `directory` use only `currentOrg` (`convex/visitors.ts:290-407`): no plan check and no role check, so any signed-in member of the studio can add, check out and read visitor records.
3. **Data exports (Growth row "Download your numbers", `convex/lib/pricing.ts:675`).** The `apiExports` entitlement is never checked; exports use a role check with `allowLocked: true` (`convex/exports.ts:65`, `:86`, `:107`, `:129`). The file header says this is on purpose: "A billing-locked studio can still export: the data is theirs whether or not the plan is paid." (`convex/exports.ts:10-12`).
4. **Multi-studio** is only used to decide what is shown in the modules list (`convex/modules.ts:85`); there is no server check. I did not find a server path that a lower plan could misuse with it, so it is listed for completeness only.
5. **Assistant auto-send** is not re-checked at send time: covered in `truth-assistant-auto-send`.

## Who is hurt and how
- **Pulse** gives away Growth features to Core studios (receptionist, which also costs Pulse model usage per message; visitor check-in).
- **Studios' clients:** the receptionist answers clients' texts automatically even where the operator switched it off.
- **Visitors:** any studio member, including the lowest role, can read the visitor log (names, phone numbers, vehicles if collected). That is a privacy issue, not only a pricing one.

**Can it be happening in production now?** Yes. How the owner can check: production `orgs` with `aiReceptionistEnabled: true` whose plan is Core (or whose operator disabled list contains the receptionist module); `visitors` rows for orgs on Core.

## Cause (verified on develop)
`convex/orgs.ts:468`, `convex/sms.ts:404`, `convex/receptionist.ts:144`, `src/app/(app)/settings/page.tsx:183`, `convex/visitors.ts:242-315`, `convex/exports.ts:10-12` and `:65`. The audit description is correct. Its note that exports may be ungated on purpose is confirmed by the file header.

## Proposed fix
1. Receptionist: `requireFeature(ctx, orgId, "aiReceptionist")` in `orgs.setAiReceptionist` when turning it on; `orgHasFeature(ctx, orgId, "aiReceptionist")` in `sms.ts:404` and in `receptionist._context` before replying; hide the panel (show an upgrade card instead) on plans without it.
2. Visitors: `requireFeature(ctx, orgId, "visitors")` in `register`, `registerManual`, `checkOut`, `list` and `directory`; add a role check to the four staff functions. There is no visitor capability in `convex/lib/access.ts` today, so either add one (for example `visitors.read` / `visitors.edit`) or reuse an existing front-desk capability (decision 3). The public QR page shows "Check-in is not available" when the plan does not include it.
3. Exports: per decision 1.
Files: `convex/orgs.ts`, `convex/sms.ts`, `convex/receptionist.ts`, `convex/visitors.ts`, `src/app/(app)/settings/page.tsx`, possibly `convex/exports.ts` and `convex/lib/pricing.ts`; tests next to each.
**Schema:** none.
**One-time correction:** for Core studios that already turned the receptionist on, decide (decision 2) whether to switch it off and tell them.

## Decisions for the owner
1. Exports: (a) keep exports open to every plan as a data-rights promise and reword the Growth row to say what Growth adds (recommended; the code is already written that way on purpose); (b) gate them behind Growth except when the studio is leaving.
2. Core studios already using the receptionist or visitor check-in: (a) switch off now with an email and an upgrade offer; (b) let them keep it until a date (recommended: 30 days' notice); (c) leave them on.
3. Which role may read the visitor log.

## Interim step (no money logic)
Reword the claim now: "Your plan decides which features you can switch on." and drop "even if someone finds its address" until the gaps are closed. Separately, the visitor-log role check (fix 2, the role part only) is a small privacy fix that could go first.

## Risk
- Turning gates on cuts features off for studios that are using them today; decision 2 handles that.
- A mistake in `orgHasFeature` in the SMS path would stop the receptionist for paying studios. Tests cover each plan.
- **Rollback:** remove the added checks; no data changes.
