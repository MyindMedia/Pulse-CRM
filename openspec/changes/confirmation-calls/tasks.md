## 1. Spec
- [x] 1.1 proposal.md, design.md, tasks.md

## 2. Data
- [x] 2.1 Tables `outreachCalls`, `outreachCallSettings`, `outreachCallOptOuts`; `phone` and `phoneSynced` on `outreachBookings`
- [x] 2.2 Zuops sync stores lead phone, re-hydrates existing rows once

## 3. Logic
- [x] 3.1 `callPolicy.ts` pure eligibility, window, cap, phone, test-name
- [x] 3.2 `callScript.ts` (verbatim persona, guardrails, voice; new confirmation objective)
- [x] 3.3 `lib/bland.ts` request builder and client
- [x] 3.4 `outreachCalls.ts` planDue, claim, record, dispatchDueCalls action, settings and queries
- [x] 3.5 `blandWebhook.ts` and `/bland/events` route
- [x] 3.6 Cron every minute

## 4. UI
- [x] 4.1 Controls card in Settings, list in Meetings

## 5. Verify
- [x] 5.1 Tests: eligibility matrix, dry run never fetches, live request shape, webhook auth, idempotency
- [x] 5.2 tsc, eslint on changed files, vitest
- [x] 5.3 docs/CONFIRMATION-CALLS.md

## 6. Owner steps (not code)
- [ ] 6.1 Review callScript.ts, set CALL_SCRIPT_APPROVED = true
- [ ] 6.2 Set BLAND_API_KEY, BLAND_WEBHOOK_SECRET on pastel-corgi-340
- [ ] 6.3 Verify a real Zuops lead carries a phone field
- [ ] 6.4 Run dry run for a few days, then go live
- [ ] 6.5 Retire the old Zuops webhook 5412aeef-2f3c-49aa-98c2-226eef800cfd
