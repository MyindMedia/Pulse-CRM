# Design: Accounting agent (phase C)

## Identity

| | |
|---|---|
| id | `accounting` |
| name | Accounting |
| tone | plain, calm, never alarmist. States a number and what it means, says what is not known, never says "urgent", "critical" or "problem". No em dashes in any copy (`plain()` in `agentScope.ts` strips them). |
| where it lives | the Approval Inbox group "Accounting", the Agents fleet view, and answers to money questions in Pulse Agent |

## What it may do (the allowlist)

Declared as data in `convex/lib/agentScope.ts` (`ACCOUNTING_CAPABILITIES`) so a test and a reviewer read the same list.

| Capability | Meaning |
|---|---|
| `ledger.read`, `expenses.read`, `receipts.read`, `bank.read` | read the books, expenses, uploaded receipts and the bank reconciliation |
| `ledger.draft_entry` | create a balanced DRAFT journal entry (`status: "draft"`, `source: "agent"`) |
| `receipts.propose_link` | propose attaching an uploaded receipt to an entry |
| `categories.propose` | propose a category, account or payment-type correction |
| `insights.write` | write the month-end checklist and the owner digest as read-only notes |
| `approvals.propose` | put a proposal or flag in the approval inbox |
| `receipts.link_exact` | attach a receipt on its own, only at autonomy `auto_trusted`, only for an exact match |

## What it must never do (`ACCOUNTING_FORBIDDEN`)

`ledger.post`, `ledger.void`, `ledger.edit_posted`, `ledger.delete`, `money.move`, `email.send`, `sms.send`, `bookings.write`, `rates.write`, `members.write`, `settings.write`.

The only place the Accounting module posts is the approval path, after a person with an owner or manager seat decides. A source test asserts `postDraft(` appears exactly once in `convex/accountingAgent.ts`, inside `approveAccountingAction`, and that the file contains no void, delete, send or `status: "posted"`.

## Scope enforcement, both directions

1. **Accounting stays in its lane.** `assertActionInScope("accounting", action)` runs on every proposal before it is saved: the kind must be one of the eight `acct_*` kinds, its capability must be on the allowlist, its payload kind must be the one that kind may carry (no email, no session change), and a draft must be balanced with at least two lines.
2. **Nobody else gets in.** Every inbox action kind has an owner in `AGENT_OF_ACTION_TYPE` (a new kind that is not mapped does not compile). `upsertProposed`, the path every other agent uses, runs `assertActionInScope("operations", action)` and refuses an accounting kind or a ledger payload. `agentMay(agent, capability)` is false for every other agent and every ledger capability.
3. **The ledger tables are fenced at the source.** A test scans the repo and fails if any module other than the ledger, its tables and engine, the schema, the workspace delete and reset helpers, `accountingAgent.ts` and `agents/accounting.ts` references `journalEntries`, `ledgerAccounts`, `openingBalances`, `bankStatementBalances`, `reportedStatements`, `api.ledger` or `internal.ledger`. A second test fails if any module other than the inbox, the agent plumbing and the cron table calls into `accountingAgent`.
4. **Money questions are routed.** `routeIntent(text)` claims a question for Accounting by money vocabulary (books, ledger, reconcile, bank, receipts, expenses, profit and loss, month-end, owner draw, deposits in transit, processor fees, categorize, credit card interest, cash differs). It first yields to the questions another agent already owns (change a room rate, chase an overdue invoice, ad campaigns). It lives where free-text questions are decided, `agent.createRun`: a routed question is answered by `accountingAgent.answerRun` from the books, logged as `run.routed`, and never reaches the general agent. The general agent's system prompt also carries a hand-off line so it does not answer from memory. When the studio has switched Accounting off, the question falls through to the general agent.

## The generators (pure, `convex/agents/accounting.ts`)

Input is plain data (`AccountingSignals`): one period's posted and draft entries, the two or three months before, uploaded receipts, `ledger.bankReconciliation` rows, the engine's checks and variances, and the importer's warnings. Output is the repo's `ProposedAction` shape. Same input, same output.

**(i) Receipts.** A receipt can be linked to an entry that is posted, in the period, not agent-made, marked No or pending, and has no receipt yet, when the amount matches to the cent and the dates are within seven days. Score out of 100: amount 60, date 25 / 20 / 10 (same day / up to 3 days / up to 7), vendor 15 / 8 by name overlap with the description (`vendorSimilarity`). Offered at 70 or more. **Exact** (risk `low`, the only thing autonomy may apply) means score 85 or more, within three days, a vendor clue, and 15 points clear of the runner-up on both sides. Anything else is `medium` and a person confirms it. An entry marked No with no candidate gets a "no receipt on file" flag.

