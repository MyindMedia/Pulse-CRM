# Implementation tasks (phase C)

- [x] Spec: proposal, design, tasks.
- [x] Scope as data: `convex/lib/agentScope.ts` (allowlist, forbidden list, ownership of every inbox kind, `assertActionInScope`, `routeIntent`, `plain`).
- [x] Pure generators: `convex/agents/accounting.ts` (receipt matching, clearing, categorization, close checklist, anomalies, owner digest).
- [x] Ledger helpers: `createEntry`, `postDraft`, `attachReceipt`, `ledgerPeriodView`, exported `writeOrg` in `convex/ledger.ts`; public mutations unchanged.
- [x] Schema: eight `acct_*` kinds, `ledger_draft` / `receipt_link` / `acct_note` payloads, `riskLevel`, `confidence`, `agentPolicies.accountingEnabled`, `agentRuns.runType` `accounting_scan`.
- [x] Scan, approvals, switch, overview and money-question answers: `convex/accountingAgent.ts`; daily cron.
- [x] Shared inbox: accounting kinds hidden from non-money viewers, decided through the Accounting path, refused by `upsertProposed` and `opsActions.setMode`.
- [x] Routing in `agent.createRun`, hand-off line in the general agent prompt.
- [x] Agency fleet view and switch (`agentFleet`).
- [x] Inbox UI: "Accounting" group, draft lines and evidence in the detail sheet.
- [x] Optional AI wording (`aiActions.enrichAccountingActions`), verified against the figures, not scheduled without a key.
- [x] Tests: scope (`convex/lib/agentScope.test.ts`), generators (`convex/agents/accounting.test.ts`), end to end on the anonymized July books (`convex/accountingAgent.test.ts`).
- [x] `npx tsc --noEmit`, eslint on changed files, `npx vitest run`.
- [ ] Owner decisions: the three listed in design.md; how to book the 75.00 that remains unexplained.
- [ ] Phase B: branded report UI could show agent drafts and the close checklist.
