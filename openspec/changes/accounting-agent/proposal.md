## Why

Phase A put a double-entry ledger behind the owner's books and made the disagreements visible: July 2026 for the first studio shows a software charge missing from the owner's statement (19.00), cash that sits 630.00 away from the bank statement, two entries with no receipt, a text date and a mislabelled beginning cash date. Pulse can show all of that. Nobody is yet responsible for working through it every month.

The owner asked for "an accounting agent that will handle these things, specifically for the money piece; the other agents handle all other tasks." Pulse already has named agents (Booking Conversion, Session Prep, Post-Session Recap, Revision Triage, Revenue Ops, Operations, Marketing) that scan each studio, drop proposals into one approval inbox and wait for a person. The money piece belongs in that same machinery, with a hard fence around it in both directions: Accounting does money and nothing else, and nothing else touches the books.

## What Changes

- A named **Accounting agent** (id `accounting`, name "Accounting"). Tone: plain, calm, never alarmist.
- A declarative, money-only capability allowlist (`convex/lib/agentScope.ts`): it reads the ledger, expenses, receipts and the bank reconciliation; it creates draft journal entries, receipt-link proposals and categorization proposals; it writes read-only insights. It never posts, voids, edits posted entries, deletes, moves money, sends email or SMS, or changes bookings, rates, members or settings.
- Scope enforced in both directions: a guard every proposal passes before it is saved, an ownership map for every inbox action kind, a source-level test that no other module reads the ledger tables or calls the ledger API, and a routing rule that sends a money question to Accounting.
- Pure, unit-tested generators (`convex/agents/accounting.ts`): receipt matching, clearing proposals from the bank reconciliation, categorization help, a month-end close checklist, anomalies, and a plain-English monthly owner digest.
- Wiring into the existing machinery: a per-org scan (`convex/accountingAgent.ts`, daily cron), `opsActions` as the approval inbox, `agentPolicies` for autonomy and a studio on/off switch, `agentRuns` for the run log, `agentInsights` for the checklist and digest, the agency fleet view, and an approve path that posts through the ledger API.
- Optional AI wording for a proposal's explanation, following the existing enrichment pattern, held to the deterministic figures and falling back to them.

## Capabilities

### New Capabilities
- `agents/accounting`: the named agent, its scope, its generators, its scan and its approvals.

### Modified Capabilities
- `agents/approval-inbox`: money items appear for people who may see the books, and are decided by an owner or manager through the Accounting path.
- `agents/pulse-agent`: a free-text money question is answered by Accounting, not the general agent.

## Impact

- Schema: `opsActions.type` gains eight `acct_*` kinds and three payload kinds (`ledger_draft`, `receipt_link`, `acct_note`) plus optional `riskLevel` and `confidence`; `agentPolicies.accountingEnabled` (optional, unset means on); `agentRuns.runType` gains `accounting_scan`.
- Ledger API: `createEntry`, `postDraft` and `attachReceipt` are extracted as plain helpers behind `addEntry`, `postEntry` and `linkReceipt`, plus `ledgerPeriodView` for the scan. The public mutations behave exactly as before.
- Access: seeing a money item needs `insights.read`; deciding one needs `ops.action.approve` and an owner or manager seat (agency owner and admin act as the studio). An accountant can read but not approve. A manager whose owner turned money off sees nothing.
- No email, SMS, payment or booking path is added. No model is called unless a key is configured, and then only to reword an explanation.

## Non-goals

- Posting, voiding, editing or deleting anything on its own, at any autonomy level.
- Deciding how an unexplained difference is resolved. The agent reports it and names no cause.
- Importing bank transactions line by line, tax preparation, payroll, invoices and collections (Revenue Ops keeps client invoice reminders), and the branded report UI (phase B).
