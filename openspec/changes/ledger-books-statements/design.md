# Design: ledger, books import and statements (phase A)

## Principles

1. Money is integer cents everywhere: storage, engine, API and CLI. A spreadsheet number becomes cents once, at the edge, with `Math.round(value * 100)`.
2. One document per transaction. `journalEntries.lines` holds the debit and credit lines; `assertBalancedLines` (convex/lib/ledgerMath.ts) is the only validator and runs in the parser, the import mutation, `addEntry` and `postFromExpense`.
3. The engine is pure. `convex/lib/ledgerMath.ts` and `convex/lib/statements.ts` import nothing from Convex, so the CLI, the tests and the API compute the same numbers.
4. Never hide a disagreement. The owner's statements are stored exactly as reported (`reportedStatements`). The ledger's numbers are recomputed. The difference is returned line by line as variances, and the reasons as checks.

## Data model (convex/ledgerTables.ts)

```text
ledgerAccounts        orgId, key, name, type, subtype, statementLine, sortOrder,
                      normalBalance, isCash?, isClearing?, cashFlowLine?,
                      cashFlowLineInflow?, aliases?, active
journalEntries        orgId, entryDate (UTC midnight), memo, paymentType {kind, raw?, card?},
                      receiptStatus yes|no|pending, status posted|draft|void, source
                      import|manual|agent|bank|expense, importBatchId?, sourceRef?,
                      contentHash?, bookPeriod?, receiptDocIds?, expenseId?,
                      lines [{accountId, debitCents, creditCents, memo?}],
                      createdBy, createdAt, voidedAt?, voidedBy?, voidReason?
openingBalances       orgId, asOf, lines [{accountId, cents}], source, note?
reportedStatements    orgId, periodStart, periodEnd, entityName, balanceSheet,
                      incomeStatement, cashFlow, warnings, source 'workbook', importBatchId
bankStatementBalances orgId, accountLabel (last four or a label, never a full number),
                      ledgerAccountId?, periodStart, periodEnd, beginningCents,
                      endingCents, depositsCents, withdrawalsCents, feesCents, source
```

Opening balance `cents` are in the account's normal direction (a positive asset is a debit balance, a positive liability a credit balance). The engine converts to signed debit-minus-credit internally.

Every index starts with `orgId`. None of these tables is in `MIRRORED_TABLES`: books are read on the web and by the agent, and a device mirror would need a separate money review first.

## Statement keys

Every account carries a `statementLine` key (`revenue.recording_session`, `asset.cash`, `liability.credit_card_payable`, `equity.owner_contributions` ...) and, for cash flow, a `cashFlowLine` key (`operating.customer_receipts`, `financing.credit_card_payments` ...). The importer maps the owner's statement labels to the same keys with a small rule table, so reported and recomputed lines compare by key, not by spelling. Totals use fixed keys (`total_revenue`, `total_expenses`, `net_income`, `total_assets`, `total_liabilities`, `total_equity`, `total_liabilities_and_equity`, `net_operating`, `net_financing`, `net_investing`, `net_change`, `beginning_cash`, `ending_cash`).

## Engine

- Trial balance: per account, debits, credits, signed balance, in the account's normal direction.
- Income statement for `[start, end)`: revenue = credits minus debits, expenses = debits minus credits, grouped by statement line.
- Balance sheet as of `end`: opening balances plus posted entries from the opening date. Equity is owner accounts plus retained earnings, where retained earnings = opening retained earnings + income earned between the opening date and the period start (derived) + the current period's net income (derived). The A = L + E check compares totals computed from account balances. Nothing is plugged; a ledger that does not balance fails the check and shows the difference.
- Cash flow (direct): for each posted entry that touches a cash account (`isCash`), every non-cash line contributes `credit - debit` to the line named by its account's `cashFlowLine` (or `cashFlowLineInflow` for an inflow, so owner draws and owner reimbursements show separately). Because entries balance, the contributions sum exactly to the cash change, with no proportional allocation. Beginning and ending cash come from cash account balances, so they tie to opening balances.
- Checks: `balanced_entries`, `opening_balanced`, `balance_sheet_balances`, `cash_flow_ties`, `cash_vs_bank`, `unclassified_accounts`, `receipts_missing`, `clearing_not_cleared`, `negative_cash`, `entries_outside_period`, `duplicate_entries`, `reported_statement_warnings`, `reported_retained_earnings_plug`. Each is `pass`, `warn` or `fail` with a message and machine-readable detail.
- Variances: per statement, `recomputed - reported` for every key either side has, nonzero only, flagged `line` or `total`.

## Import

- Input is a neutral grid (`{ name, rows: { v, f?, date? }[][] }[]`), so the parser has no spreadsheet dependency and can run inside Convex. The CLI turns an `.xlsx` into the grid with the `xlsx` package already in `package.json` (no new dependency).
- Journal: header row found by its labels; a dated row starts an entry and undated rows continue it. Every entry is validated with `assertBalancedLines`.
- Normalization (each reported as a warning with the row): account name variants and spacing, category variants (`liability`, `Liability `, `-`), payment type variants and the en dash, text dates (`7//27/26` becomes 2026-07-27), credit lines whose payment type differs from the debit line, receipts marked No, categories that contradict the account's type, and the single `Revenue` account split into recording, podcast and other audio lines by description keywords (inferred, so warned).
- Statements: the three side-by-side blocks are found by their titles. Cached values are used and formulas are re-evaluated (SUM and plus or minus of cells) to cross-check. Warnings: values typed in rather than computed, retained earnings derived by a plug formula, and a beginning cash label whose date is not the period start.
- Idempotency: each entry's `contentHash` is a stable hash of date, lines and memo plus an occurrence counter for identical twins; the batch id is a hash of all entry hashes and the period. Re-import skips entries whose hash exists, replaces the reported statements for the period, and upserts accounts by key.
- Opening balances: the workbook has no prior balance sheet. `impliedOpeningBalances` derives them from the reported closing balance sheet minus the period's activity, anchors cash to the bank statement's beginning balance when one is given, never seeds a negative balance on a clearing account (it seeds zero and says so), and makes opening retained earnings the balancing figure, flagged as such. This is an explicit, labelled choice (`source: implied_from_reported_close`) and an open question for the owner.

## Access

- Reads: `currentOrgWithCapability(ctx, "insights.read")`, the same gate as `expenses.list` and `expenses.plReport`, so the owner's "managers can see money" switch and the agency scope rules apply unchanged.
- Writes: `insights.read` plus an owner or manager seat for studio members. Agency owners and admins (who already hold `insights.read` and act as the studio within their scope) may write; agency staff and accountants may not.
- The CLI's `--apply` calls `ledger.importBooks`, an internal mutation, with the deployment's deploy key from the environment.

## Expense bridge

`ledger.postFromExpense({ expenseId, debitAccountId?, creditAccountId?, status? })` posts one balanced entry for an existing expense (debit the mapped expense account, credit bank cash or the card payable when the linked bank line is a card). It is idempotent by `sourceRef = expense:<id>` and never runs automatically.