**(ii) Clearing.** From `bankReconciliation`: when the bank holds more cash than the books, each clearing account still holding money (Deposits In Transit, Business Funds Held by Owner) gets a draft Debit Bank / Cash, Credit that account, dated the last day of the month, with the statement figures as evidence. If the drafts together are more than the gap, they say so. A cash-paid owner draw (payment type Cash, credited to Bank / Cash) gets a draft that takes it out of Deposits In Transit instead, because that is where cash taken in and not yet deposited sits; it is only proposed while that account still holds enough, and its evidence says the clearing draft then moves the smaller amount. A processor deposit with its own fee entry (same processor, same day, shared client name) gets a note, not an entry: the bank will show one net deposit and the books already net to the same cash. The **unexplained remainder** is the books against the bank after all clearing drafts; it is reported with the figures and any entries of exactly that amount as leads to check, and no draft is proposed for it.

**(iii) Categorization.** From the importer's warnings, mapped to the entry and line by source row: blank or dash categories (with the category the account implies), categories that contradict the account, "Revenue" lines sorted into a specific revenue account by keyword, and entries whose two lines name different payment types. Notes only; approving acknowledges.

**(iv) Month-end close checklist** (an insight): your statements against the journal (each differing line, with both figures), cash against the bank, money still in transit, receipts, regular expenses that appeared in each of the last two months and not this one (rent, insurance, internet, software, matched on account and description), text dates, entries outside the month, the beginning cash date label.

**(v) Anomalies.** Duplicates (same date, amount and description), an expense account at twice its trailing average and at least 100.00 above it, credit card interest at 30% or more of card payments and at least 50.00, and negative cash from the engine's check.

**(vi) Owner digest** (an insight): "Revenue $1,305.00, expenses $2,432.80, net loss $1,127.80. Your books show $981.29 cash; the bank shows $1,611.29. Three things need your attention." Things are the groups that need attention: statements against the journal, cash (the bank gap and money in transit count once), receipts, regular expenses. Tidy-ups and "worth a look" items are listed below the headline, not counted in it.

## Wiring

- **Scan** (`accountingAgent.scanOrg`, daily cron, same fan-out as the ops brain): skip when the studio has no books or Accounting is off (`agentPolicies.enabled` and `accountingEnabled`, unset means on). Scans the two most recent months that have books. Logs an `agentRuns` row (`accounting_scan`) and audit events.
- **Drafts** are created at scan time through `createEntry` (the ledger API's one write path) with `sourceRef = "agent:<dedupeKey>"`, so a lost inbox row can never produce a second draft. Drafts never touch a balance.
- **Dedupe.** Key = `type:<period>:<kind>:<ids and amounts>`. Open, snoozed, executed and dismissed rows all block a repeat, so a dismissed item does not return and an applied one is not proposed again. The amount is in the key, so a changed situation is a new proposal. Open items that the books no longer support (a balance was cleared another way, a receipt arrived) are withdrawn by the rescan (`decidedBy: "accounting:rescan"`), which can be undone by the situation coming back. A person's decision is never touched.
- **Autonomy** (`agentPolicies.autonomy`, default `suggest`): at `suggest` and `auto_low` everything waits. At `auto_trusted` the scan attaches an exact receipt match and records it as executed with `autonomy: true`. Nothing else, at any level. The graduation-to-auto counters in `opsAutonomy` are refused for Accounting kinds.
- **Approve** (`opsActions.approve` hands accounting kinds to `accountingAgent.approveAccountingAction`, also exposed as `accountingAgent.approve`): needs `insights.read`, `ops.action.approve` and an owner or manager seat. A `ledger_draft` posts through `postDraft`, after confirming for a clearing draft that the account still holds the amount (otherwise a stale-proposal error asks for a fresh scan). A `receipt_link` attaches through `attachReceipt`. A note is acknowledged and changes nothing. Decisions write activity, audit and agent audit rows. **Dismiss** leaves any draft as a draft: dismissing never voids or deletes.
- **Visibility.** `opsActions.list` and `counts` drop accounting kinds for anyone without `insights.read`. An accountant can read but not decide. A manager whose owner turned money off sees nothing.
- **Fleet.** `agentFleet.fleet` returns `accounting: { enabled, openProposals, lastScanAt }` per studio; `agentFleet.setAccountingAgent` and `accountingAgent.setEnabled` flip the switch.
- **AI wording** (`aiActions.enrichAccountingActions`, scheduled only when `OPENAI_API_KEY` exists): rewrites a proposal's explanation in plain English; the result is used only if `verifyDraft` finds every dollar figure in the facts and none invented. Otherwise the deterministic text stays. Tests run with the key blanked and assert nothing is scheduled.

## Decisions to confirm

1. The cash-draw draft credits Deposits In Transit (cash received and not yet deposited). An accountant may prefer a dedicated "cash on hand" account.
2. A processor deposit and its fee produce a note rather than an entry, because the books already net to the bank's figure.
3. Dismissing leaves the agent's draft in the journal as a draft; it never voids on a person's behalf.
